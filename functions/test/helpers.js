'use strict';

const seed = require('../seed/questions.json');
const engine = require('../engine');

const tossups = seed.tossups;
const bonuses = seed.bonuses;

function pickQuestions(n, rngSeed = 'pick') {
  const rng = engine.streamFor(rngSeed, 'pick');
  return rng.shuffle(tossups).slice(0, n);
}

function bonusesFor(tus) {
  return tus.map((t) => bonuses.find((b) => b.category === t.category) || null);
}

/** Build a versus (or practice) session the same way the server does. */
function buildSession({ mode = 'versus', personaId = 'questy-owl', seedStr = 'seed-1', n = 10, rules = {}, now = 0, specialty, single = false } = {}) {
  const tus = pickQuestions(n, seedStr).map((q) => (single ? engine.toSingleQuestion(q) : q));
  const bos = bonusesFor(tus);
  let opponent = null;
  let opponentPlan = null;
  const participants = [{ id: 'stu1', kind: 'student', name: 'Meridian', avatar: '🦊', side: 'A' }];
  const sides = { A: { name: 'Meridian' } };
  if (mode === 'versus') {
    opponent = engine.resolvePersona(personaId, { specialty: specialty || 'Science' });
    const acc = engine.drawMatchAccuracy(opponent, seedStr);
    opponentPlan = {
      matchAccuracy: acc,
      tossups: tus.map((q, i) => engine.planTossup(q, opponent, acc, seedStr, i)),
      bonuses: bos.map((b, i) => (b ? engine.planBonus(b, opponent, acc, seedStr, i) : null))
    };
    participants.push({ id: 'computer', kind: 'computer', name: opponent.name, avatar: opponent.avatar, side: 'B' });
    sides.B = { name: opponent.name };
  }
  return engine.createSession({
    id: 'sess1',
    mode,
    seed: seedStr,
    now,
    rules,
    ownerStudentId: 'stu1',
    participants,
    sides,
    opponent,
    opponentPlan,
    tossups: tus,
    bonuses: bos
  });
}

/** Tiny driver: applies commands and keeps state. */
class Driver {
  constructor(built) {
    this.pub = built.pub;
    this.sec = built.sec;
    this.events = [...built.events];
    this.n = 0;
  }
  cmd(type, at, payload = {}, extra = {}) {
    const now = extra.now ?? at;
    const out = engine.applyCommand(this.pub, this.sec, { id: `c${this.n++}`, type, actorId: extra.actorId ?? 'stu1', actorRole: extra.actorRole ?? 'student', at, payload }, now);
    this.pub = out.pub;
    this.sec = out.sec;
    this.events.push(...out.events);
    return out;
  }
  /** Heartbeat every `step` ms from t0 until predicate or tMax. */
  runUntil(t0, pred, step = 250, tMax = t0 + 120000) {
    let t = t0;
    while (t < tMax) {
      this.cmd('sync', t);
      if (pred(this.pub)) return t;
      t += step;
    }
    return t;
  }
}

module.exports = { seed, tossups, bonuses, pickQuestions, bonusesFor, buildSession, Driver, engine };
