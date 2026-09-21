'use strict';

// Computer opponent simulation. Deterministic and explainable: every decision
// is precomputed from question metadata (clue difficulty weights, question
// difficulty, category) plus a seeded random stream BEFORE the question starts.
// The plan never looks at the answer to decide when to buzz; the canonical
// answer is only used to print what the computer says when its precomputed
// outcome is "correct".

const catalog = require('../shared/catalog.json');
const { streamFor } = require('./rng');

const PERSONAS = Object.fromEntries(catalog.personas.map((p) => [p.id, p]));
const LADDER = catalog.adaptiveLadder;
const MAX_LADDER = LADDER.levels - 1;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;
const lerpPair = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];

function tierForLadderLevel(level) {
  return Math.round((clamp(level, 0, MAX_LADDER) / MAX_LADDER) * 3);
}

/** Ladder levels allowed inside a teacher's tier bounds (tiers 0..3). */
function ladderBounds(minTier = 0, maxTier = 3) {
  const levels = [];
  for (let l = 0; l <= MAX_LADDER; l++) {
    const t = tierForLadderLevel(l);
    if (t >= minTier && t <= maxTier) levels.push(l);
  }
  return { min: levels[0] ?? 0, max: levels[levels.length - 1] ?? MAX_LADDER };
}

/**
 * Adaptive rival: move at most ONE step based on a rolling window of recent
 * versus results, keeping inside teacher bounds. Returns the new level.
 * recent: array of booleans (true = student won), newest last.
 */
function nextAdaptiveLevel(currentLevel, recent, bounds) {
  const [minWindow, maxWindow] = LADDER.window;
  const [lowTarget, highTarget] = LADDER.winRateTarget;
  let level = clamp(currentLevel ?? LADDER.defaultLevel, bounds.min, bounds.max);
  const windowed = (recent || []).slice(-maxWindow);
  if (windowed.length >= Math.min(minWindow, 5)) {
    const winRate = windowed.filter(Boolean).length / windowed.length;
    if (winRate > highTarget) level += 1;
    else if (winRate < lowTarget) level -= 1;
  }
  return clamp(level, bounds.min, bounds.max);
}

/**
 * Resolve concrete opponent parameters for a match.
 * opts: { adaptiveLevel, specialty, minTier, maxTier, floors }
 */
function resolvePersona(personaId, opts = {}) {
  const base = PERSONAS[personaId];
  if (!base) throw new Error(`Unknown persona ${personaId}`);
  const floors = { ...catalog.reactionFloorMs, ...(opts.floors || {}) };

  if (base.adaptive) {
    const bounds = ladderBounds(opts.minTier, opts.maxTier);
    const level = clamp(opts.adaptiveLevel ?? LADDER.defaultLevel, bounds.min, bounds.max);
    const t = level / MAX_LADDER;
    const tier = tierForLadderLevel(level);
    const reaction = lerpPair(LADDER.from.reactionMs, LADDER.to.reactionMs, t);
    return {
      id: base.id,
      name: base.name,
      avatar: base.avatar,
      difficulty: base.difficulty,
      tier,
      adaptiveLevel: level,
      accuracy: lerpPair(LADDER.from.accuracy, LADDER.to.accuracy, t),
      reactionMs: reaction,
      reactionFloorMs: Math.max(Number(floors[tier]), 1),
      risk: lerp(LADDER.from.risk, LADDER.to.risk, t),
      skill: lerp(LADDER.from.skill, LADDER.to.skill, t),
      minClueFraction: lerp(LADDER.from.minClueFraction, LADDER.to.minClueFraction, t),
      intro: base.intro,
      strengths: base.strengths,
      lines: base.lines
    };
  }

  return {
    id: base.id,
    name: base.name,
    avatar: base.avatar,
    difficulty: base.difficulty,
    tier: base.tier,
    accuracy: base.accuracy,
    specialtyAccuracy: base.specialtyAccuracy,
    specialty: base.specialtyAccuracy ? opts.specialty || null : null,
    reactionMs: base.reactionMs,
    reactionFloorMs: Math.max(Number(floors[base.tier]), 1),
    risk: base.risk,
    skill: base.skill,
    specialtySkill: base.specialtySkill,
    minClueFraction: base.minClueFraction,
    intro: base.intro,
    strengths: base.specialtyAccuracy && opts.specialty ? `Super strong in ${opts.specialty}` : base.strengths,
    lines: base.lines
  };
}

/** Match-level accuracy draws (one per match, from the persona range). */
function drawMatchAccuracy(params, seed) {
  const rng = streamFor(seed, 'opponent-accuracy');
  const general = rng.range(params.accuracy[0], params.accuracy[1]);
  const specialty = params.specialtyAccuracy
    ? rng.range(params.specialtyAccuracy[0], params.specialtyAccuracy[1])
    : general;
  return { general, specialty };
}

const DIFFICULTY_MOD = { 1: 1.1, 2: 1.0, 3: 0.85 };

/**
 * Precompute what the computer does on one tossup.
 * @returns {{ buzzClue: number|null, afterReading: boolean, delayMs: number, correct: boolean,
 *            answerText: string|null, recognition: number }}
 */
function planTossup(question, params, matchAccuracy, seed, questionIndex) {
  const rng = streamFor(seed, 'tossup', questionIndex, question.id);
  const clues = question.clues || [];
  const n = clues.length;
  const isSpecialty = params.specialty && question.category === params.specialty;
  const skill = isSpecialty ? params.specialtySkill : params.skill;
  const accuracy = isSpecialty ? matchAccuracy.specialty : matchAccuracy.general;
  const accuracyCeiling = isSpecialty && params.specialtyAccuracy ? params.specialtyAccuracy[1] : params.accuracy[1];
  const diffMod = DIFFICULTY_MOD[question.difficulty] ?? 1.0;
  const minClue = Math.min(n - 1, Math.round(params.minClueFraction * (n - 1)));

  const recognitionAt = (i) => {
    const weight = clues[i]?.difficultyWeight ?? 0.5;
    const revealFactor = 1 - clamp(weight, 0, 1);
    return clamp(skill * (0.35 + 0.65 * revealFactor) * diffMod, 0, 0.97);
  };

  let buzzClue = null;
  let afterReading = false;
  let recognition = 0;
  // Always draw one number per clue so the stream stays aligned regardless of outcome.
  const draws = clues.map(() => rng.next());
  for (let i = minClue; i < n; i++) {
    const rec = recognitionAt(i);
    if (draws[i] < rec * params.risk) {
      buzzClue = i;
      recognition = rec;
      break;
    }
  }
  const lateDraw = rng.next();
  if (buzzClue === null && n > 0) {
    const rec = recognitionAt(n - 1);
    if (lateDraw < rec) {
      buzzClue = n - 1;
      afterReading = true;
      recognition = rec;
    }
  }

  const rawDelay = rng.range(params.reactionMs[0], params.reactionMs[1]);
  const delayMs = Math.round(Math.max(params.reactionFloorMs, rawDelay, 1));

  // A single-question match has no later clue to wait for, so the rival has to
  // read the question like a kid does before it can answer. Skill decides how
  // far through the sentence it recognises the answer; reaction time is added on
  // top. Without this the rival buzzes a second in, before anyone can read it.
  const readFraction = n === 1 ? Number(clamp(1.15 - 0.6 * skill, 0.5, 1.15).toFixed(3)) : null;

  const ambiguity = clamp(question.ambiguity ?? 0, 0, 1);
  const pCorrect = clamp(accuracy * (0.9 + 0.2 * recognition) * (1 - 0.3 * ambiguity), 0.05, accuracyCeiling);
  const correctDraw = rng.next();
  const correct = buzzClue !== null && correctDraw < pCorrect;
  const distractors = (question.approvedDistractors || []).filter(Boolean);
  const wrongPick = rng.next();
  const answerText = buzzClue === null
    ? null
    : correct
      ? question.canonicalAnswer
      : distractors.length
        ? distractors[Math.floor(wrongPick * distractors.length)]
        : null;

  return { buzzClue, afterReading, delayMs, readFraction, correct, answerText, recognition: Number(recognition.toFixed(3)), pCorrect: Number(pCorrect.toFixed(3)) };
}

/** Precompute computer answers for bonus parts it earns. */
function planBonus(bonus, params, matchAccuracy, seed, questionIndex) {
  const rng = streamFor(seed, 'bonus', questionIndex, bonus.id);
  const isSpecialty = params.specialty && bonus.category === params.specialty;
  const accuracy = isSpecialty ? matchAccuracy.specialty : matchAccuracy.general;
  // Wrapped in an object: Firestore can't store arrays nested directly in arrays.
  const parts = (bonus.parts || []).map((part, i) => {
    // Later parts are harder.
    const p = clamp(accuracy * (1.1 - 0.15 * i), 0.05, 0.95);
    const correct = rng.next() < p;
    const distractors = (part.approvedDistractors || []).filter(Boolean);
    const pick = rng.next();
    return {
      correct,
      answerText: correct ? part.canonicalAnswer : distractors.length ? distractors[Math.floor(pick * distractors.length)] : null
    };
  });
  return { parts };
}

module.exports = {
  PERSONAS,
  resolvePersona,
  drawMatchAccuracy,
  planTossup,
  planBonus,
  nextAdaptiveLevel,
  ladderBounds,
  tierForLadderLevel
};
