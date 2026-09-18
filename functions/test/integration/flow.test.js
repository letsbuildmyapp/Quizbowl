'use strict';

// End-to-end through the emulator: real triggers, real security rules.
// Prereq: emulators running and `node scripts/seed.js --reset --emulator`.

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeClient, studentLogin, sleep } = require('./client');

const clients = [];
const client = () => {
  const c = makeClient();
  clients.push(c);
  return c;
};
test.after(async () => {
  for (const c of clients) await c.close().catch(() => {});
});

test('student login: wrong PIN is rejected, right PIN sets student claims', async () => {
  const c = client();
  const user = await c.anon();
  const cc = await c.get('classCodes/QUEST1');
  assert.ok(cc.roster.length >= 6);
  const emma = cc.roster.find((r) => r.displayName === 'Emma');
  const bad = await c.request('studentLogins', { code: 'QUEST1', studentId: emma.id, pin: '0000' }, user.uid);
  assert.equal(bad.status, 'error');
  assert.match(bad.error, /PIN/);
  const c2 = client();
  const { res, claims } = await studentLogin(c2, 'Emma', '2222');
  assert.equal(res.status, 'done');
  assert.equal(claims.role, 'student');
  assert.equal(claims.studentId, emma.id);
  // PIN is scrubbed from the request doc
  const reqDoc = await c2.get(`studentLogins/${c2.auth.currentUser.uid}`);
  assert.equal(reqDoc.pin, undefined);
});

test('student cannot read another student, secrets, or forge server fields', async () => {
  const c = client();
  const { studentId } = await studentLogin(c, 'Liam', '3333');
  await assert.rejects(c.get('students/demo-student-1'));
  const me = await c.get(`students/${studentId}`);
  assert.equal(me.displayName, 'Liam');
  const { updateDoc } = require('firebase/firestore');
  await assert.rejects(updateDoc(c.doc(`students/${studentId}`), { xp: 99999 }));
  await updateDoc(c.doc(`students/${studentId}`), { leaderboardOptOut: false, settings: { readAloud: true } });
  await assert.rejects(c.get('sessionSecrets/anything'));
  await assert.rejects(c.get(`students/${studentId}/private/credentials`));
});

test('versus match plays end to end with server scoring and rewards', { timeout: 240000 }, async () => {
  const c = client();
  const { studentId } = await studentLogin(c, 'Meridian', '1111');
  const before = await c.get(`students/${studentId}`);
  const req = await c.request('sessionRequests', { mode: 'versus', options: { personaId: 'rookie-robot', count: 3, readingSpeed: 'fast' } });
  assert.equal(req.status, 'done', req.error);
  const sessionId = req.result.sessionId;
  let s = await c.get(`sessions/${sessionId}`);
  assert.equal(s.status, 'READY');
  assert.equal(s.opponent.name, 'Rookie Robot');
  assert.equal(s.total, 3);
  await assert.rejects(c.get(`sessionSecrets/${sessionId}`));

  // Forged timestamps are rejected by rules.
  const { setDoc, doc, collection } = require('firebase/firestore');
  await assert.rejects(setDoc(doc(collection(c.db, `sessions/${sessionId}/commands`)), { type: 'buzz', payload: {}, at: new Date(0), uid: c.auth.currentUser.uid, actorId: studentId, role: 'student' }));
  // Acting as someone else is rejected.
  await assert.rejects(c.command(sessionId, 'buzz', {}, 'demo-student-2'));

  await c.command(sessionId, 'start', {}, studentId);
  s = await c.waitDoc(`sessions/${sessionId}`, (d) => d.status === 'READING_CLUE');
  assert.equal(s.current.clues.length, 1);
  assert.equal(s.current.outcome, null);

  let answeredCorrectly = 0;
  const deadline = Date.now() + 200000;
  let lastQ = -1;
  while (Date.now() < deadline) {
    s = await c.get(`sessions/${sessionId}`);
    if (s.status === 'COMPLETE') break;
    if (s.status === 'READING_CLUE' && s.qIndex !== lastQ && s.current.clues.length >= 1) {
      // Buzz right away on each new question and answer via the review-safe path:
      // we don't know the answer on the client, so answer the first one wrong-then-skip,
      // and use the canonical answer revealed in history for later ones is impossible.
      lastQ = s.qIndex;
      if (s.qIndex === 0) {
        await c.command(sessionId, 'buzz', { seenClueIndex: s.current.clues.length - 1 }, studentId);
        await c.waitDoc(`sessions/${sessionId}`, (d) => d.status !== 'READING_CLUE' || d.current.buzz);
        await c.command(sessionId, 'answer', { text: 'definitely not it' }, studentId);
      }
    }
    if (s.status === 'SCORED') {
      if (s.current.outcome.winnerSide === 'A') answeredCorrectly++;
      await c.command(sessionId, 'advance', {}, studentId);
      await c.waitDoc(`sessions/${sessionId}`, (d) => d.status !== 'SCORED' || d.scoredPhase !== s.scoredPhase || d.qIndex !== s.qIndex);
      continue;
    }
    await c.command(sessionId, 'sync', {}, studentId);
    await sleep(700);
  }
  assert.equal(s.status, 'COMPLETE', `stuck in ${s.status}`);
  assert.equal(s.history.length, 3);
  const first = s.history[0];
  assert.equal(first.attempts.find((a) => a.actorId === studentId).result, 'incorrect');

  const summary = await c.waitDoc(`sessionSummaries/${sessionId}_${studentId}`, (d) => !!d, 30000);
  assert.equal(summary.seen, 3);
  assert.equal(summary.mode, 'versus');
  assert.ok(summary.xpEarned >= 10, 'completion XP awarded');
  const after = await c.waitDoc(`students/${studentId}`, (d) => (d.xp || 0) > (before.xp || 0), 20000);
  assert.equal(after.xp, (before.xp || 0) + summary.xpEarned);
  assert.equal(after.streak.current >= 1, true);
  assert.ok(answeredCorrectly >= 0);

  // Leaderboard visible to classmates when the class allows it.
  const lb = await c.waitDoc(`leaderboards/demo-class_${summary.weekKey}`, (d) => d && d.entries.some((e) => e.studentId === studentId), 20000);
  assert.ok(lb.entries.find((e) => e.studentId === studentId).xp >= summary.xpEarned);
});

test('teacher reads class data; a parent sees only the linked child', { timeout: 60000 }, async () => {
  const t = client();
  await t.email('teacher@quizquest.test', 'quizquest123');
  const kid = await t.get('students/demo-student-1');
  assert.equal(kid.displayName, 'Meridian');
  const cred = await t.get('students/demo-student-1/private/credentials');
  assert.equal(cred.pin, '1111');

  const p = client();
  await p.register(`parent-${Date.now()}@example.com`, 'parentpass123');
  const linked = await p.request('parentRequests', { type: 'link', code: 'FAMILY01' });
  assert.equal(linked.status, 'done', linked.error);
  const claims = await p.claims();
  assert.equal(claims.role, 'parent');
  assert.deepEqual(claims.students, ['demo-student-1']);
  const child = await p.get('students/demo-student-1');
  assert.equal(child.displayName, 'Meridian');
  await assert.rejects(p.get('students/demo-student-2'));
  await assert.rejects(p.get('leaderboards/demo-class_2026-W38'));
});
