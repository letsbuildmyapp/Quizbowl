'use strict';

// Game transport: Firestore triggers around the pure engine in ../engine.
//  - onSessionRequest: builds a match (question order, seed, opponent plan locked in)
//  - onSessionCommand: applies one client command inside a transaction
//  - onSessionFinished: rewards, summaries, leaderboards, quests, assignments, metrics

const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const engine = require('../engine');
const { db, FieldValue, UserError, now, toMillis, claimsOf, fulfil, audit, bumpMetric, hashId, notify, DEFAULT_CLASS_SETTINGS, DEFAULT_SCHOOL_SETTINGS } = require('./common');
const { pickQuestions } = require('./questions');

const { catalog } = engine;
const FIXED_PERSONAS = catalog.personas.filter((p) => !p.adaptive);
const ACTIVE_STATUSES = ['READY', 'READING_CLUE', 'BUZZ_LOCKED', 'AWAITING_ANSWER', 'SCORED', 'BONUS', 'PAUSED'];

async function opponentFloors() {
  const snap = await db.doc('config/opponents').get();
  return snap.data()?.reactionFloorMs || {};
}

function classSettings(classroom) {
  const s = { ...DEFAULT_CLASS_SETTINGS, ...(classroom?.settings || {}) };
  s.rules = { ...(s.rules || {}) };
  return s;
}

function buildRules(settings, overrides = {}) {
  const r = { ...catalog.defaultRules, ...settings.rules };
  const speed = overrides.readingSpeed || settings.accessibility?.readingSpeed || r.readingSpeed;
  return { ...r, ...overrides, readingSpeed: catalog.readingSpeeds[speed] ? speed : 'medium' };
}

function buildOpponent({ personaId, settings, student, seed, specialty, floors }) {
  const minTier = Number(settings.opponentMinTier ?? 0);
  const maxTier = Number(settings.opponentMaxTier ?? 3);
  let id = personaId;
  if (!id || id === 'quick') id = 'adaptive-rival';
  const base = catalog.personas.find((p) => p.id === id);
  if (!base) throw new UserError('Pick a rival to play.');
  if (!base.adaptive && (base.tier < minTier || base.tier > maxTier)) {
    throw new UserError(`${base.name} isn't available in your class right now. Pick another rival.`);
  }
  let adaptiveLevel = null;
  if (base.adaptive) {
    const bounds = engine.ladderBounds(minTier, maxTier);
    adaptiveLevel = engine.nextAdaptiveLevel(student?.adaptiveLevel, student?.recentVersus, bounds);
  }
  let spec = specialty;
  if (base.specialtyAccuracy && !spec) spec = engine.streamFor(seed, 'specialty').pick(catalog.categories.map((c) => c.id));
  const params = engine.resolvePersona(id, { adaptiveLevel, specialty: spec, minTier, maxTier, floors });
  return { params, adaptiveLevel };
}

function planOpponent(params, seed, tossups, bonuses) {
  const matchAccuracy = engine.drawMatchAccuracy(params, seed);
  return {
    matchAccuracy,
    tossups: tossups.map((q, i) => engine.planTossup(q, params, matchAccuracy, seed, i)),
    bonuses: bonuses.map((b, i) => (b ? engine.planBonus(b, params, matchAccuracy, seed, i) : null))
  };
}

/** Recommended category for Today's Quest: the current world (newest unlocked) or weakest. */
function dailyCategory(student) {
  const rec = engine.recommendNext(student.stats || {}, null);
  const unlocked = student.unlockedWorlds || [catalog.worlds[0].id];
  const newest = catalog.worlds.filter((w) => unlocked.includes(w.id)).pop();
  return rec.reason.startsWith('Your') ? rec.category : newest?.category || rec.category;
}

async function createStudentSession(sessionId, data, claims) {
  const studentId = claims.studentId;
  const [studentSnap, classSnap] = await Promise.all([db.doc(`students/${studentId}`).get(), db.doc(`classrooms/${claims.classroomId}`).get()]);
  const student = studentSnap.data();
  const classroom = classSnap.data();
  if (!student || student.active === false) throw new UserError("Your profile isn't active. Ask your teacher.");
  if (!classroom) throw new UserError('Your class was not found. Ask your teacher.');
  const school = (await db.doc(`schools/${student.schoolId}`).get()).data() || {};
  const schoolSettings = { ...DEFAULT_SCHOOL_SETTINGS, ...(school.settings || {}) };
  if (schoolSettings.consentMode === 'parent' && student.consent !== 'granted') {
    throw new UserError('A grown-up needs to approve QuizQuest before you can play. Your teacher can help.');
  }

  const settings = classSettings(classroom);
  const opts = data.options || {};
  let mode = data.mode;
  const seed = engine.newSeed();
  let count = Number(opts.count) || null;
  let category = opts.category || null;
  let difficulty = opts.difficulty || null;
  let setId = opts.setId || null;
  let personaId = opts.personaId || null;
  let ids = null;
  let title = null;
  let dailyQuest = false;
  let reviewDeck = false;
  let assignmentId = null;
  const ruleOverrides = {};

  if (opts.assignmentId) {
    const a = (await db.doc(`assignments/${opts.assignmentId}`).get()).data();
    if (!a || a.classroomId !== claims.classroomId || a.archived) throw new UserError('That assignment is no longer available.');
    const t = a.targets || { type: 'class' };
    const targeted = t.type === 'class' || (t.type === 'team' && t.ids?.includes(student.teamId)) || (t.type === 'students' && t.ids?.includes(studentId));
    if (!targeted) throw new UserError("That assignment isn't for you.");
    assignmentId = opts.assignmentId;
    mode = a.mode || 'practice';
    count = a.count;
    category = a.category || null;
    difficulty = a.difficulty || null;
    setId = a.setId || null;
    personaId = a.personaId || personaId;
    title = a.title;
  }

  if (mode === 'daily') {
    mode = 'versus';
    dailyQuest = true;
    count = 5;
    category = category || dailyCategory(student);
    personaId = 'adaptive-rival';
    title = "Today's Quest";
  }
  if (mode === 'review') {
    const deck = await db.collection(`students/${studentId}/reviewDeck`).limit(50).get();
    ids = deck.docs.map((d) => d.id);
    if (!ids.length) throw new UserError('Your Review Deck is empty. Save questions after a match to review them here.');
    mode = 'practice';
    reviewDeck = true;
    count = Math.min(count || 10, ids.length);
    title = 'Review Deck';
  }
  if (!['practice', 'score_attack', 'versus'].includes(mode)) throw new UserError('Unknown game mode.');

  if (mode === 'practice') {
    ruleOverrides.negEnabled = false;
    if (opts.readingSpeed === 'manual') ruleOverrides.readingSpeed = 'manual';
    ruleOverrides.untimedAnswers = opts.untimed !== false;
    ruleOverrides.answerWindowMs = 15000;
    count = count || 8;
  }
  if (mode === 'score_attack') {
    ruleOverrides.bonusesEnabled = false;
    count = count || 10;
  }
  if (mode === 'versus') count = count || settings.rules.matchLength || catalog.defaultRules.matchLength;
  if (opts.readingSpeed && opts.readingSpeed !== 'manual') ruleOverrides.readingSpeed = opts.readingSpeed;
  const rules = buildRules(settings, ruleOverrides);

  let avoidIds = student.recentQuestionIds || [];
  if (opts.rematchOf) {
    const prev = (await db.doc(`sessionSecrets/${opts.rematchOf}`).get()).data();
    if (prev) avoidIds = [...avoidIds, ...prev.tossups.map((t) => t.id)];
  }
  const { tossups, bonuses } = await pickQuestions(seed, { category, difficulty, setId, ids, count, avoidIds });
  if (!tossups.length) throw new UserError("There aren't any questions ready for that choice yet. Try another category.");

  const participants = [{ id: studentId, kind: 'student', name: student.displayName, avatar: student.avatar || '🙂', side: 'A' }];
  const sides = { A: { name: student.displayName, emoji: student.avatar || '🙂' } };
  let opponent = null;
  let opponentPlan = null;
  if (mode === 'versus') {
    const floors = await opponentFloors();
    const built = buildOpponent({ personaId, settings, student, seed, specialty: opts.specialty, floors });
    opponent = built.params;
    opponentPlan = planOpponent(opponent, seed, tossups, bonuses);
    participants.push({ id: 'computer', kind: 'computer', name: opponent.name, avatar: opponent.avatar, side: 'B' });
    sides.B = { name: opponent.name, emoji: opponent.avatar };
    if (built.adaptiveLevel != null) await studentSnap.ref.update({ adaptiveLevel: built.adaptiveLevel });
  }

  const created = engine.createSession({
    id: sessionId,
    mode,
    seed,
    now: now(),
    rules,
    classroomId: claims.classroomId,
    schoolId: student.schoolId,
    ownerStudentId: studentId,
    assignmentId,
    dailyQuest,
    reviewDeck,
    title,
    participants,
    sides,
    opponent,
    opponentPlan,
    tossups,
    bonuses
  });
  created.pub.teacherUid = classroom.teacherUid;
  created.pub.rematchOf = opts.rematchOf || null;
  created.pub.category = category;
  await studentSnap.ref.update({ recentQuestionIds: [...tossups.map((t) => t.id), ...(student.recentQuestionIds || [])].slice(0, 120) });
  return created;
}

async function createLiveBattle(sessionId, data, claims, uid) {
  if (claims.role !== 'teacher') throw new UserError('Only teachers can host a live battle.');
  const opts = data.options || {};
  const classroom = (await db.doc(`classrooms/${opts.classroomId}`).get()).data();
  if (!classroom || classroom.teacherUid !== uid) throw new UserError('Pick one of your classes.');
  const teamA = opts.teamA || {};
  const teamB = opts.teamB || {};
  const ids = [...(teamA.studentIds || []), ...(teamB.studentIds || [])];
  if (!(teamA.studentIds || []).length || !(teamB.studentIds || []).length) throw new UserError('Each team needs at least one player.');
  const snaps = await Promise.all(ids.map((id) => db.doc(`students/${id}`).get()));
  const participants = [];
  snaps.forEach((s, i) => {
    const st = s.data();
    if (!st || st.classroomId !== opts.classroomId || st.active === false) return;
    participants.push({ id: s.id, kind: 'student', name: st.displayName, avatar: st.avatar || '🙂', side: i < teamA.studentIds.length ? 'A' : 'B' });
  });
  if (!participants.some((p) => p.side === 'A') || !participants.some((p) => p.side === 'B')) throw new UserError('Each team needs at least one active player.');
  const settings = classSettings(classroom);
  const seed = engine.newSeed();
  const { tossups, bonuses } = await pickQuestions(seed, { category: opts.category || null, count: Math.min(15, Math.max(3, Number(opts.count) || 10)) });
  if (!tossups.length) throw new UserError('No questions are ready for that category yet.');
  const created = engine.createSession({
    id: sessionId,
    mode: 'live_battle',
    seed,
    now: now(),
    rules: buildRules(settings, {}),
    classroomId: opts.classroomId,
    schoolId: classroom.schoolId,
    hostUid: uid,
    title: 'Live Team Battle',
    participants,
    sides: { A: { name: String(teamA.name || 'Team A').slice(0, 40), emoji: teamA.emoji || '🦅' }, B: { name: String(teamB.name || 'Team B').slice(0, 40), emoji: teamB.emoji || '🐯' } },
    tossups,
    bonuses
  });
  created.pub.teacherUid = uid;
  created.pub.category = opts.category || null;
  for (const p of participants) {
    await notify({ toStudentId: p.id, kind: 'live_battle', title: 'Live Team Battle!', body: `Join ${created.pub.sides[p.side].name} now.`, link: `/play/match/${sessionId}` });
  }
  await audit('live_battle.created', { actorUid: uid, actorRole: 'teacher', target: `sessions/${sessionId}`, schoolId: classroom.schoolId, details: { players: participants.length } });
  return created;
}

async function writeEvents(batchOrTx, sessionId, pub, events, startSeq) {
  events.forEach((e, i) => {
    const ref = db.doc(`sessions/${sessionId}/events/${String(startSeq).padStart(6, '0')}-${String(i).padStart(3, '0')}`);
    const doc = { ...e, classroomId: pub.classroomId || null, schoolId: pub.schoolId || null, sessionId };
    batchOrTx.set(ref, JSON.parse(JSON.stringify(doc)));
  });
}

exports.onSessionRequest = onDocumentCreated('sessionRequests/{id}', (event) =>
  fulfil(event.data, async (data) => {
    const sessionId = event.params.id;
    const claims = await claimsOf(data.uid);
    let created;
    if (data.mode === 'live_battle') created = await createLiveBattle(sessionId, data, claims, data.uid);
    else {
      if (claims.role !== 'student') throw new UserError('Sign in as a student to play.');
      created = await createStudentSession(sessionId, data, claims);
    }
    const batch = db.batch();
    batch.set(db.doc(`sessions/${sessionId}`), { ...created.pub, createdBy: data.uid });
    batch.set(db.doc(`sessionSecrets/${sessionId}`), created.sec);
    await writeEvents(batch, sessionId, created.pub, created.events, 0);
    await batch.commit();
    if (created.pub.opponent) await bumpMetric({ versusStarted: 1 });
    return { sessionId };
  })
);

// ---------------------------------------------------------------------------

exports.onSessionCommand = onDocumentCreated(
  { document: 'sessions/{sessionId}/commands/{commandId}', concurrency: 80 },
  async (event) => {
    const { sessionId, commandId } = event.params;
    const cmdData = event.data.data();
    const processedAt = now();
    const cmd = {
      id: cmdData.type === 'sync' ? null : commandId,
      type: cmdData.type,
      actorId: cmdData.actorId,
      actorRole: cmdData.role === 'teacher' ? 'teacher' : 'student',
      at: toMillis(cmdData.at) ?? processedAt,
      payload: cmdData.payload || {}
    };
    const pubRef = db.doc(`sessions/${sessionId}`);
    const secRef = db.doc(`sessionSecrets/${sessionId}`);
    let result;
    try {
      result = await db.runTransaction(async (tx) => {
        const [pubSnap, secSnap] = await Promise.all([tx.get(pubRef), tx.get(secRef)]);
        if (!pubSnap.exists || !secSnap.exists) return { error: { code: 'not-found', message: 'Session not found' } };
        const pubIn = pubSnap.data();
        // Teachers may only act on sessions in their classroom.
        if (cmd.actorRole === 'teacher' && pubIn.teacherUid !== cmdData.uid) return { error: { code: 'forbidden', message: 'Not your class' } };
        const t = Date.now();
        const out = engine.applyCommand(pubIn, secSnap.data(), cmd, t);
        if (out.ignored === 'duplicate') return out;
        if (out.error && !out.events.length && out.pub === pubIn) return out;
        tx.set(pubRef, out.pub);
        // The secret only changes through the idempotency list (non-sync commands).
        if (cmd.id) tx.set(secRef, out.sec);
        await writeEvents(tx, sessionId, out.pub, out.events, out.pub.seq);
        return out;
      });
    } catch (err) {
      console.error('command failed', sessionId, cmd.type, err.message);
      result = { error: { code: 'internal', message: 'Try again' } };
    }
    if (result?.error) {
      await event.data.ref.set({ processed: true, error: result.error, processedAt }, { merge: true });
    } else if (cmd.type !== 'sync') {
      await event.data.ref.set({ processed: true, processedAt }, { merge: true });
    }
  }
);

// ---------------------------------------------------------------------------
// Completion: rewards and everything that hangs off a finished match.

async function activeTeamQuests(classroomId, t) {
  const snap = await db.collection('teamQuests').where('classroomId', '==', classroomId).where('endsAt', '>', t).get();
  return snap.docs.filter((d) => (d.data().startsAt || 0) <= t);
}

function questContribution(quest, summary) {
  const metric = quest.metric === 'answered' ? 'answered' : 'correct';
  if (quest.category) return summary.byCategory[quest.category]?.[metric] || 0;
  return summary[metric] || 0;
}

async function rewardStudent(sessionId, pub, participant, context) {
  const studentId = participant.id;
  const studentRef = db.doc(`students/${studentId}`);
  const summaryRef = db.doc(`sessionSummaries/${sessionId}_${studentId}`);
  const t = now();

  const preview = engine.summarizeForStudent(pub, studentId);
  const studentData = (await studentRef.get()).data();
  if (!studentData) return null;
  const quests = await activeTeamQuests(pub.classroomId, t);
  const myQuests = quests.filter((q) => !q.data().teamId || q.data().teamId === studentData.teamId);
  const contributionByQuest = myQuests.map((q) => ({ ref: q.ref, data: q.data(), n: questContribution(q.data(), preview) }));
  const teamQuestContribution = contributionByQuest.reduce((s, q) => s + q.n, 0);

  const applied = await db.runTransaction(async (tx) => {
    const existing = await tx.get(summaryRef);
    if (existing.exists) return null; // idempotent: already rewarded
    const student = (await tx.get(studentRef)).data();
    if (!student) return null;
    const out = engine.applySessionRewards(student, pub, { now: t, studentId, timeZone: context.timeZone, teamQuestContribution });
    tx.update(studentRef, out.update);
    const opp = pub.opponent;
    const oppSide = Object.keys(pub.sides).find((k) => k !== participant.side);
    tx.set(summaryRef, {
      sessionId,
      studentId,
      classroomId: pub.classroomId,
      schoolId: pub.schoolId,
      teamId: student.teamId || null,
      mode: pub.mode,
      title: pub.title || null,
      dailyQuest: !!pub.dailyQuest,
      assignmentId: pub.assignmentId || null,
      opponent: opp ? { personaId: opp.personaId, name: opp.name, avatar: opp.avatar, tier: opp.tier, adaptiveLevel: opp.adaptiveLevel } : null,
      liveTeam: pub.mode === 'live_battle' ? pub.sides[participant.side].name : null,
      won: out.summary.won,
      tie: out.summary.tie,
      points: out.summary.points,
      opponentPoints: oppSide ? pub.sides[oppSide].score : null,
      seen: out.summary.seen,
      answered: out.summary.answered,
      correct: out.summary.correct,
      powers: out.summary.powers,
      early: out.summary.early,
      negs: out.summary.negs,
      bonusParts: out.summary.bonusParts,
      bonusCorrect: out.summary.bonusCorrect,
      longestStreak: out.summary.longestStreak,
      avgCorrectClueFraction: out.summary.avgCorrectClueFraction,
      byCategory: out.summary.byCategory,
      topics: out.summary.topics,
      missed: out.summary.missed,
      newBests: out.summary.newBests || [],
      xpEarned: out.xpEarned,
      xpBreakdown: out.xpBreakdown,
      newBadges: out.newBadges,
      newCards: out.newCards,
      unlockedWorlds: out.unlockedWorlds,
      leveledUp: out.leveledUp,
      level: out.update.level,
      recommendation: out.recommendation,
      teamQuestContribution,
      dayKey: out.dayKey,
      weekKey: out.weekKey,
      completedAt: t,
      eventsCount: pub.seq
    });
    return { out, student };
  });
  if (!applied) return null;
  const { out, student } = applied;

  // Team quests
  for (const q of contributionByQuest) {
    if (!q.n) continue;
    await db.runTransaction(async (tx) => {
      const cur = (await tx.get(q.ref)).data();
      const progress = (cur.progress || 0) + q.n;
      const upd = { progress, [`contributions.${studentId}`]: FieldValue.increment(q.n), [`names.${studentId}`]: studentData.displayName };
      if (!cur.completedAt && progress >= cur.target) upd.completedAt = t;
      tx.update(q.ref, upd);
    });
  }

  // Assignment progress
  if (pub.assignmentId) {
    const ref = db.doc(`assignments/${pub.assignmentId}/progress/${studentId}`);
    await db.runTransaction(async (tx) => {
      const cur = (await tx.get(ref)).data() || {};
      const acc = out.summary.answered ? Math.round((out.summary.correct / out.summary.answered) * 100) : 0;
      tx.set(ref, {
        studentId,
        classroomId: pub.classroomId,
        completed: true,
        sessions: (cur.sessions || 0) + 1,
        bestPoints: Math.max(cur.bestPoints || 0, out.summary.points),
        bestAccuracy: Math.max(cur.bestAccuracy || 0, acc),
        completedAt: cur.completedAt || t,
        lastAt: t
      });
    });
  }

  // Weekly leaderboards (aliases only; opted-out students are left off)
  await updateLeaderboards(pub.classroomId, out.weekKey, studentId, student, out);

  // School challenges
  const challenges = await db.collection('challenges').where('classroomIds', 'array-contains', pub.classroomId).get();
  for (const ch of challenges.docs) {
    const c = ch.data();
    if (c.startsAt > t || c.endsAt < t) continue;
    const cats = c.categories?.length ? c.categories : null;
    const correct = cats ? cats.reduce((s, cat) => s + (out.summary.byCategory[cat]?.correct || 0), 0) : out.summary.correct;
    if (!correct) continue;
    await ch.ref.update({ [`standings.${pub.classroomId}.points`]: FieldValue.increment(correct * 10), [`standings.${pub.classroomId}.correct`]: FieldValue.increment(correct) });
  }

  // "Close" answers go to the teacher for review.
  const reviewable = [];
  for (const h of pub.history) {
    for (const a of h.attempts || []) {
      if (a.actorId === studentId && a.flaggedClose) reviewable.push({ h, a });
    }
  }
  for (const { h, a } of reviewable) {
    await db.collection('answerReviews').add({
      sessionId,
      studentId,
      studentName: student.displayName,
      classroomId: pub.classroomId,
      teacherUid: pub.teacherUid || null,
      questionId: h.questionId,
      category: h.category,
      given: a.answer,
      canonicalAnswer: h.canonicalAnswer,
      acceptedAnswers: context.acceptedById[h.questionId] || [],
      clueIndex: a.clueIndex,
      potentialPoints: pub.rules.tossupPoints,
      potentialXp: catalog.xp.correctTossup,
      status: 'pending',
      createdAt: t
    });
  }

  // Notifications for the student and linked families.
  if (out.newBadges.length || out.unlockedWorlds.length) {
    const names = [
      ...out.newBadges.map((b) => catalog.badges.find((x) => x.id === b)?.name).filter(Boolean),
      ...out.unlockedWorlds.map((w) => catalog.worlds.find((x) => x.id === w)?.name).filter(Boolean)
    ];
    await notify({ toStudentId: studentId, kind: 'reward', title: 'New unlock!', body: names.join(', '), link: '/play/rewards' });
    const links = await db.collection('guardianLinks').where('studentId', '==', studentId).where('status', '==', 'active').get();
    for (const l of links.docs) {
      const prefs = (await db.doc(`users/${l.data().parentUid}`).get()).data()?.prefs;
      if (prefs?.notifications?.badges === false) continue;
      await notify({ toUid: l.data().parentUid, kind: 'badge', title: `${student.displayName} earned something new`, body: names.join(', '), link: `/family/child/${studentId}` });
    }
  }

  // Privacy-safe metrics: distinct active students tracked by a one-way hash.
  const wk = engine.weekKey(t, 'UTC');
  const activeRef = db.doc(`metrics/${wk}/active/${hashId(studentId)}`);
  const firstThisWeek = await activeRef.create({ at: t }).then(() => true, () => false);
  const m = { sessions: 1, questions: out.summary.seen, questionsAnswered: out.summary.answered, questionsCorrect: out.summary.correct };
  if (firstThisWeek) m.activeStudents = 1;
  if (pub.opponent && out.summary.won !== null) {
    const tier = String(pub.opponent.tier);
    m[`versusByTier.${tier}.played`] = 1;
    if (out.summary.won) m[`versusByTier.${tier}.studentWins`] = 1;
    m.versusCompleted = 1;
    if (pub.rematchOf) m.rematches = 1;
  }
  await bumpMetric(m, t);
  return out;
}

async function updateLeaderboards(classroomId, wk, studentId, student, out) {
  const lbRef = db.doc(`leaderboards/${classroomId}_${wk}`);
  const tbRef = db.doc(`teamboards/${classroomId}_${wk}`);
  await db.runTransaction(async (tx) => {
    const [lb, tb] = await Promise.all([tx.get(lbRef), tx.get(tbRef)]);
    const entries = (lb.data()?.entries || []).filter((e) => e.studentId !== studentId);
    const prev = (lb.data()?.entries || []).find((e) => e.studentId === studentId);
    if (!student.leaderboardOptOut) {
      entries.push({
        studentId,
        displayName: student.displayName,
        avatar: student.avatar || '🙂',
        teamId: student.teamId || null,
        xp: (prev?.xp || 0) + out.xpEarned,
        correct: (prev?.correct || 0) + out.summary.correct
      });
    }
    entries.sort((a, b) => b.xp - a.xp);
    tx.set(lbRef, { classroomId, weekKey: wk, entries, updatedAt: now() });
    if (student.teamId) {
      const teams = tb.data()?.teams || [];
      let team = teams.find((x) => x.teamId === student.teamId);
      if (!team) {
        const td = (await db.doc(`teams/${student.teamId}`).get()).data() || {};
        team = { teamId: student.teamId, name: td.name || 'Team', emoji: td.emoji || '⭐', xp: 0, correct: 0 };
        teams.push(team);
      }
      team.xp += out.xpEarned;
      team.correct += out.summary.correct;
      teams.sort((a, b) => b.xp - a.xp);
      tx.set(tbRef, { classroomId, weekKey: wk, teams, updatedAt: now() });
    }
  });
}

exports.onSessionFinished = onDocumentUpdated('sessions/{sessionId}', async (event) => {
  const before = event.data.before.data();
  const after = event.data.after.data();
  if (!after || before?.status === after.status) return;
  const sessionId = event.params.sessionId;

  if (after.status === 'TERMINATED') {
    if (after.terminatedBy === 'teacher') {
      await audit('session.terminated', { actorRole: 'teacher', target: `sessions/${sessionId}`, schoolId: after.schoolId, details: { reason: after.terminatedReason } });
    }
    return;
  }
  if (after.status !== 'COMPLETE') return;

  const school = after.schoolId ? (await db.doc(`schools/${after.schoolId}`).get()).data() : null;
  const timeZone = school?.settings?.timezone || 'America/New_York';
  const sec = (await db.doc(`sessionSecrets/${sessionId}`).get()).data() || {};
  const acceptedById = Object.fromEntries((sec.tossups || []).map((q) => [q.id, q.acceptedAnswers || []]));
  const results = {};
  for (const p of after.participants.filter((x) => x.kind === 'student')) {
    try {
      const out = await rewardStudent(sessionId, after, p, { timeZone, acceptedById });
      if (out) results[p.id] = { xpEarned: out.xpEarned };
    } catch (err) {
      console.error('reward failed', sessionId, err);
    }
  }
  await db.doc(`sessions/${sessionId}/events/zz-reward`).set({ type: 'reward', at: now(), sessionId, classroomId: after.classroomId || null, schoolId: after.schoolId || null, data: results });
});

exports._internal = { createStudentSession, createLiveBattle, buildOpponent, rewardStudent, ACTIVE_STATUSES, FIXED_PERSONAS };
