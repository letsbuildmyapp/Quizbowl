'use strict';

// v2 reward economy through the emulator: map claims (idempotent), loadouts,
// crafting, teacher awards, school quests + theme projection, Quiz Hall cards.

const test = require('node:test');
const assert = require('node:assert/strict');
const { updateDoc, doc, setDoc, serverTimestamp, addDoc, collection } = require('firebase/firestore');
const { clientPool, classFixture, loginStudent, quickPractice, admin, until } = require('./fixtures');

const client = clientPool();
test.after(() => client.closeAll());

let fx;
let sc;
let student;

test.before(async () => {
  fx = await classFixture(client, { students: ['Robo', 'Zed'], tag: 'rewards' });
  sc = client();
  student = fx.roster[0];
  await loginStudent(sc, fx.cls.code, student);
});

test('map star + chest claims are idempotent and gated by their rules', { timeout: 90000 }, async () => {
  const sid = student.id;
  const locked = await sc.request('mapClaims', { objectId: 'star-science-1' }, `${sid}_star-science-1`);
  assert.equal(locked.status, 'error');
  assert.match(locked.error, /Complete 1 Science Lab quest/);

  // Give the student progress server-side (as a finished quest would).
  await admin().doc(`students/${sid}`).update({ worldQuests: { 'science-lab': 2 } });
  // A failed claim can be retried by rewriting the same doc (status 'pending').
  const retried = await sc.request('mapClaims', { objectId: 'star-science-1' }, `${sid}_star-science-1`);
  assert.equal(retried.status, 'done', retried.error);
  const ok = await sc.request('mapClaims', { objectId: 'star-science-2' }, `${sid}_star-science-2`);
  assert.equal(ok.status, 'done', ok.error);
  assert.equal(ok.result.type, 'star');
  // Same claim again after success: the rules refuse to rewrite a done claim.
  await assert.rejects(setDoc(doc(sc.db, 'mapClaims', `${sid}_star-science-2`), { objectId: 'star-science-2', uid: sc.auth.currentUser.uid, status: 'pending', createdAt: serverTimestamp() }));
  // Claim ids must belong to the caller.
  await assert.rejects(setDoc(doc(sc.db, 'mapClaims', `someoneelse_star-science-2`), { objectId: 'star-science-2', uid: sc.auth.currentUser.uid, status: 'pending', createdAt: serverTimestamp() }));

  assert.equal((await sc.get(`students/${sid}`)).questStars, 2);
  const chest = await sc.request('mapClaims', { objectId: 'mapchest-science' }, `${sid}_mapchest-science`);
  assert.equal(chest.status, 'done', chest.error);
  assert.equal(chest.result.type, 'chest');
  const grant = await sc.get(`students/${sid}/grants/${chest.result.grantId}`);
  assert.equal(grant.chestId, 'chest-common');
  assert.equal(grant.acknowledgedAt, null);
  const me = await sc.get(`students/${sid}`);
  if (grant.itemId) assert.ok(me.inventory[grant.itemId], 'item is in inventory before any reveal');

  // Reveal acknowledgement: only ack fields, only once.
  await updateDoc(doc(sc.db, `students/${sid}/grants/${grant.id}`), { acknowledgedAt: serverTimestamp(), skipped: true, revealType: 'chest' });
  await assert.rejects(updateDoc(doc(sc.db, `students/${sid}/grants/${grant.id}`), { itemId: 'head-crown' }));
  if (grant.itemId) await until(async () => (await sc.get(`students/${sid}`)).inventory[grant.itemId].isNew === false, 20000, 400, 'isNew cleared');
});

test('loadout: preview is client-only, equip is validated, presets are capped', { timeout: 60000 }, async () => {
  const bad = await sc.request('loadoutRequests', { action: 'equip', loadout: { paint: 'paint-sky', face: 'face-smile', headgear: 'head-crown' } });
  assert.equal(bad.status, 'error');
  assert.match(bad.error, /isn't unlocked/);
  const good = await sc.request('loadoutRequests', { action: 'equip', loadout: { paint: 'paint-mint', face: 'face-visor', held: 'buzzer-classic', emote: 'emote-wave' } });
  assert.equal(good.status, 'done', good.error);
  assert.equal((await sc.get(`students/${student.id}`)).loadout.paint, 'paint-mint');
  // Students can't write loadout/inventory directly.
  await assert.rejects(updateDoc(doc(sc.db, `students/${student.id}`), { loadout: { paint: 'paint-gold', face: 'face-smile' } }));
  await assert.rejects(updateDoc(doc(sc.db, `students/${student.id}`), { craftingStars: 999 }));
  for (const name of ['Space', 'Westside', 'Tournament']) {
    const r = await sc.request('loadoutRequests', { action: 'savePreset', name, loadout: { paint: 'paint-sunset', face: 'face-smile' } });
    assert.equal(r.status, 'done', r.error);
  }
  const fourth = await sc.request('loadoutRequests', { action: 'savePreset', name: 'Extra', loadout: { paint: 'paint-sky', face: 'face-smile' } });
  assert.equal(fourth.status, 'error');
  const applied = await sc.request('loadoutRequests', { action: 'applyPreset', name: 'Space' });
  assert.equal(applied.result.loadout.paint, 'paint-sunset');
});

test('crafting spends Crafting Stars on a chosen item and refuses school gear', { timeout: 60000 }, async () => {
  const poor = await sc.request('craftRequests', { itemId: 'pet-dragon' });
  assert.equal(poor.status, 'error');
  await admin().doc(`students/${student.id}`).update({ craftingStars: 70 });
  const school = await sc.request('craftRequests', { itemId: 'head-school' });
  assert.equal(school.status, 'error');
  const ok = await sc.request('craftRequests', { itemId: 'pet-dragon' });
  assert.equal(ok.status, 'done', ok.error);
  const me = await sc.get(`students/${student.id}`);
  assert.equal(me.craftingStars, 10);
  assert.ok(me.inventory['pet-dragon']);
});

test('teacher awards school gear once; other teachers cannot', { timeout: 60000 }, async () => {
  const r = await fx.tc.request('awardRequests', { studentId: student.id, itemId: 'back-school', note: 'Great teamwork' });
  assert.equal(r.status, 'done', r.error);
  const again = await fx.tc.request('awardRequests', { studentId: student.id, itemId: 'back-school', note: 'again' });
  assert.equal(again.status, 'error');
  const nonSchool = await fx.tc.request('awardRequests', { studentId: student.id, itemId: 'head-crown', note: '' });
  assert.equal(nonSchool.status, 'error');
  const other = await classFixture(client, { students: ['X'], tag: 'otherteacher' });
  const stolen = await other.tc.request('awardRequests', { studentId: student.id, itemId: 'shield-school', note: '' });
  assert.equal(stolen.status, 'error');
});

test('school theme projects to schoolThemes and a school quest pays every contributor a school chest', { timeout: 120000 }, async () => {
  const { schoolId } = fx.teacher;
  await updateDoc(doc(fx.tc.db, `schools/${schoolId}`), { theme: { presetId: 'westside-warriors' } });
  const theme = await until(async () => {
    const t = await sc.get(`schoolThemes/${schoolId}`).catch(() => null);
    return t?.mascotName === 'Warrior' ? t : null;
  }, 20000, 400, 'theme projection');
  assert.equal(theme.primaryColor, '#c8102e');
  assert.equal(theme.weeklyQuestLabel, 'Warrior Weekly Quest');
  // Only approved theme keys can be written.
  await assert.rejects(updateDoc(doc(fx.tc.db, `schools/${schoolId}`), { theme: { presetId: 'westside-warriors', hack: true } }));

  const q = await addDoc(collection(fx.tc.db, 'schoolQuests'), {
    schoolId,
    title: 'Warrior Weekly Quest',
    description: 'Try 1 question',
    category: null,
    metric: 'answered',
    target: 1,
    startsAt: Date.now() - 1000,
    endsAt: Date.now() + 86400000,
    progress: 0,
    contributions: {},
    createdBy: fx.teacher.uid,
    createdAt: serverTimestamp()
  });
  // Student can read the quest but not bump progress.
  await assert.rejects(updateDoc(doc(sc.db, `schoolQuests/${q.id}`), { progress: 99 }));
  await quickPractice(sc, student.id, { answerText: 'definitely wrong answer' });
  const done = await until(async () => {
    const d = await sc.get(`schoolQuests/${q.id}`);
    return d.completedAt ? d : null;
  }, 30000, 500, 'quest completion');
  assert.ok(done.progress >= 1);
  const g = await until(() => sc.get(`students/${student.id}/grants/schoolquest-${q.id}`).catch(() => null), 30000, 500, 'school chest grant');
  assert.equal(g.chestId, 'chest-school');
  assert.ok(!g.itemId || require('../../engine/rewards').ITEMS[g.itemId].school, 'school chest contains school gear');
});

test('Quiz Hall is private by default; peer card appears only when class and student both allow it', { timeout: 60000 }, async () => {
  const classmate = client();
  await loginStudent(classmate, fx.cls.code, fx.roster[1]);
  await updateDoc(doc(sc.db, `students/${student.id}`), { hall: { visibility: 'class', featuredItems: ['pet-dragon'], showStreak: false } });
  await new Promise((r) => setTimeout(r, 2500));
  await assert.rejects(classmate.get(`hallCards/${student.id}`)); // class hasn't enabled peer view
  await updateDoc(doc(fx.tc.db, `classrooms/${fx.cls.classroomId}`), { 'settings.rewards': { hallPeerView: true, hallPeerFields: ['loadout', 'level'] } });
  const card = await until(() => classmate.get(`hallCards/${student.id}`).catch(() => null), 20000, 500, 'hall card');
  assert.ok(card.loadout);
  assert.equal(card.featuredItems, undefined, 'featuredItems not approved by the teacher');
  // Invalid hall shapes are refused.
  await assert.rejects(updateDoc(doc(sc.db, `students/${student.id}`), { hall: { visibility: 'public' } }));
  await assert.rejects(updateDoc(doc(sc.db, `students/${student.id}`), { hall: { bio: 'hi' } }));
});

test('a finished match writes grants into the summary before any reveal', { timeout: 90000 }, async () => {
  // Force a level-up across level 5 so the level chest triggers.
  await admin().doc(`students/${student.id}`).update({ xp: 790, level: 4 });
  const { summary } = await quickPractice(sc, student.id);
  assert.ok(Array.isArray(summary.grants));
  const lvl = summary.grants.find((g) => g.id === 'level-5');
  assert.ok(lvl, 'level-5 chest granted');
  const grant = await sc.get(`students/${student.id}/grants/level-5`);
  assert.equal(grant.acknowledgedAt, null);
});

test('world battles: locked worlds refused, wild picks a world creature, boss gated then rewards badge + chest + QuizDex', { timeout: 240000 }, async () => {
  const { answerKey, drive } = require('./fixtures');
  const R = require('../../engine/rewards');
  const sid = student.id;
  const locked = await sc.request('sessionRequests', { mode: 'versus', options: { world: 'history-kingdom', battle: 'wild' } });
  assert.equal(locked.status, 'error');
  assert.match(locked.error, /locked/);

  await admin().doc(`students/${sid}`).update({ worldQuests: { 'science-lab': 1 } });
  const bossTooEarly = await sc.request('sessionRequests', { mode: 'versus', options: { world: 'science-lab', battle: 'boss' } });
  assert.equal(bossTooEarly.status, 'error');
  assert.match(bossTooEarly.error, /Complete 2 Science Lab quests/);

  const wild = await sc.request('sessionRequests', { mode: 'versus', options: { world: 'science-lab', battle: 'wild' } });
  assert.equal(wild.status, 'done', wild.error);
  const ws = await sc.get(`sessions/${wild.result.sessionId}`);
  assert.equal(ws.total, 3);
  assert.equal(ws.battle, 'wild');
  assert.ok(['beaker-blob', 'atom-pup'].includes(ws.rival.id));
  assert.ok(ws.history.length === 0 && ws.category === 'Science');

  await admin().doc(`students/${sid}`).update({ worldQuests: { 'science-lab': 2 } });
  const boss = await sc.request('sessionRequests', { mode: 'versus', options: { world: 'science-lab', battle: 'boss' } });
  assert.equal(boss.status, 'done', boss.error);
  const bid = boss.result.sessionId;
  let bs = await sc.get(`sessions/${bid}`);
  assert.equal(bs.rival.id, 'professor-fizz');
  assert.equal(bs.opponent.specialty, 'Science');
  // Win the boss: buzz immediately and answer correctly every time.
  await sc.command(bid, 'start', {}, sid);
  const buzzed = new Set();
  bs = await drive(sc, bid, sid, async (st) => {
    if (st.status === 'READING_CLUE' && !buzzed.has(st.qIndex) && !st.current.lockedSides.includes('A')) {
      buzzed.add(st.qIndex);
      return { type: 'buzz', payload: { seenClueIndex: 0 } };
    }
    if (st.status === 'AWAITING_ANSWER' && st.current.buzz?.actorId === sid) {
      return { type: 'answer', payload: { text: (await answerKey(st.current.questionId)).canonicalAnswer } };
    }
    if (st.status === 'BONUS') return { type: 'skip' };
    return null;
  });
  assert.equal(bs.result.winnerSide, 'A');
  const summary = await sc.waitDoc(`sessionSummaries/${bid}_${sid}`, (d) => !!d, 30000);
  assert.ok(summary.grants.some((g) => g.id === 'boss-science-lab'), 'boss chest granted');
  const me = await sc.get(`students/${sid}`);
  assert.ok(me.badges.includes('champion-science-lab'));
  assert.ok(me.bossesDefeated.includes('science-lab'));
  assert.equal(me.dex['professor-fizz'].wins, 1);
  assert.equal(me.dex['professor-fizz'].kind, 'boss');
  assert.ok(R.CHESTS[(await sc.get(`students/${sid}/grants/boss-science-lab`)).chestId]);
});
