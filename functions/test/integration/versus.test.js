'use strict';

// Computer opponents: a full 10-question versus match against each fixed
// persona. The student only syncs/skips/advances; we check the computer never
// buzzes faster than its tier's reaction floor.

const test = require('node:test');
const assert = require('node:assert/strict');
const { collection, getDocs } = require('firebase/firestore');
const { clientPool, classFixture, loginStudent, drive } = require('./fixtures');
const catalog = require('../../shared/catalog.json');

const client = clientPool();
test.after(() => client.closeAll());

const PERSONAS = [
  { id: 'rookie-robot', floor: 1800 },
  { id: 'questy-owl', floor: 1200 },
  { id: 'quiz-master', floor: 600 }
];

test('catalog floors match the spec', () => {
  for (const p of PERSONAS) {
    const persona = catalog.personas.find((x) => x.id === p.id);
    assert.equal(catalog.reactionFloorMs[persona.tier], p.floor);
  }
});

test('10-question versus vs rookie-robot, questy-owl, quiz-master respects reaction floors', { timeout: 420000 }, async () => {
  const fx = await classFixture(client, { students: ['Vee', 'Wes', 'Xan'], tag: 'versus' });

  async function play(persona, student) {
    const sc = client();
    await loginStudent(sc, fx.cls.code, student);
    const req = await sc.request('sessionRequests', { mode: 'versus', options: { personaId: persona.id, count: 10, readingSpeed: 'fast' } });
    assert.equal(req.status, 'done', req.error);
    const sid = req.result.sessionId;
    const s0 = await sc.get(`sessions/${sid}`);
    assert.equal(s0.opponent.personaId, persona.id);
    assert.equal(s0.total, 10);
    await sc.command(sid, 'start', {}, student.id);
    const skipped = new Set();
    const s = await drive(
      sc,
      sid,
      student.id,
      (st) => {
        if (st.status === 'READING_CLUE' && !skipped.has(st.qIndex) && !st.current.lockedSides.includes('A')) {
          skipped.add(st.qIndex);
          return { type: 'skip' };
        }
        if (st.status === 'BONUS' && st.bonus.side === 'A') return { type: 'skip' };
        return null;
      },
      { timeout: 360000, every: 300 }
    );
    assert.equal(s.status, 'COMPLETE', `${persona.id} match ended ${s.status}`);
    assert.equal(s.history.length, 10);
    return { sid, s, student };
  }

  const results = await Promise.all(PERSONAS.map((p, i) => play(p, fx.roster[i])));

  for (const [i, { sid, s, student }] of results.entries()) {
    const persona = PERSONAS[i];
    const evs = (await getDocs(collection(fx.tc.db, `sessions/${sid}/events`))).docs.map((d) => d.data());
    const cbuzz = evs.filter((e) => e.type === 'buzz' && e.data.actorType === 'computer');
    for (const e of cbuzz) {
      assert.ok(e.data.reactionMs >= persona.floor, `${persona.id} buzzed in ${e.data.reactionMs}ms < floor ${persona.floor}`);
    }
    // History attempts agree with the events.
    const cAttempts = s.history.flatMap((h) => h.attempts.filter((a) => a.kind === 'computer'));
    assert.equal(cAttempts.length, cbuzz.length);
    for (const a of cAttempts) assert.ok(a.reactionMs >= persona.floor);
    // A student skip must not cancel the computer's planned buzz: every planned buzz happens.
    const planned = s.history.filter((h) => h.computerPlan?.buzzClue != null).length;
    assert.equal(cbuzz.length, planned, `${persona.id}: ${planned} planned buzzes, ${cbuzz.length} happened`);
    // The student never buzzed.
    assert.equal(evs.filter((e) => e.type === 'buzz' && e.actor === student.id).length, 0);
    const done = await fx.tc.get(`sessions/${sid}`);
    assert.equal(done.opponent.personaId, persona.id);
    const summary = await fx.tc.waitDoc(`sessionSummaries/${sid}_${student.id}`, (d) => !!d, 30000);
    assert.equal(summary.opponent.personaId, persona.id);
    assert.equal(summary.seen, 10);
    assert.equal(summary.answered, 0);
    console.log(`# ${persona.id}: ${cbuzz.length} computer buzzes, min reaction ${Math.min(...cbuzz.map((e) => e.data.reactionMs))}ms, score ${s.sides.A.score}-${s.sides.B.score}`);
  }
});
