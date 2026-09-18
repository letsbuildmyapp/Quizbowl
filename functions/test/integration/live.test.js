'use strict';

// Live team battle hosted by a teacher: per-team lockout after a wrong answer,
// bonus only for the side that won the tossup, summaries for every player.

const test = require('node:test');
const assert = require('node:assert/strict');
const { collection, getDocs } = require('firebase/firestore');
const { clientPool, classFixture, loginStudent, answerKey } = require('./fixtures');
const { waitFor } = require('./client');

const client = clientPool();
test.after(() => client.closeAll());

test('live battle: lockout, other team steals, bonus to winners only, summaries for all', { timeout: 300000 }, async () => {
  const fx = await classFixture(client, { students: ['Ari', 'Bea', 'Col'], tag: 'live' });
  const [a1, a2, b1] = fx.roster;
  const tc = fx.tc;
  const tuid = fx.teacher.uid;
  const players = {};
  for (const st of [a1, a2, b1]) {
    const c = client();
    await loginStudent(c, fx.cls.code, st);
    players[st.id] = c;
  }
  const A1 = players[a1.id];
  const A2 = players[a2.id];
  const B1 = players[b1.id];

  const req = await tc.request('sessionRequests', {
    mode: 'live_battle',
    options: { classroomId: fx.cls.classroomId, teamA: { name: 'Owls', studentIds: [a1.id, a2.id] }, teamB: { name: 'Foxes', studentIds: [b1.id] }, count: 3 }
  });
  assert.equal(req.status, 'done', req.error);
  const sid = req.result.sessionId;
  const path = `sessions/${sid}`;
  let s = await tc.get(path);
  assert.equal(s.mode, 'live_battle');
  assert.equal(s.total, 3);
  assert.deepEqual(s.participantIds.sort(), [a1.id, a2.id, b1.id].sort());
  assert.equal(s.participants.find((p) => p.id === a2.id).side, 'A');
  assert.equal(s.participants.find((p) => p.id === b1.id).side, 'B');
  // Every player can see the shared session.
  for (const c of [A1, A2, B1]) assert.equal((await c.get(path)).id, sid);

  const cmdResult = (c, ref) => waitFor(ref, (d) => d && d.processed === true, 20000).catch(async () => (await c.get(ref.path)) || {});
  const after = (seq, pred = () => true) => tc.waitDoc(path, (d) => d.seq > seq && pred(d), 20000);

  // Only the host starts; a student can't.
  const bad = await A1.command(sid, 'start', {}, a1.id);
  assert.equal((await cmdResult(A1, bad)).error?.code, 'forbidden');
  await tc.command(sid, 'start', {}, tuid);
  s = await tc.waitDoc(path, (d) => d.status === 'READING_CLUE');

  // --- Q1: team A buzzes and misses -> A locked out; A2's buzz is rejected; B steals.
  await A1.command(sid, 'buzz', { seenClueIndex: 0 }, a1.id);
  s = await tc.waitDoc(path, (d) => d.status === 'AWAITING_ANSWER');
  assert.equal(s.current.buzz.actorId, a1.id);
  // Only the buzzer may answer.
  const steal = await B1.command(sid, 'answer', { text: 'x' }, b1.id);
  assert.equal((await cmdResult(B1, steal)).error?.code, 'forbidden');
  await A1.command(sid, 'answer', { text: 'definitely not the answer' }, a1.id);
  s = await tc.waitDoc(path, (d) => d.current.lockedSides.includes('A'));
  assert.equal(s.status, 'READING_CLUE', 'reading resumes for team B');

  const lockedRef = await A2.command(sid, 'buzz', {}, a2.id);
  const locked = await cmdResult(A2, lockedRef);
  assert.equal(locked.processed, true);
  assert.equal(locked.error?.code, 'locked-out');
  s = await tc.get(path);
  assert.equal(s.status, 'READING_CLUE');

  await B1.command(sid, 'buzz', {}, b1.id);
  s = await tc.waitDoc(path, (d) => d.status === 'AWAITING_ANSWER' && d.current.buzz?.actorId === b1.id);
  const key = await answerKey(s.current.questionId);
  await B1.command(sid, 'answer', { text: key.canonicalAnswer }, b1.id);
  s = await tc.waitDoc(path, (d) => d.status === 'SCORED');
  assert.equal(s.current.outcome.winnerSide, 'B');
  // Students can't pace or skip a live battle.
  for (const type of ['advance', 'skip']) {
    const r = await B1.command(sid, type, {}, b1.id);
    assert.equal((await cmdResult(B1, r)).error?.code, 'forbidden', `student ${type}`);
  }
  assert.equal((await tc.get(path)).status, 'SCORED');
  const q1 = s.history[0];
  assert.deepEqual(q1.attempts.map((a) => [a.actorId, a.result]), [[a1.id, 'incorrect'], [b1.id, 'correct']]);

  // --- Bonus: only the winning side (B) may answer.
  await tc.command(sid, 'advance', {}, tuid);
  s = await tc.waitDoc(path, (d) => d.status === 'BONUS');
  assert.equal(s.bonus.side, 'B');
  const bonusKey = await answerKey(s.bonus.questionId);
  const wrongSide = await A1.command(sid, 'answer', { text: bonusKey.parts[0].canonicalAnswer, part: 0 }, a1.id);
  assert.equal((await cmdResult(A1, wrongSide)).error?.code, 'forbidden');
  for (let part = 0; part < bonusKey.parts.length; part++) {
    const seq = (await tc.get(path)).seq;
    const text = part === 0 ? bonusKey.parts[0].canonicalAnswer : 'no idea';
    await B1.command(sid, 'answer', { text, part }, b1.id);
    s = await after(seq);
  }
  assert.equal(s.status, 'SCORED');
  assert.equal(s.scoredPhase, 'bonus');
  const bonus = s.history[0].bonus;
  assert.equal(bonus.side, 'B');
  assert.equal(bonus.correctParts, 1);
  assert.ok(s.bonus.results.every((r) => r.actorId === b1.id));
  const scoreB = s.sides.B.score;
  assert.equal(s.sides.A.score, 0);
  assert.equal(scoreB, s.history[0].attempts[1].points + 10); // tossup + one bonus part

  // --- Q2, Q3: both teams miss (no bonus), teacher advances.
  for (let q = 1; q < 3; q++) {
    await tc.command(sid, 'advance', {}, tuid);
    s = await tc.waitDoc(path, (d) => d.status === 'READING_CLUE' && d.qIndex === q);
    await A2.command(sid, 'buzz', {}, a2.id);
    await tc.waitDoc(path, (d) => d.status === 'AWAITING_ANSWER');
    await A2.command(sid, 'answer', { text: 'nope nope' }, a2.id);
    await tc.waitDoc(path, (d) => d.status === 'READING_CLUE' && d.current.lockedSides.includes('A'));
    await B1.command(sid, 'buzz', {}, b1.id);
    await tc.waitDoc(path, (d) => d.status === 'AWAITING_ANSWER');
    await B1.command(sid, 'answer', { text: 'nope nope' }, b1.id);
    s = await tc.waitDoc(path, (d) => d.status === 'SCORED' && d.qIndex === q);
    assert.equal(s.current.outcome.winnerSide, null);
  }
  await tc.command(sid, 'advance', {}, tuid);
  s = await tc.waitDoc(path, (d) => d.status === 'COMPLETE');
  assert.equal(s.result.winnerSide, 'B');

  // Summaries for every player, with their team.
  const sums = {};
  for (const st of [a1, a2, b1]) sums[st.id] = await players[st.id].waitDoc(`sessionSummaries/${sid}_${st.id}`, (d) => !!d, 30000);
  assert.equal(sums[a1.id].liveTeam, 'Owls');
  assert.equal(sums[b1.id].liveTeam, 'Foxes');
  assert.equal(sums[b1.id].won, true);
  assert.equal(sums[a1.id].won, false);
  assert.equal(sums[b1.id].correct, 1);
  assert.equal(sums[b1.id].bonusParts, bonusKey.parts.length);
  assert.equal(sums[b1.id].bonusCorrect, 1);
  assert.equal(sums[a1.id].bonusParts, 0);
  assert.equal(sums[a1.id].answered, 1);
  assert.equal(sums[a2.id].answered, 2);
  // Teacher sees the whole event log including the lockout rejection.
  const evs = (await getDocs(collection(tc.db, `sessions/${sid}/events`))).docs.map((d) => d.data());
  assert.ok(evs.some((e) => e.type === 'buzz_rejected' && e.actor === a2.id && e.data.reason === 'locked-out'));
});
