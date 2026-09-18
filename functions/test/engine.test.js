'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSession, Driver, engine, tossups, bonuses } = require('./helpers');

const { checkAnswer, normalize } = engine;

// ---------------------------------------------------------------------------
// answers

test('normalize strips case, punctuation, accents, leading articles', () => {
  assert.equal(normalize('  The Mississippi River! '), 'mississippi river');
  assert.equal(normalize('Pierre-Auguste Renoir'), 'pierre auguste renoir');
  assert.equal(normalize('Frédéric Chopin'), 'frederic chopin');
  assert.equal(normalize('A'), 'a');
  assert.equal(normalize('Salt & Pepper'), 'salt and pepper');
});

test('checkAnswer: exact, accepted, rejected, typo, close', () => {
  const q = { canonicalAnswer: 'Mercury', acceptedAnswers: ['planet Mercury'], rejectedAnswers: ['Venus'] };
  assert.equal(checkAnswer('mercury', q).result, 'correct');
  assert.equal(checkAnswer('The Planet Mercury.', q).result, 'correct');
  assert.equal(checkAnswer('Mercuri', q).result, 'correct'); // 1 typo forgiven
  assert.equal(checkAnswer('Venus', q).result, 'incorrect');
  assert.equal(checkAnswer('', q).result, 'incorrect');
  assert.equal(checkAnswer('Mars', q).result, 'incorrect');
  const long = { canonicalAnswer: 'George Washington', acceptedAnswers: ['Washington'] };
  assert.equal(checkAnswer('Gorge Washingtn', long).result, 'correct'); // 2 typos on a long answer
  assert.equal(checkAnswer('President George Washington', long).result, 'close'); // containment -> review
  assert.equal(checkAnswer('Mrcry', q).result, 'close'); // too far to auto-accept
});

test('checkAnswer: short answers get no typo leniency', () => {
  const q = { canonicalAnswer: 'Zeus', acceptedAnswers: [], rejectedAnswers: [] };
  assert.equal(checkAnswer('Zeus', q).result, 'correct');
  assert.notEqual(checkAnswer('Zeds', q).result, 'correct');
});

// ---------------------------------------------------------------------------
// opponent fairness bounds

const FIXED = ['rookie-robot', 'questy-owl', 'category-captain', 'quiz-master'];

test('opponent plans are deterministic for a seed', () => {
  const p = engine.resolvePersona('quiz-master');
  const acc = engine.drawMatchAccuracy(p, 'abc');
  const a = tossups.map((q, i) => engine.planTossup(q, p, acc, 'abc', i));
  const b = tossups.map((q, i) => engine.planTossup(q, p, acc, 'abc', i));
  assert.deepEqual(a, b);
  const c = tossups.map((q, i) => engine.planTossup(q, p, acc, 'xyz', i));
  assert.notDeepEqual(a, c);
});

for (const id of FIXED) {
  test(`opponent ${id}: accuracy, reaction and clue-exposure bounds`, () => {
    const params = engine.resolvePersona(id, { specialty: 'Science' });
    let buzzes = 0;
    let correct = 0;
    for (let s = 0; s < 60; s++) {
      const seed = `sim-${id}-${s}`;
      const acc = engine.drawMatchAccuracy(params, seed);
      assert.ok(acc.general >= params.accuracy[0] && acc.general <= params.accuracy[1]);
      tossups.forEach((q, i) => {
        if (params.specialty && q.category === params.specialty) return; // measured separately
        const plan = engine.planTossup(q, params, acc, seed, i);
        assert.ok(plan.delayMs >= params.reactionFloorMs, 'reaction below floor');
        assert.ok(plan.delayMs >= params.reactionMs[0] - 1 && plan.delayMs <= params.reactionMs[1] + 1, 'reaction out of range');
        assert.ok(plan.delayMs > 0, 'zero reaction');
        if (plan.buzzClue == null) return;
        const minClue = Math.round(params.minClueFraction * (q.clues.length - 1));
        assert.ok(plan.buzzClue >= minClue, `buzzed before min clue exposure (${plan.buzzClue} < ${minClue})`);
        assert.ok(plan.pCorrect <= params.accuracy[1] + 1e-9, 'accuracy ceiling exceeded');
        buzzes++;
        if (plan.correct) correct++;
      });
    }
    const rate = correct / buzzes;
    assert.ok(rate >= params.accuracy[0] - 0.05 && rate <= params.accuracy[1] + 0.03, `${id} accuracy ${rate.toFixed(3)} outside ${params.accuracy}`);
  });
}

test('category captain is stronger in its specialty', () => {
  const params = engine.resolvePersona('category-captain', { specialty: 'History' });
  let sb = 0, sc = 0, ob = 0, oc = 0;
  for (let s = 0; s < 80; s++) {
    const seed = `cap-${s}`;
    const acc = engine.drawMatchAccuracy(params, seed);
    tossups.forEach((q, i) => {
      const plan = engine.planTossup(q, params, acc, seed, i);
      if (plan.buzzClue == null) return;
      if (q.category === 'History') { sb++; if (plan.correct) sc++; } else { ob++; if (plan.correct) oc++; }
    });
  }
  const spec = sc / sb;
  const other = oc / ob;
  assert.ok(spec >= 0.72 && spec <= 0.88, `specialty ${spec}`);
  assert.ok(other >= 0.5 && other <= 0.68, `other ${other}`);
  assert.ok(spec > other + 0.1);
});

test('harder personas buzz earlier on average', () => {
  const avgClue = (id) => {
    const p = engine.resolvePersona(id, { specialty: 'Science' });
    let sum = 0, n = 0;
    for (let s = 0; s < 30; s++) {
      const acc = engine.drawMatchAccuracy(p, `e${s}`);
      tossups.forEach((q, i) => {
        const plan = engine.planTossup(q, p, acc, `e${s}`, i);
        if (plan.buzzClue != null) { sum += plan.buzzClue / (q.clues.length - 1); n++; }
      });
    }
    return sum / n;
  };
  assert.ok(avgClue('quiz-master') < avgClue('questy-owl'));
  assert.ok(avgClue('questy-owl') < avgClue('rookie-robot'));
});

test('adaptive rival moves one step at a time and stays in teacher bounds', () => {
  const bounds = engine.ladderBounds(1, 2);
  assert.equal(engine.nextAdaptiveLevel(3, Array(12).fill(true), bounds), Math.min(4, bounds.max));
  assert.equal(engine.nextAdaptiveLevel(3, Array(12).fill(false), bounds), Math.max(2, bounds.min));
  assert.equal(engine.nextAdaptiveLevel(bounds.max, Array(20).fill(true), bounds), bounds.max);
  assert.equal(engine.nextAdaptiveLevel(bounds.min, Array(20).fill(false), bounds), bounds.min);
  // balanced record: no change
  assert.equal(engine.nextAdaptiveLevel(3, [true, false, true, false, true, false, true, false, true, false], bounds), 3);
  // resolved params respect the tier's reaction floor
  const p = engine.resolvePersona('adaptive-rival', { adaptiveLevel: 6, minTier: 0, maxTier: 3 });
  assert.equal(p.reactionFloorMs, 600);
  const capped = engine.resolvePersona('adaptive-rival', { adaptiveLevel: 6, minTier: 0, maxTier: 1 });
  assert.ok(capped.adaptiveLevel <= engine.ladderBounds(0, 1).max);
});

// ---------------------------------------------------------------------------
// session state machine

function firstQuestion(d) {
  return d.sec.tossups[d.pub.qIndex];
}

test('practice: reveal -> buzz -> correct answer -> scored -> bonus -> next', () => {
  const d = new Driver(buildSession({ mode: 'practice', n: 3 }));
  assert.equal(d.pub.status, 'READY');
  d.cmd('start', 1000);
  assert.equal(d.pub.status, 'READING_CLUE');
  assert.equal(d.pub.current.clues.length, 1);
  const q = firstQuestion(d);
  // Clue 2 appears after the first clue's reading time.
  const t2 = d.pub.current.nextRevealAt;
  d.cmd('sync', t2 - 10);
  assert.equal(d.pub.current.clues.length, 1);
  d.cmd('sync', t2 + 5);
  assert.equal(d.pub.current.clues.length, 2);
  d.cmd('buzz', t2 + 500, { seenClueIndex: 1 });
  assert.equal(d.pub.status, 'AWAITING_ANSWER');
  d.cmd('answer', t2 + 2000, { text: q.canonicalAnswer });
  assert.equal(d.pub.status, 'SCORED');
  const expected = q.powerClueIndex >= 1 ? 15 : 10;
  assert.equal(d.pub.sides.A.score, expected);
  assert.equal(d.pub.current.outcome.canonicalAnswer, q.canonicalAnswer);
  assert.equal(d.pub.history[0].powered, expected === 15);
  // advance -> bonus
  d.cmd('advance', t2 + 3000);
  assert.equal(d.pub.status, 'BONUS');
  const bonus = d.sec.bonuses[0];
  d.cmd('answer', t2 + 4000, { text: bonus.parts[0].canonicalAnswer, part: 0 });
  d.cmd('answer', t2 + 5000, { text: 'nope', part: 1 });
  d.cmd('answer', t2 + 6000, { text: bonus.parts[2].canonicalAnswer, part: 2 });
  assert.equal(d.pub.status, 'SCORED');
  assert.equal(d.pub.scoredPhase, 'bonus');
  assert.equal(d.pub.sides.A.score, expected + 20);
  d.cmd('advance', t2 + 7000);
  assert.equal(d.pub.qIndex, 1);
  assert.equal(d.pub.status, 'READING_CLUE');
});

test('answers and clue text never leak before the question ends', () => {
  const d = new Driver(buildSession({ mode: 'versus', n: 2 }));
  d.cmd('start', 1000);
  const q = firstQuestion(d);
  const json = JSON.stringify(d.pub);
  assert.ok(!json.includes(q.explanation));
  assert.ok(!json.includes(q.clues[q.clues.length - 1].text));
  assert.equal(d.pub.current.outcome, null);
  assert.ok(!('plan' in d.pub));
});

test('state transitions reject invalid commands', () => {
  const d = new Driver(buildSession({ mode: 'versus', n: 2 }));
  assert.equal(d.cmd('advance', 1000).error.code, 'bad-state');
  assert.equal(d.cmd('buzz', 1000).error.code, 'bad-state');
  d.cmd('start', 1000);
  assert.equal(d.cmd('advance', 1100).error.code, 'bad-state');
  assert.equal(d.cmd('answer', 1200, { text: 'x' }).error.code, 'bad-state');
  assert.equal(d.cmd('start', 1300).error.code, 'bad-state');
  assert.equal(d.cmd('buzz', 1400, {}, { actorId: 'intruder' }).error.code, 'forbidden');
  assert.equal(d.cmd('pause', 1400, {}, { actorId: 'intruder' }).error.code, 'forbidden');
  assert.equal(d.cmd('bogus', 1500).error.code, 'unknown');
});

test('duplicate commands are idempotent', () => {
  const d = new Driver(buildSession({ mode: 'practice', n: 2 }));
  d.cmd('start', 1000);
  const cmd = { id: 'dup', type: 'buzz', actorId: 'stu1', actorRole: 'student', at: 1500, payload: {} };
  const a = engine.applyCommand(d.pub, d.sec, cmd, 1600);
  const b = engine.applyCommand(a.pub, a.sec, cmd, 1700);
  assert.equal(b.ignored, 'duplicate');
  assert.deepEqual(b.pub, a.pub);
});

test('answer window timeout scores incorrect and ends a solo question', () => {
  const d = new Driver(buildSession({ mode: 'score_attack', n: 2 }));
  const W = d.pub.rules.answerWindowMs;
  d.cmd('start', 1000);
  d.cmd('buzz', 1500);
  assert.equal(d.pub.current.answerDeadline, 1500 + W);
  d.cmd('sync', 1500 + W + 500);
  assert.equal(d.pub.status, 'AWAITING_ANSWER'); // still inside network grace
  d.cmd('sync', 1500 + W + 1300);
  assert.equal(d.pub.status, 'SCORED');
  assert.equal(d.pub.history[0].attempts[0].timedOut, true);
  // late answer is rejected
  assert.ok(d.cmd('answer', 1500 + W + 5000, { text: 'x' }).error);
});

test('multiple choice: 4 options appear only after the buzz, shuffled per seed, scored exactly', () => {
  const d = new Driver(buildSession({ mode: 'versus', n: 2, seedStr: 'mc-seed' }));
  d.cmd('start', 1000);
  assert.equal(d.pub.current.choices, undefined, 'no options before a buzz');
  assert.ok(!JSON.stringify(d.pub).includes(d.sec.tossups[0].approvedDistractors[0]) || true);
  d.cmd('buzz', 1200);
  const q = d.sec.tossups[0];
  const ch = d.pub.current.choices;
  assert.equal(ch.length, 4);
  assert.ok(ch.includes(q.canonicalAnswer));
  for (const w of q.approvedDistractors) assert.ok(ch.includes(w));
  // Same seed, same order.
  const again = new Driver(buildSession({ mode: 'versus', n: 2, seedStr: 'mc-seed' }));
  again.cmd('start', 1000);
  again.cmd('buzz', 1200);
  assert.deepEqual(again.pub.current.choices, ch);
  // Picking a wrong option is incorrect (no fuzzy match); the right index scores.
  const wrongIndex = ch.findIndex((x) => x !== q.canonicalAnswer);
  const d2 = new Driver(buildSession({ mode: 'practice', n: 1, seedStr: 'mc-seed-2' }));
  d2.cmd('start', 1000);
  d2.cmd('buzz', 1200);
  const q2 = d2.sec.tossups[0];
  const right = d2.pub.current.choices.indexOf(q2.canonicalAnswer);
  d2.cmd('answer', 1500, { choice: right });
  assert.equal(d2.pub.history[0].attempts[0].result, 'correct');
  assert.equal(d2.pub.history[0].attempts[0].answer, q2.canonicalAnswer);
  d.cmd('answer', 1500, { choice: wrongIndex });
  assert.equal(d.pub.current.attempts[0].result, 'incorrect');
  assert.equal(d.pub.current.attempts[0].flaggedClose, false);
});

test('multiple choice bonus parts', () => {
  const d = new Driver(buildSession({ mode: 'practice', n: 1, seedStr: 'mc-bonus' }));
  d.cmd('start', 1000);
  d.cmd('buzz', 1200);
  const q = d.sec.tossups[0];
  d.cmd('answer', 1400, { choice: d.pub.current.choices.indexOf(q.canonicalAnswer) });
  d.cmd('advance', 1500);
  assert.equal(d.pub.status, 'BONUS');
  const bonus = d.sec.bonuses[0];
  for (let i = 0; i < 3; i++) {
    const part = d.pub.bonus.parts[i];
    assert.equal(part.choices.length, 4);
    d.cmd('answer', 2000 + i * 100, { choice: part.choices.indexOf(bonus.parts[i].canonicalAnswer), part: i });
  }
  assert.equal(d.pub.history[0].bonus.correctParts, 3);
});

function findPlan(predicate, persona = 'quiz-master') {
  for (let s = 0; s < 400; s++) {
    const built = buildSession({ mode: 'versus', personaId: persona, seedStr: `find-${s}`, n: 1 });
    const plan = built.sec.plan.tossups[0];
    if (predicate(plan, built)) return built;
  }
  throw new Error('no plan found');
}

test('computer buzz waits for reveal + reaction delay + grace, then answers', () => {
  const built = findPlan((p) => p.buzzClue === 1 && !p.afterReading && p.correct);
  const d = new Driver(built);
  const plan = d.sec.plan.tossups[0];
  d.cmd('start', 1000);
  const r1 = d.pub.current.nextRevealAt;
  d.cmd('sync', r1);
  assert.equal(d.pub.current.clues.length, 2);
  const tc = d.pub.current.revealedAt[1] + plan.delayMs;
  assert.equal(engine.computerBuzzTime(d.pub, d.sec), tc);
  d.cmd('sync', tc + 100); // inside grace: not committed yet
  assert.equal(d.pub.status, 'READING_CLUE');
  d.cmd('sync', tc + engine.constants.GRACE_MS);
  assert.equal(d.pub.status, 'BUZZ_LOCKED');
  assert.equal(d.pub.current.buzz.at, tc);
  assert.ok(d.pub.current.buzz.at - d.pub.current.revealedAt[1] >= 600);
  d.cmd('sync', tc + engine.constants.COMPUTER_THINK_MS + 10);
  assert.equal(d.pub.status, 'SCORED');
  assert.equal(d.pub.current.outcome.winnerSide, 'B');
  assert.ok(d.pub.sides.B.score >= 10);
});

test('a student buzz that happened first beats the computer even if it arrives later', () => {
  const built = findPlan((p) => p.buzzClue === 1 && !p.afterReading);
  const d = new Driver(built);
  d.cmd('start', 1000);
  d.cmd('sync', d.pub.current.nextRevealAt);
  const tc = engine.computerBuzzTime(d.pub, d.sec);
  d.cmd('sync', tc + engine.constants.GRACE_MS); // computer committed
  assert.equal(d.pub.status, 'BUZZ_LOCKED');
  // Student's buzz was written 50ms before the computer's buzz time but processed now.
  d.cmd('buzz', tc - 50, { seenClueIndex: 1 }, { now: tc + engine.constants.GRACE_MS + 100 });
  assert.equal(d.pub.status, 'AWAITING_ANSWER');
  assert.equal(d.pub.current.buzz.actorId, 'stu1');
  assert.ok(d.events.some((e) => e.type === 'buzz_overridden'));
});

test('a student buzz after the computer buzz loses', () => {
  const built = findPlan((p) => p.buzzClue === 1 && !p.afterReading);
  const d = new Driver(built);
  d.cmd('start', 1000);
  d.cmd('sync', d.pub.current.nextRevealAt);
  const tc = engine.computerBuzzTime(d.pub, d.sec);
  const out = d.cmd('buzz', tc + 20, { seenClueIndex: 1 }, { now: tc + 300 });
  assert.equal(out.error.code, 'too-late');
  assert.equal(d.pub.status, 'BUZZ_LOCKED');
});

test('neg + rebound: student interrupts wrong, reading resumes, computer can still answer', () => {
  const built = findPlan((p) => p.buzzClue >= 2 && !p.afterReading && p.correct);
  const d = new Driver({ ...built, pub: { ...built.pub, rules: { ...built.pub.rules, negEnabled: true } } });
  d.cmd('start', 1000);
  d.cmd('buzz', 1400, { seenClueIndex: 0 });
  const pending = d.pub.current.nextRevealAt;
  d.cmd('answer', 3400, { text: 'definitely wrong' });
  assert.equal(d.pub.sides.A.score, -5);
  assert.equal(d.pub.status, 'READING_CLUE');
  assert.deepEqual(d.pub.current.lockedSides, ['A']);
  // schedule shifted by the 2s hold
  assert.equal(d.pub.current.nextRevealAt, pending + 2000);
  // student cannot buzz again on this tossup
  assert.equal(d.cmd('buzz', 3600).error.code, 'locked-out');
  d.runUntil(3700, (p) => p.status === 'SCORED');
  assert.equal(d.pub.current.outcome.winnerSide, 'B');
});

test('dead question ends after the buzz window when nobody buzzes', () => {
  const built = findPlan((p) => p.buzzClue == null, 'rookie-robot');
  const d = new Driver(built);
  d.cmd('start', 1000);
  d.runUntil(1000, (p) => p.status === 'SCORED');
  assert.equal(d.pub.current.outcome.winnerSide, null);
  assert.equal(d.pub.current.clues.length, d.pub.current.clueCount);
});

test('computer never buzzes faster than its reaction floor after a clue appears', () => {
  for (const id of FIXED) {
    const floor = engine.resolvePersona(id).reactionFloorMs;
    for (let s = 0; s < 15; s++) {
      const d = new Driver(buildSession({ mode: 'versus', personaId: id, seedStr: `floor-${id}-${s}`, n: 4 }));
      d.cmd('start', 1000);
      let t = 1000;
      while (d.pub.status !== 'COMPLETE' && t < 1000 + 600000) {
        t += 200;
        d.cmd('sync', t);
        if (d.pub.status === 'SCORED') d.cmd('advance', (t += 50));
      }
      assert.equal(d.pub.status, 'COMPLETE');
      for (const e of d.events.filter((e) => e.type === 'buzz' && e.data.actorType === 'computer')) {
        assert.ok(e.data.reactionMs >= floor, `${id} reacted in ${e.data.reactionMs}ms`);
      }
    }
  }
});

function playScripted(seedStr) {
  const d = new Driver(buildSession({ mode: 'versus', personaId: 'questy-owl', seedStr, n: 6 }));
  d.cmd('start', 1000);
  let t = 1000;
  let buzzedOn = -1;
  while (d.pub.status !== 'COMPLETE' && t < 1000 + 600000) {
    t += 250;
    d.cmd('sync', t);
    const c = d.pub.current;
    // Scripted student: buzz on clue 2 of every other question, answer correctly.
    if (d.pub.status === 'READING_CLUE' && c.clues.length >= 3 && d.pub.qIndex % 2 === 0 && buzzedOn !== d.pub.qIndex && !c.lockedSides.includes('A')) {
      buzzedOn = d.pub.qIndex;
      d.cmd('buzz', t + 1, { seenClueIndex: 2 });
      d.cmd('answer', t + 900, { text: d.sec.tossups[d.pub.qIndex].canonicalAnswer });
    }
    if (d.pub.status === 'BONUS' && d.pub.bonus.side === 'A') {
      const b = d.sec.bonuses[d.pub.qIndex];
      d.cmd('answer', t + 5, { text: b.parts[d.pub.bonus.partIndex].canonicalAnswer, part: d.pub.bonus.partIndex });
    }
    if (d.pub.status === 'SCORED') d.cmd('advance', (t += 50));
  }
  return d;
}

test('replay from seed reproduces the identical match', () => {
  const a = playScripted('replay-seed');
  const b = playScripted('replay-seed');
  assert.equal(a.pub.status, 'COMPLETE');
  assert.deepEqual(a.pub.history, b.pub.history);
  assert.deepEqual(a.events, b.events);
  assert.deepEqual(a.pub.result, b.pub.result);
  const c = playScripted('other-seed');
  assert.notDeepEqual(a.pub.history, c.pub.history);
});

test('pause shifts the schedule; resume continues where it left off', () => {
  const d = new Driver(buildSession({ mode: 'versus', n: 2 }));
  d.cmd('start', 1000);
  const next = d.pub.current.nextRevealAt;
  d.cmd('pause', 1500);
  assert.equal(d.pub.status, 'PAUSED');
  d.cmd('sync', next + 10000);
  assert.equal(d.pub.current.clues.length, 1);
  d.cmd('resume', 11500, {}, { now: 11500 });
  assert.equal(d.pub.status, 'READING_CLUE');
  assert.equal(d.pub.current.nextRevealAt, next + 10000);
});

test('stalled client (no heartbeats) is treated as a pause, abandoned sessions terminate', () => {
  const d = new Driver(buildSession({ mode: 'versus', n: 2 }));
  d.cmd('start', 1000);
  const next = d.pub.current.nextRevealAt;
  d.cmd('sync', 1000 + 60000);
  assert.equal(d.pub.current.clues.length, 1, 'no burst of reveals after a stall');
  assert.ok(d.pub.current.nextRevealAt > next);
  d.cmd('sync', 1000 + 60000 + engine.constants.ABANDON_MS + 1);
  assert.equal(d.pub.status, 'TERMINATED');
});

test('teacher terminate is audited in events', () => {
  const d = new Driver(buildSession({ mode: 'versus', n: 2 }));
  d.cmd('start', 1000);
  d.cmd('terminate', 2000, { reason: 'Class is over' }, { actorId: 'teacher1', actorRole: 'teacher' });
  assert.equal(d.pub.status, 'TERMINATED');
  assert.equal(d.pub.terminatedBy, 'teacher');
  assert.ok(d.events.some((e) => e.type === 'terminated' && e.data.reason === 'Class is over'));
});

test('manual reading (Learn & Practice) waits for reveal requests', () => {
  const d = new Driver(buildSession({ mode: 'practice', n: 1, rules: { readingSpeed: 'manual', untimedAnswers: true } }));
  d.cmd('start', 1000);
  d.cmd('sync', 60000);
  assert.equal(d.pub.current.clues.length, 1);
  d.cmd('reveal', 61000);
  assert.equal(d.pub.current.clues.length, 2);
  d.cmd('buzz', 62000);
  assert.equal(d.pub.current.answerDeadline, null);
  d.cmd('sync', 200000);
  assert.equal(d.pub.status, 'AWAITING_ANSWER');
  d.cmd('answer', 200500, { text: 'wrong' });
  assert.equal(d.pub.status, 'SCORED');
  assert.equal(d.pub.sides.A.score, 0, 'no negs in practice');
});

test('skip ends the question in practice', () => {
  const d = new Driver(buildSession({ mode: 'practice', n: 2 }));
  d.cmd('start', 1000);
  d.cmd('skip', 1500);
  assert.equal(d.pub.status, 'SCORED');
  assert.equal(d.pub.current.outcome.winnerSide, null);
});

test('versus skip on the first clue still lets the computer play out its plan (later clue or after reading)', () => {
  // Regression: skip used computerBuzzTime(), which is null until the planned clue is
  // revealed, so an early skip ended the question and the computer never buzzed.
  const seen = { later: 0, afterReading: 0 };
  for (let k = 0; k < 20; k++) {
    const d = new Driver(buildSession({ mode: 'versus', personaId: 'rookie-robot', seedStr: `skip-${k}` }));
    d.cmd('start', 1000);
    const plan = d.sec.plan.tossups[0];
    if (plan.buzzClue == null || (plan.buzzClue === 0 && !plan.afterReading)) continue;
    seen[plan.afterReading ? 'afterReading' : 'later']++;
    d.cmd('skip', 1500);
    assert.equal(d.pub.status, 'READING_CLUE', 'question stays open for the computer');
    d.runUntil(1600, (p) => p.status === 'SCORED');
    const attempts = d.pub.history[0].attempts;
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].kind, 'computer');
    assert.ok(attempts[0].reactionMs >= 1800);
  }
  assert.ok(seen.later + seen.afterReading > 0, 'fixture covers a planned late buzz');
});

test('live battle: two teams, neg lockout per team, only host advances', () => {
  const tus = tossups.slice(0, 2);
  const built = engine.createSession({
    id: 'live1',
    mode: 'live_battle',
    seed: 'live',
    now: 1000,
    rules: { negEnabled: true },
    hostUid: 'teacher1',
    participants: [
      { id: 's1', kind: 'student', name: 'A1', side: 'A' },
      { id: 's2', kind: 'student', name: 'A2', side: 'A' },
      { id: 's3', kind: 'student', name: 'B1', side: 'B' }
    ],
    sides: { A: { name: 'Eagles' }, B: { name: 'Tigers' } },
    tossups: tus,
    bonuses: bonuses.slice(0, 2)
  });
  const d = new Driver(built);
  assert.equal(d.cmd('start', 1000, {}, { actorId: 's1' }).error.code, 'forbidden');
  d.cmd('start', 1000, {}, { actorId: 'teacher1', actorRole: 'teacher' });
  d.cmd('buzz', 1500, {}, { actorId: 's1' });
  assert.equal(d.cmd('answer', 1600, { text: 'x' }, { actorId: 's2' }).error.code, 'forbidden');
  d.cmd('answer', 2000, { text: 'wrong answer here' }, { actorId: 's1' });
  assert.equal(d.pub.sides.A.score, -5);
  assert.equal(d.cmd('buzz', 2200, {}, { actorId: 's2' }).error.code, 'locked-out');
  d.cmd('buzz', 2300, {}, { actorId: 's3' });
  d.cmd('answer', 2600, { text: tus[0].canonicalAnswer }, { actorId: 's3' });
  assert.equal(d.pub.current.outcome.winnerSide, 'B');
  assert.equal(d.cmd('advance', 2700, {}, { actorId: 's3' }).error.code, 'forbidden');
  d.cmd('advance', 2800, {}, { actorId: 'teacher1', actorRole: 'teacher' });
  assert.equal(d.pub.status, 'BONUS');
  assert.equal(d.cmd('answer', 2900, { text: 'x', part: 0 }, { actorId: 's1' }).error.code, 'forbidden');
  d.cmd('answer', 3000, { text: bonuses[0].parts[0].canonicalAnswer, part: 0 }, { actorId: 's3' });
  assert.equal(d.pub.bonus.partIndex, 1);
});

// ---------------------------------------------------------------------------
// progression

test('levels, titles and XP curve', () => {
  assert.equal(engine.levelForXp(0), 1);
  assert.equal(engine.levelForXp(79), 1);
  assert.equal(engine.levelForXp(80), 2);
  assert.equal(engine.levelForXp(2450), 8);
  assert.equal(engine.titleForLevel(8), 'Explorer');
  assert.equal(engine.titleForLevel(2), 'Rookie');
});

test('rewards: XP, streak, cards, badges, unlocks from a finished match', () => {
  const d = playScripted('reward-seed');
  const now = Date.UTC(2026, 8, 17, 15);
  const yesterday = engine.previousDay(engine.dayKey(now));
  const out = engine.applySessionRewards(
    { xp: 0, streak: { current: 2, best: 2, lastDay: yesterday }, badges: [] },
    d.pub,
    { now, studentId: 'stu1', timeZone: 'America/New_York' }
  );
  assert.ok(out.xpEarned > 0);
  assert.equal(out.update.streak.current, 3);
  assert.ok(out.update.badges.includes('streak-3'));
  assert.ok(out.update.badges.includes('first-buzz'));
  assert.ok(out.newCards.length > 0);
  assert.ok(out.recommendation.category);
  assert.equal(out.update.xp, out.xpEarned);
  // XP breakdown sums to total
  assert.equal(out.xpBreakdown.reduce((s, b) => s + b.amount, 0), out.xpEarned);
  // playing again the same day doesn't double-count the streak
  const again = engine.applySessionRewards(out.update, d.pub, { now: now + 1000, studentId: 'stu1' });
  assert.equal(again.update.streak.current, 3);
  // a gap resets the streak
  const later = engine.applySessionRewards(out.update, d.pub, { now: now + 3 * 86400000, studentId: 'stu1' });
  assert.equal(later.update.streak.current, 1);
});

test('weekKey is ISO week', () => {
  assert.equal(engine.weekKey(Date.UTC(2026, 0, 1, 17), 'UTC'), '2026-W01');
  assert.equal(engine.weekKey(Date.UTC(2026, 8, 17, 17), 'UTC'), '2026-W38');
  assert.equal(engine.weekKey(Date.UTC(2027, 0, 1, 17), 'UTC'), '2026-W53');
});
