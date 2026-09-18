'use strict';

// Reward service: grants, chest/star claims, crafting, loadouts, teacher awards,
// school quests, organization theme projection, Quiz Hall peer cards.
// Every grant is written under students/{id}/grants/{idempotencyKey} inside the
// same transaction that updates the inventory, so it exists before any reveal.

const { onDocumentCreated, onDocumentWritten } = require('firebase-functions/v2/firestore');
const R = require('../engine/rewards');
const { levelForXp, titleForLevel } = require('../engine/progression');
const { db, FieldValue, UserError, now, claimsOf, fulfil, audit, notify, bumpMetric, DEFAULT_CLASS_SETTINGS } = require('./common');

const { rewards } = R;

async function schoolCatalogFor(schoolId) {
  if (!schoolId) return null;
  return (await db.doc(`schools/${schoolId}`).get()).data()?.rewardCatalog || null;
}

function classRewardSettings(classroom) {
  return { ...rewards.defaultClassRewards, ...(classroom?.settings?.rewards || {}) };
}

function activity(studentRef, type, data) {
  return studentRef.collection('events').doc().set({ type, at: now(), ...data });
}

/** Write grants + inventory inside a transaction; skips grants that already exist. */
async function commitGrants(tx, studentRef, student, grants) {
  const refs = grants.map((g) => studentRef.collection('grants').doc(g.id));
  const snaps = await Promise.all(refs.map((r) => tx.get(r)));
  const fresh = grants.filter((g, i) => !snaps[i].exists);
  if (!fresh.length) return { fresh, patch: {} };
  const patch = R.applyGrants(student, fresh);
  fresh.forEach((g) => tx.set(studentRef.collection('grants').doc(g.id), g));
  return { fresh, patch };
}

// ---------------------------------------------------------------------------
// Session hook (called from game.js inside the reward transaction)

function sessionGrants({ before, after, sessionId, pub, won, at, classroom, schoolCatalog, world }) {
  return R.grantsForSession({
    before,
    after,
    sessionId,
    pub,
    won,
    at,
    classRewards: classRewardSettings(classroom),
    schoolCatalog,
    world
  });
}

// ---------------------------------------------------------------------------
// Map claims: stars and chests on the island map. Doc id {studentId}_{objectId}
// makes the claim idempotent; the server also checks claimedMap in a transaction.

function becamePending(event) {
  const before = event.data.before.exists ? event.data.before.data() : null;
  const after = event.data.after.exists ? event.data.after.data() : null;
  return !!after && after.status === 'pending' && (!before || before.status !== 'pending');
}

exports.onMapClaim = onDocumentWritten('mapClaims/{id}', (event) =>
  becamePending(event) &&
  fulfil(event.data.after, async (data) => {
    const claims = await claimsOf(data.uid);
    if (claims.role !== 'student') throw new UserError('Sign in as a student.');
    const studentId = claims.studentId;
    if (event.params.id !== `${studentId}_${data.objectId}`) throw new UserError('Invalid claim.');
    const star = rewards.map.stars.find((s) => s.id === data.objectId);
    const chest = rewards.map.chests.find((c) => c.id === data.objectId);
    if (!star && !chest) throw new UserError('That spot has nothing to collect.');
    const studentRef = db.doc(`students/${studentId}`);
    const classroom = (await db.doc(`classrooms/${claims.classroomId}`).get()).data();
    const schoolCatalog = await schoolCatalogFor(claims.schoolId);
    const at = now();
    const result = await db.runTransaction(async (tx) => {
      const student = (await tx.get(studentRef)).data();
      if (!student) throw new UserError('Profile not found.');
      if ((student.claimedMap || []).includes(data.objectId)) return { alreadyClaimed: true };
      const rule = (star || chest).rule;
      const check = R.evaluateRule(rule, student);
      if (!check.met) throw new UserError(`Not yet: ${check.label} (${check.have} of ${check.need}).`);
      const patch = { claimedMap: FieldValue.arrayUnion(data.objectId) };
      let grant = null;
      if (star) {
        patch.questStars = (student.questStars || 0) + 1;
        const xp = (student.xp || 0) + 5;
        patch.xp = xp;
        patch.level = levelForXp(xp);
        patch.title = titleForLevel(patch.level);
      } else {
        const contents = R.pickChestContents(chest.chest, student, {
          world: chest.world,
          schoolCatalog,
          random: classRewardSettings(classroom).randomChests,
          seed: `${studentId}:${chest.id}`
        });
        grant = R.makeChestGrant(`map-${chest.id}`, chest.chest, contents, { rule: 'map', objectId: chest.id }, at);
        const { fresh, patch: inv } = await commitGrants(tx, studentRef, student, [grant]);
        grant = fresh[0] || null;
        Object.assign(patch, inv);
      }
      tx.update(studentRef, patch);
      return { type: star ? 'star' : 'chest', grantId: grant?.id || null, questStars: patch.questStars ?? student.questStars ?? 0 };
    });
    await activity(studentRef, result.type === 'chest' ? 'CHEST_OPENED' : 'STAR_COLLECTED', { objectId: data.objectId, grantId: result.grantId || null });
    return result;
  })
);

// ---------------------------------------------------------------------------
// Loadouts and presets (equip is validated server-side; preview is client-only).

exports.onLoadoutRequest = onDocumentCreated('loadoutRequests/{id}', (event) =>
  fulfil(event.data, async (data) => {
    const claims = await claimsOf(data.uid);
    if (claims.role !== 'student') throw new UserError('Sign in as a student.');
    const studentRef = db.doc(`students/${claims.studentId}`);
    const schoolCatalog = await schoolCatalogFor(claims.schoolId);
    const name = String(data.name || '').replace(/[^A-Za-z0-9 ]/g, '').trim().slice(0, 20);
    const res = await db.runTransaction(async (tx) => {
      const student = (await tx.get(studentRef)).data();
      const presets = { ...(student.presets || {}) };
      const prior = student.loadout || rewards.starterLoadout;
      if (data.action === 'deletePreset') {
        delete presets[name];
        tx.update(studentRef, { presets });
        return { presets };
      }
      let loadout = data.loadout;
      if (data.action === 'applyPreset') {
        if (!presets[name]) throw new UserError('That preset was not found.');
        loadout = presets[name];
      }
      const v = R.validateLoadout(loadout, student, { schoolCatalog });
      if (!v.ok) throw new UserError(v.errors[0]);
      const patch = {};
      if (data.action === 'savePreset') {
        if (!name) throw new UserError('Give your preset a name.');
        if (!presets[name] && Object.keys(presets).length >= rewards.maxPresets) throw new UserError(`You can save up to ${rewards.maxPresets} presets.`);
        presets[name] = v.loadout;
        patch.presets = presets;
      } else {
        patch.loadout = v.loadout;
        // Equipping acknowledges "new" on the items involved.
        for (const id of Object.values(v.loadout)) if (id && student.inventory?.[id]?.isNew) patch[`inventory.${id}.isNew`] = false;
      }
      tx.update(studentRef, patch);
      return { loadout: v.loadout, prior, presets };
    });
    if (data.action !== 'deletePreset' && data.action !== 'savePreset') {
      const changed = Object.keys(res.loadout).filter((k) => res.loadout[k] !== res.prior?.[k]);
      await activity(studentRef, 'COSMETIC_EQUIPPED', { slots: changed, items: changed.map((k) => res.loadout[k]), prior: changed.map((k) => res.prior?.[k] ?? null) });
    }
    return { loadout: res.loadout || null, presets: res.presets };
  })
);

// ---------------------------------------------------------------------------
// Crafting: spend Crafting Stars on a specific chosen item (never random).

exports.onCraftRequest = onDocumentCreated('craftRequests/{id}', (event) =>
  fulfil(event.data, async (data) => {
    const claims = await claimsOf(data.uid);
    if (claims.role !== 'student') throw new UserError('Sign in as a student.');
    const item = R.ITEMS[data.itemId];
    if (!item) throw new UserError('Unknown item.');
    if (item.school || item.unlock.type !== 'chest') throw new UserError(`${item.name} can't be crafted. ${R.unlockLabel(item)}.`);
    const cost = R.RARITY[item.rarity].craftCost;
    if (!cost) throw new UserError(`${item.name} can't be crafted.`);
    const studentRef = db.doc(`students/${claims.studentId}`);
    const at = now();
    const grant = await db.runTransaction(async (tx) => {
      const student = (await tx.get(studentRef)).data();
      if (R.owns(student, item.id)) throw new UserError('You already have that one.');
      if ((student.craftingStars || 0) < cost) throw new UserError(`You need ${cost} Crafting Stars.`);
      const g = R.makeItemGrant(`craft-${item.id}`, item.id, { rule: 'craft', cost }, at);
      const { fresh, patch } = await commitGrants(tx, studentRef, student, [g]);
      if (!fresh.length) throw new UserError('You already crafted that one.');
      tx.update(studentRef, { inventory: patch.inventory, craftingStars: (student.craftingStars || 0) - cost });
      return g;
    });
    await activity(studentRef, 'REWARD_GRANTED', { grantId: grant.id, itemId: item.id, source: 'craft' });
    return { grantId: grant.id, itemId: item.id };
  })
);

// ---------------------------------------------------------------------------
// Teacher-awarded school gear (e.g. "{mascot} Cape" for a milestone).

exports.onAwardRequest = onDocumentCreated('awardRequests/{id}', (event) =>
  fulfil(event.data, async (data) => {
    const claims = await claimsOf(data.uid);
    if (claims.role !== 'teacher') throw new UserError('Only teachers can award gear.');
    const item = R.ITEMS[data.itemId];
    if (!item || !item.school) throw new UserError('Teachers can award school gear only.');
    const studentRef = db.doc(`students/${data.studentId}`);
    const schoolCatalog = await schoolCatalogFor(claims.schoolId);
    if (schoolCatalog?.approved && !schoolCatalog.approved.includes(item.id)) throw new UserError('That item is not approved for your school.');
    const at = now();
    const grant = await db.runTransaction(async (tx) => {
      const student = (await tx.get(studentRef)).data();
      if (!student || student.teacherUid !== data.uid) throw new UserError('Pick one of your students.');
      const g = R.makeItemGrant(`award-${item.id}`, item.id, { rule: 'teacher_award', teacherUid: data.uid, note: String(data.note || '').slice(0, 120) }, at);
      const { fresh, patch } = await commitGrants(tx, studentRef, student, [g]);
      if (!fresh.length) throw new UserError('That student already has this award.');
      tx.update(studentRef, patch);
      return g;
    });
    await activity(studentRef, 'REWARD_GRANTED', { grantId: grant.id, itemId: item.id, source: 'teacher_award' });
    await notify({ toStudentId: data.studentId, kind: 'reward', title: 'Your teacher gave you new gear!', body: item.name, link: '/play/garage' });
    await audit('reward.teacher_award', { actorUid: data.uid, actorRole: 'teacher', target: `students/${data.studentId}`, schoolId: claims.schoolId, details: { itemId: item.id } });
    return { grantId: grant.id };
  })
);

// ---------------------------------------------------------------------------
// School quests: shared weekly goal across every class in a school.

async function progressSchoolQuests(schoolId, studentId, summary, at) {
  if (!schoolId) return [];
  const snap = await db.collection('schoolQuests').where('schoolId', '==', schoolId).where('endsAt', '>', at).get();
  const completed = [];
  for (const q of snap.docs) {
    const d = q.data();
    if ((d.startsAt || 0) > at || d.completedAt) continue;
    const metric = d.metric === 'answered' ? 'answered' : 'correct';
    const n = d.category ? summary.byCategory?.[d.category]?.[metric] || 0 : summary[metric] || 0;
    if (!n) continue;
    const done = await db.runTransaction(async (tx) => {
      const cur = (await tx.get(q.ref)).data();
      const progress = (cur.progress || 0) + n;
      const upd = { progress, [`contributions.${studentId}`]: FieldValue.increment(n) };
      const finished = !cur.completedAt && progress >= cur.target;
      if (finished) upd.completedAt = at;
      tx.update(q.ref, upd);
      return finished;
    });
    if (done) completed.push(q.id);
  }
  return completed;
}

/** When a school quest completes, every contributor earns the school chest (once per quest). */
exports.onSchoolQuestCompleted = onDocumentWritten('schoolQuests/{id}', async (event) => {
  const before = event.data.before.data();
  const after = event.data.after.data();
  if (!after?.completedAt || before?.completedAt) return;
  const schoolCatalog = await schoolCatalogFor(after.schoolId);
  const contributors = Object.entries(after.contributions || {}).filter(([, n]) => n > 0).map(([id]) => id);
  for (const studentId of contributors) {
    const studentRef = db.doc(`students/${studentId}`);
    const at = now();
    await db.runTransaction(async (tx) => {
      const student = (await tx.get(studentRef)).data();
      if (!student) return;
      const contents = R.pickChestContents('chest-school', student, { schoolCatalog, random: true, seed: `${studentId}:${event.params.id}` });
      const g = R.makeChestGrant(`schoolquest-${event.params.id}`, 'chest-school', contents, { rule: 'school-quest', questId: event.params.id }, at);
      const { patch } = await commitGrants(tx, studentRef, student, [g]);
      if (Object.keys(patch).length) tx.update(studentRef, patch);
    });
    await notify({ toStudentId: studentId, kind: 'reward', title: `${after.title} complete!`, body: 'Your school chest is ready to open.', link: '/play/vault' });
  }
  await audit('school_quest.completed', { actorRole: 'system', target: `schoolQuests/${event.params.id}`, schoolId: after.schoolId, details: { contributors: contributors.length } });
});

// ---------------------------------------------------------------------------
// Organization theme: schools/{id}.theme is projected to schoolThemes/{id},
// which every member of the school (students included) may read.

exports.onSchoolThemeWritten = onDocumentWritten('schools/{schoolId}', async (event) => {
  const after = event.data.after.data();
  const ref = db.doc(`schoolThemes/${event.params.schoolId}`);
  if (!after) {
    await ref.delete().catch(() => {});
    return;
  }
  const before = event.data.before.data();
  if (before && JSON.stringify(before.theme) === JSON.stringify(after.theme) && JSON.stringify(before.rewardCatalog) === JSON.stringify(after.rewardCatalog)) return;
  const theme = R.resolveTheme(after.theme);
  await ref.set({ ...theme, schoolName: after.name || '', rewardCatalog: after.rewardCatalog || null, updatedAt: now() });
});

// ---------------------------------------------------------------------------
// Quiz Hall peer cards: only teacher-approved fields, only when the class allows
// peer viewing AND the student opted in. Private by default.

const HALL_FIELDS = ['loadout', 'level', 'featuredBadge', 'featuredItems', 'worldsMastered', 'teamRank'];

async function syncHallCard(studentId, student) {
  const ref = db.doc(`hallCards/${studentId}`);
  if (!student || student.active === false) return ref.delete().catch(() => {});
  const classroom = (await db.doc(`classrooms/${student.classroomId}`).get()).data();
  const settings = classRewardSettings(classroom);
  const optedIn = student.hall?.visibility === 'class';
  if (!settings.hallPeerView || !optedIn) return ref.delete().catch(() => {});
  const allowed = new Set(settings.hallPeerFields || []);
  const hidden = new Set(student.hall?.hidden || []);
  const card = { classroomId: student.classroomId, displayName: student.displayName, updatedAt: now() };
  if (allowed.has('loadout')) card.loadout = student.loadout || rewards.starterLoadout;
  if (allowed.has('level')) {
    card.level = student.level || 1;
    card.title = student.title || 'Rookie';
  }
  if (allowed.has('featuredBadge') && student.hall?.featuredBadge && (student.badges || []).includes(student.hall.featuredBadge)) card.featuredBadge = student.hall.featuredBadge;
  if (allowed.has('featuredItems')) card.featuredItems = (student.hall?.featuredItems || []).filter((id) => R.owns(student, id) && !hidden.has(id)).slice(0, 6);
  if (allowed.has('worldsMastered')) card.worldsMastered = student.masteredWorlds || [];
  await ref.set(card);
}

exports.onHallRelevantChange = onDocumentWritten('students/{studentId}', async (event) => {
  const before = event.data.before.data();
  const after = event.data.after.data();
  const keys = ['hall', 'loadout', 'level', 'badges', 'masteredWorlds', 'displayName', 'active', 'inventory'];
  if (before && after && keys.every((k) => JSON.stringify(before[k]) === JSON.stringify(after[k]))) return;
  if (before && after && JSON.stringify(before.hall) !== JSON.stringify(after.hall)) {
    await db.doc(`students/${event.params.studentId}`).collection('events').doc().set({ type: 'QUIZ_HALL_UPDATED', at: now(), fields: Object.keys(after.hall || {}) });
  }
  await syncHallCard(event.params.studentId, after);
});

/** Class setting changes (peer view on/off, fields) re-sync every card in the class. */
exports.onClassRewardSettings = onDocumentWritten('classrooms/{classroomId}', async (event) => {
  const b = event.data.before.data()?.settings?.rewards;
  const a = event.data.after.data()?.settings?.rewards;
  if (JSON.stringify(a) === JSON.stringify(b)) return;
  const students = await db.collection('students').where('classroomId', '==', event.params.classroomId).get();
  for (const s of students.docs) await syncHallCard(s.id, s.data());
});

// ---------------------------------------------------------------------------
// Reveal acknowledged (viewed or skipped): EARNED_NEW -> OWNED.

const { onDocumentUpdated } = require('firebase-functions/v2/firestore');

exports.onGrantAcknowledged = onDocumentUpdated('students/{studentId}/grants/{grantId}', async (event) => {
  const before = event.data.before.data();
  const g = event.data.after.data();
  if (!g?.acknowledgedAt || before?.acknowledgedAt) return;
  const studentRef = db.doc(`students/${event.params.studentId}`);
  if (g.itemId) await studentRef.update({ [`inventory.${g.itemId}.isNew`]: false }).catch(() => {});
  await activity(studentRef, 'REWARD_REVEALED', { grantId: event.params.grantId, skipped: !!g.skipped, revealType: g.revealType || null });
});

// ---------------------------------------------------------------------------
// Admin: preview a reward scenario without granting anything.

exports.onRulePreview = onDocumentCreated('rulePreviews/{id}', (event) =>
  fulfil(event.data, async (data) => {
    const claims = await claimsOf(data.uid);
    if (!claims.platformAdmin && !claims.contentAdmin) throw new UserError('Admins only.');
    const sc = data.scenario || {};
    const base = { level: Number(sc.levelFrom) || 1, streak: { current: Number(sc.streakFrom) || 0, best: Number(sc.streakFrom) || 0, lastDay: '2026-01-01' }, inventory: {}, badges: sc.badges || [], beatenPersonas: sc.firstWin ? [] : ['x'], masteredWorlds: [] };
    const after = {
      ...base,
      level: Number(sc.levelTo) || base.level,
      streak: { current: Number(sc.streakTo) || 0, best: Number(sc.streakTo) || 0, lastDay: '2026-01-02' },
      masteredWorlds: sc.masteredWorld ? [sc.masteredWorld] : []
    };
    const grants = R.grantsForSession({
      before: base,
      after,
      sessionId: 'preview',
      pub: { opponent: sc.firstWin ? { personaId: 'rookie-robot' } : null },
      won: !!sc.firstWin,
      at: now(),
      classRewards: { randomChests: sc.randomChests !== false },
      world: sc.masteredWorld || null
    });
    return { grants: grants.map((g) => ({ id: g.id, type: g.type, chestId: g.chestId, itemId: g.itemId, rarity: g.rarity, craftingStars: g.craftingStars })) };
  })
);

module.exports = Object.assign(module.exports, { sessionGrants, commitGrants, progressSchoolQuests, classRewardSettings, schoolCatalogFor, syncHallCard, activity });
