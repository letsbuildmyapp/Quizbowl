'use strict';

// Server-authoritative game session state machine.
//
//   CREATED -> READY -> READING_CLUE -> BUZZ_LOCKED -> AWAITING_ANSWER -> SCORED
//          -> BONUS | NEXT_QUESTION -> ... -> COMPLETE
//   alt: incorrect answer -> REBOUND (reading resumes) or question ends
//        stall/disconnect -> PAUSED (schedule shifts on resume)
//        teacher stop     -> TERMINATED
//
// Pure functions only: (publicState, secretState, command, now) -> new states + events.
// Transport (Firestore trigger) lives in functions/game.js.
//
// Timing model: every command carries `at`, a server timestamp the database
// assigned when the command was written (clients cannot forge it). `now` is the
// processing time. Clue reveals are stamped with the processing time (that is
// when students can first see them), and the computer's buzz time is derived
// from those stamps + its precomputed reaction delay, so it never reacts faster
// than a student could. A computer buzz is only committed once it is GRACE_MS
// in the past, so a student buzz that happened earlier but is still in flight
// wins the race.

const catalog = require('../shared/catalog.json');
const { checkAnswer, normalize } = require('./answers');
const { streamFor } = require('./rng');

const GRACE_MS = 700; // wait before committing a computer buzz (student buzzes in flight)
const COMPUTER_THINK_MS = 1500; // pause between computer buzz and its answer
const ANSWER_GRACE_MS = 1200; // network allowance after the answer window
const BONUS_COMPUTER_PART_MS = 1800;
const STALL_MS = 12000; // no heartbeat this long while reading => treat as a pause
const ABANDON_MS = 30 * 60 * 1000;
const MIN_CLUE_MS = 2200;
const CLUE_GAP_MS = 700;
const PROCESSED_KEEP = 300;

const TERMINAL = new Set(['COMPLETE', 'TERMINATED']);

function clone(o) {
  return o == null ? o : JSON.parse(JSON.stringify(o));
}

/**
 * Multiple choice: the right answer plus the question's approved distractors,
 * shuffled from the match seed (reproducible). null when a question has fewer
 * than 2 distractors (typed answers are the fallback).
 */
function makeChoices(seed, key, item) {
  const wrong = (item.approvedDistractors || []).filter((d) => d && normalize(d) !== normalize(item.canonicalAnswer));
  if (wrong.length < 2) return null;
  return streamFor(seed, 'choices', key).shuffle([item.canonicalAnswer, ...wrong.slice(0, 3)]);
}

/** Score a picked choice exactly (no fuzzy matching). */
function checkChoice(choices, index, item) {
  const picked = Number.isInteger(index) && choices ? choices[index] : null;
  if (picked == null) return { result: 'incorrect', normalized: '', picked: null };
  const ok = normalize(picked) === normalize(item.canonicalAnswer);
  return { result: ok ? 'correct' : 'incorrect', normalized: normalize(picked), picked };
}

function clueDurationMs(text, speed) {
  const wps = catalog.readingSpeeds[speed]?.wordsPerSecond || catalog.readingSpeeds.medium.wordsPerSecond;
  const words = String(text || '').trim().split(/\s+/).filter(Boolean).length;
  return Math.max(MIN_CLUE_MS, Math.round((words / wps) * 1000)) + CLUE_GAP_MS;
}

function isManual(pub) {
  return pub.rules.readingSpeed === 'manual';
}

function isTimed(pub) {
  return pub.mode !== 'practice' || !pub.rules.untimedAnswers;
}

/**
 * Build a new session.
 * input: {
 *   id, mode: 'practice'|'score_attack'|'versus'|'live_battle', seed, now,
 *   rules, classroomId, schoolId, ownerStudentId, hostUid, assignmentId, dailyQuest,
 *   participants: [{ id, kind: 'student'|'computer', name, avatar, side }],
 *   sides: { A: { name }, B?: { name } },
 *   opponent: resolved persona params or null, opponentPlan: { matchAccuracy, tossups: [], bonuses: [] },
 *   tossups: [question], bonuses: [bonus|null] (aligned with tossups)
 * }
 */
function createSession(input) {
  const rules = { ...catalog.defaultRules, ...(input.rules || {}) };
  const sides = {};
  for (const [key, s] of Object.entries(input.sides)) sides[key] = { name: s.name, score: 0, emoji: s.emoji || null };
  const opp = input.opponent;
  const pub = {
    id: input.id,
    mode: input.mode,
    status: 'READY',
    createdAt: input.now,
    clock: input.now,
    seq: 0,
    rules,
    classroomId: input.classroomId || null,
    schoolId: input.schoolId || null,
    ownerStudentId: input.ownerStudentId || null,
    hostUid: input.hostUid || null,
    assignmentId: input.assignmentId || null,
    dailyQuest: !!input.dailyQuest,
    reviewDeck: !!input.reviewDeck,
    title: input.title || null,
    participants: input.participants,
    participantIds: input.participants.filter((p) => p.kind === 'student').map((p) => p.id),
    sides,
    opponent: opp
      ? {
          personaId: opp.id,
          name: opp.name,
          avatar: opp.avatar,
          difficulty: opp.difficulty,
          tier: opp.tier,
          adaptiveLevel: opp.adaptiveLevel ?? null,
          specialty: opp.specialty || null,
          strengths: opp.strengths,
          intro: opp.intro,
          lines: opp.lines
        }
      : null,
    total: input.tossups.length,
    qIndex: -1,
    current: null,
    bonus: null,
    history: [],
    pausedAt: null,
    resumeStatus: null,
    result: null
  };
  const sec = {
    seed: input.seed,
    tossups: input.tossups,
    bonuses: input.bonuses,
    opponentParams: opp || null,
    plan: input.opponentPlan || null,
    processed: []
  };
  const events = [{ type: 'session_created', at: input.now, data: { mode: input.mode, seed: input.seed, total: pub.total } }];
  return { pub, sec, events };
}

// ---------------------------------------------------------------------------
// helpers

function sideOf(pub, actorId) {
  return pub.participants.find((p) => p.id === actorId)?.side ?? null;
}

function sidesInPlay(pub) {
  return Object.keys(pub.sides);
}

function shiftCurrent(pub, delta) {
  const c = pub.current;
  if (c) {
    c.revealedAt = c.revealedAt.map((t) => t + delta);
    for (const k of ['nextRevealAt', 'readingDoneAt', 'deadAt', 'answerDeadline', 'holdStartedAt']) {
      if (c[k] != null) c[k] += delta;
    }
    if (c.buzz) c.buzz.at += delta;
  }
  const b = pub.bonus;
  if (b) {
    for (const k of ['deadline', 'nextComputerAt']) if (b[k] != null) b[k] += delta;
  }
}

function computerSide(pub) {
  return pub.participants.find((p) => p.kind === 'computer')?.side ?? null;
}

/** The absolute time the computer will buzz on the current tossup, if it can. */
function computerBuzzTime(pub, sec) {
  const cs = computerSide(pub);
  const c = pub.current;
  if (!cs || !c || !sec.plan) return null;
  if (c.lockedSides.includes(cs) || c.computerBuzzed) return null;
  const plan = sec.plan.tossups[pub.qIndex];
  if (!plan || plan.buzzClue == null) return null;
  if (plan.afterReading) {
    return c.readingDoneAt != null && c.revealedAt.length === c.clueCount ? c.readingDoneAt + plan.delayMs : null;
  }
  const revealed = c.revealedAt[plan.buzzClue];
  return revealed != null ? revealed + plan.delayMs : null;
}

function revealClue(pub, sec, stampAt, events) {
  const c = pub.current;
  const q = sec.tossups[pub.qIndex];
  const k = c.clues.length;
  if (k >= c.clueCount) return;
  const text = q.clues[k].text;
  c.clues.push(text);
  c.revealedAt.push(stampAt);
  const dur = clueDurationMs(text, pub.rules.readingSpeed);
  if (k + 1 < c.clueCount) {
    c.nextRevealAt = isManual(pub) ? null : stampAt + dur;
  } else {
    c.nextRevealAt = null;
    c.readingDoneAt = stampAt + dur;
    c.deadAt = isManual(pub) ? null : c.readingDoneAt + pub.rules.deadWindowMs;
  }
  events.push({ type: 'clue_revealed', at: stampAt, data: { questionId: q.id, clueIndex: k } });
}

function startQuestion(pub, sec, index, stampAt, events) {
  const q = sec.tossups[index];
  pub.qIndex = index;
  pub.bonus = null;
  pub.current = {
    index,
    questionId: q.id,
    category: q.category,
    subcategory: q.subcategory || null,
    difficulty: q.difficulty ?? null,
    leadin: q.promptLeadin || '',
    clueCount: q.clues.length,
    clues: [],
    revealedAt: [],
    nextRevealAt: null,
    readingDoneAt: null,
    deadAt: null,
    buzz: null,
    answerDeadline: null,
    lockedSides: [],
    attempts: [],
    computerBuzzed: false,
    outcome: null
  };
  pub.status = 'READING_CLUE';
  events.push({ type: 'question_shown', at: stampAt, data: { questionId: q.id, order: index } });
  revealClue(pub, sec, stampAt, events);
}

function endQuestion(pub, sec, winnerSide, at, events) {
  const c = pub.current;
  const q = sec.tossups[pub.qIndex];
  const plan = sec.plan?.tossups?.[pub.qIndex] || null;
  c.nextRevealAt = null;
  c.deadAt = null;
  c.answerDeadline = null;
  c.buzz = null;
  c.outcome = {
    winnerSide,
    canonicalAnswer: q.canonicalAnswer,
    acceptedAnswers: q.acceptedAnswers || [],
    explanation: q.explanation || '',
    pronunciationNotes: q.pronunciationNotes || null,
    allClues: q.clues.map((cl) => cl.text),
    powerClueIndex: q.powerClueIndex ?? null,
    // After the question is over it is safe to show what the computer had planned.
    computerPlan: plan ? { buzzClue: plan.buzzClue, afterReading: plan.afterReading } : null
  };
  const correctAttempt = c.attempts.find((a) => a.result === 'correct');
  pub.history.push({
    index: pub.qIndex,
    questionId: q.id,
    category: q.category,
    subcategory: q.subcategory || null,
    difficulty: q.difficulty ?? null,
    winnerSide,
    clueCount: c.clueCount,
    cluesSeen: c.clues.length,
    correctClueIndex: correctAttempt ? correctAttempt.clueIndex : null,
    powered: !!correctAttempt?.powered,
    canonicalAnswer: q.canonicalAnswer,
    allClues: c.outcome.allClues,
    explanation: c.outcome.explanation,
    powerClueIndex: c.outcome.powerClueIndex,
    computerPlan: c.outcome.computerPlan,
    attempts: c.attempts.map((a) => ({ ...a })),
    bonus: null
  });
  pub.status = 'SCORED';
  pub.scoredPhase = 'tossup';
  events.push({ type: 'question_ended', at, data: { questionId: q.id, winnerSide } });
}

function resumeReading(pub, at) {
  const c = pub.current;
  const delta = Math.max(0, at - c.holdStartedAt);
  const hold = c.holdStartedAt;
  c.holdStartedAt = null;
  // Shift only the schedule that was still pending when the buzz happened.
  if (c.nextRevealAt != null && c.nextRevealAt > hold) c.nextRevealAt += delta;
  if (c.readingDoneAt != null && c.readingDoneAt > hold) c.readingDoneAt += delta;
  if (c.deadAt != null) c.deadAt += delta;
  // Keep the computer's reaction window intact across the hold.
  c.revealedAt = c.revealedAt.map((t, i) => (i === c.revealedAt.length - 1 ? t + delta : t));
  c.buzz = null;
  c.answerDeadline = null;
  pub.status = 'READING_CLUE';
}

function allSidesLocked(pub) {
  return sidesInPlay(pub).every((s) => pub.current.lockedSides.includes(s));
}

function scoreTossupAnswer(pub, sec, { actorId, side, text, choice, at, timedOut }, events) {
  const c = pub.current;
  const q = sec.tossups[pub.qIndex];
  const buzz = c.buzz;
  let check;
  if (timedOut) check = { result: 'incorrect', normalized: '' };
  else if (c.choices && Number.isInteger(choice)) {
    check = checkChoice(c.choices, choice, q);
    text = check.picked;
  } else check = checkAnswer(text, q);
  const interrupted = c.readingDoneAt == null || buzz.at < c.readingDoneAt;
  const rules = pub.rules;
  let points = 0;
  let powered = false;
  if (check.result === 'correct') {
    powered = !!(rules.powerEnabled && q.powerClueIndex != null && buzz.clueIndex <= q.powerClueIndex);
    points = powered ? rules.powerPoints : rules.tossupPoints;
  } else if (rules.negEnabled && interrupted && pub.mode !== 'practice') {
    points = rules.negPoints;
  }
  pub.sides[side].score += points;
  const attempt = {
    actorId,
    side,
    kind: buzz.kind,
    clueIndex: buzz.clueIndex,
    buzzAt: buzz.at,
    reactionMs: buzz.reactionMs ?? null,
    answer: timedOut ? null : String(text ?? '').slice(0, 120),
    normalized: check.normalized,
    result: check.result === 'correct' ? 'correct' : 'incorrect',
    flaggedClose: check.result === 'close',
    choice: Number.isInteger(choice) ? choice : null,
    timedOut: !!timedOut,
    interrupted,
    powered,
    points
  };
  c.attempts.push(attempt);
  events.push({
    type: 'answer',
    at,
    actor: actorId,
    data: {
      questionId: q.id,
      side,
      result: attempt.result,
      close: attempt.flaggedClose,
      timedOut: !!timedOut,
      points,
      powered,
      clueIndex: buzz.clueIndex,
      normalized: check.normalized
    }
  });

  if (attempt.result === 'correct') {
    endQuestion(pub, sec, side, at, events);
    return;
  }
  c.lockedSides.push(side);
  const readingOver = c.clues.length === c.clueCount && c.readingDoneAt != null && at >= c.readingDoneAt;
  if (allSidesLocked(pub) || (isManual(pub) && readingOver && sidesInPlay(pub).length === 1)) {
    endQuestion(pub, sec, null, at, events);
  } else {
    resumeReading(pub, at);
  }
}

function registerBuzz(pub, { actorId, side, kind, at, clueIndex, reactionMs, choices }, events) {
  const c = pub.current;
  if (kind !== 'computer') c.choices = choices ?? null;
  c.buzz = { actorId, side, kind, at, clueIndex, reactionMs: reactionMs ?? null };
  c.holdStartedAt = at;
  if (kind === 'computer') {
    c.computerBuzzed = true;
    pub.status = 'BUZZ_LOCKED';
    c.answerDeadline = at + COMPUTER_THINK_MS;
  } else {
    pub.status = 'AWAITING_ANSWER';
    c.answerDeadline = isTimed(pub) ? at + pub.rules.answerWindowMs : null;
  }
  events.push({
    type: 'buzz',
    at,
    actor: actorId,
    data: { questionId: c.questionId, side, actorType: kind, clueIndex, reactionMs: reactionMs ?? null }
  });
}

function startBonus(pub, sec, side, at, events) {
  const bonus = sec.bonuses[pub.qIndex];
  const cs = computerSide(pub);
  pub.bonus = {
    questionId: bonus.id,
    category: bonus.category,
    side,
    leadin: bonus.promptLeadin || '',
    partIndex: 0,
    parts: [{ text: bonus.parts[0].text, choices: makeChoices(sec.seed, `${pub.qIndex}:bonus:0`, bonus.parts[0]) }],
    results: [],
    deadline: side === cs ? null : isTimed(pub) ? at + pub.rules.bonusWindowMs : null,
    nextComputerAt: side === cs ? at + BONUS_COMPUTER_PART_MS : null
  };
  pub.status = 'BONUS';
  events.push({ type: 'bonus_shown', at, data: { questionId: bonus.id, side } });
}

function scoreBonusPart(pub, sec, { actorId, text, choice, at, timedOut, computer }, events) {
  const b = pub.bonus;
  const bonus = sec.bonuses[pub.qIndex];
  const part = bonus.parts[b.partIndex];
  let result;
  let answer = text;
  let close = false;
  let normalized = '';
  if (computer) {
    const planned = sec.plan.bonuses[pub.qIndex].parts[b.partIndex];
    result = planned.correct ? 'correct' : 'incorrect';
    answer = planned.answerText;
  } else if (timedOut) {
    result = 'incorrect';
    answer = null;
  } else if (b.parts[b.partIndex]?.choices && Number.isInteger(choice)) {
    const check = checkChoice(b.parts[b.partIndex].choices, choice, part);
    result = check.result;
    answer = check.picked;
    normalized = check.normalized;
  } else {
    const check = checkAnswer(text, part);
    result = check.result === 'correct' ? 'correct' : 'incorrect';
    close = check.result === 'close';
    normalized = check.normalized;
  }
  const points = result === 'correct' ? pub.rules.bonusPartPoints : 0;
  pub.sides[b.side].score += points;
  b.results.push({
    actorId: actorId || null,
    answer: answer == null ? null : String(answer).slice(0, 120),
    result,
    points,
    close,
    timedOut: !!timedOut,
    canonicalAnswer: part.canonicalAnswer,
    acceptedAnswers: part.acceptedAnswers || [],
    explanation: part.explanation || ''
  });
  events.push({
    type: 'bonus_answer',
    at,
    actor: actorId || null,
    data: { questionId: bonus.id, part: b.partIndex, side: b.side, result, points, close, timedOut: !!timedOut, normalized }
  });
  b.partIndex += 1;
  if (b.partIndex < bonus.parts.length) {
    b.parts.push({ text: bonus.parts[b.partIndex].text, choices: makeChoices(sec.seed, `${pub.qIndex}:bonus:${b.partIndex}`, bonus.parts[b.partIndex]) });
    if (computer) b.nextComputerAt = at + BONUS_COMPUTER_PART_MS;
    else b.deadline = isTimed(pub) ? at + pub.rules.bonusWindowMs : null;
  } else {
    b.deadline = null;
    b.nextComputerAt = null;
    b.done = true;
    const h = pub.history[pub.history.length - 1];
    h.bonus = {
      questionId: bonus.id,
      side: b.side,
      correctParts: b.results.filter((r) => r.result === 'correct').length,
      parts: bonus.parts.length,
      points: b.results.reduce((s, r) => s + r.points, 0)
    };
    pub.status = 'SCORED';
    pub.scoredPhase = 'bonus';
    events.push({ type: 'bonus_ended', at, data: { questionId: bonus.id, side: b.side, points: h.bonus.points } });
  }
}

function completeSession(pub, at, events) {
  pub.status = 'COMPLETE';
  pub.current = pub.current ? { ...pub.current, nextRevealAt: null, deadAt: null, answerDeadline: null } : null;
  const entries = Object.entries(pub.sides);
  let winnerSide = null;
  if (entries.length > 1) {
    const sorted = entries.slice().sort((a, b) => b[1].score - a[1].score);
    winnerSide = sorted[0][1].score === sorted[1][1].score ? 'tie' : sorted[0][0];
  }
  pub.result = { winnerSide, scores: Object.fromEntries(entries.map(([k, s]) => [k, s.score])), completedAt: at };
  events.push({ type: 'session_complete', at, data: pub.result });
}

// ---------------------------------------------------------------------------
// time advancement

/**
 * Fire every scheduled event due by time `t`.
 * opts.reveals: whether clue reveals may fire (false when processing a buzz,
 *   since a reveal not yet written was never seen by the buzzer).
 * opts.grace: how far in the past a computer buzz must be before committing it.
 * stampNow: processing time used to stamp reveals.
 */
function advanceTo(pub, sec, t, opts, stampNow, events) {
  const grace = opts.grace ?? GRACE_MS;
  for (let guard = 0; guard < 200; guard++) {
    if (TERMINAL.has(pub.status) || pub.status === 'PAUSED') return;
    const c = pub.current;

    if (pub.status === 'READING_CLUE') {
      const candidates = [];
      const tc = computerBuzzTime(pub, sec);
      if (tc != null) candidates.push({ kind: 'cbuzz', at: tc, fireBy: tc + grace });
      if (c.nextRevealAt != null && opts.reveals !== false) candidates.push({ kind: 'reveal', at: c.nextRevealAt, fireBy: c.nextRevealAt });
      if (c.deadAt != null) candidates.push({ kind: 'dead', at: c.deadAt, fireBy: c.deadAt });
      if (!candidates.length) return;
      candidates.sort((a, b) => a.at - b.at || (a.kind === 'dead' ? 1 : -1));
      const next = candidates[0];
      if (next.fireBy > t) return;
      if (next.kind === 'reveal') {
        revealClue(pub, sec, Math.max(next.at, stampNow ?? next.at), events);
      } else if (next.kind === 'cbuzz') {
        const plan = sec.plan.tossups[pub.qIndex];
        const clueIndex = plan.afterReading ? c.clueCount - 1 : plan.buzzClue;
        registerBuzz(pub, { actorId: 'computer', side: computerSide(pub), kind: 'computer', at: next.at, clueIndex, reactionMs: plan.delayMs }, events);
      } else {
        endQuestion(pub, sec, null, next.at, events);
      }
      continue;
    }

    if (pub.status === 'BUZZ_LOCKED' && c.buzz?.kind === 'computer') {
      if (c.answerDeadline > t) return;
      const plan = sec.plan.tossups[pub.qIndex];
      scoreComputerAnswer(pub, sec, plan, c.answerDeadline, events);
      continue;
    }

    if (pub.status === 'AWAITING_ANSWER') {
      if (c.answerDeadline == null || c.answerDeadline + ANSWER_GRACE_MS > t) return;
      scoreTossupAnswer(pub, sec, { actorId: c.buzz.actorId, side: c.buzz.side, at: c.answerDeadline, timedOut: true }, events);
      continue;
    }

    if (pub.status === 'BONUS') {
      const b = pub.bonus;
      if (b.nextComputerAt != null) {
        if (b.nextComputerAt > t) return;
        scoreBonusPart(pub, sec, { actorId: 'computer', at: b.nextComputerAt, computer: true }, events);
        continue;
      }
      if (b.deadline == null || b.deadline + ANSWER_GRACE_MS > t) return;
      scoreBonusPart(pub, sec, { at: b.deadline, timedOut: true }, events);
      continue;
    }
    return;
  }
}

function scoreComputerAnswer(pub, sec, plan, at, events) {
  const c = pub.current;
  const q = sec.tossups[pub.qIndex];
  const side = c.buzz.side;
  const interrupted = c.readingDoneAt == null || c.buzz.at < c.readingDoneAt;
  let points = 0;
  let powered = false;
  if (plan.correct) {
    powered = !!(pub.rules.powerEnabled && q.powerClueIndex != null && c.buzz.clueIndex <= q.powerClueIndex);
    points = powered ? pub.rules.powerPoints : pub.rules.tossupPoints;
  } else if (pub.rules.negEnabled && interrupted) {
    points = pub.rules.negPoints;
  }
  pub.sides[side].score += points;
  c.attempts.push({
    actorId: 'computer',
    side,
    kind: 'computer',
    clueIndex: c.buzz.clueIndex,
    buzzAt: c.buzz.at,
    reactionMs: plan.delayMs,
    answer: plan.answerText,
    normalized: null,
    result: plan.correct ? 'correct' : 'incorrect',
    flaggedClose: false,
    timedOut: plan.answerText == null,
    interrupted,
    powered,
    points
  });
  events.push({
    type: 'answer',
    at,
    actor: 'computer',
    data: { questionId: q.id, side, result: plan.correct ? 'correct' : 'incorrect', points, powered, clueIndex: c.buzz.clueIndex, actorType: 'computer' }
  });
  if (plan.correct) {
    endQuestion(pub, sec, side, at, events);
    return;
  }
  c.lockedSides.push(side);
  if (allSidesLocked(pub)) endQuestion(pub, sec, null, at, events);
  else resumeReading(pub, at);
}

// ---------------------------------------------------------------------------
// commands

class CommandError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * Apply one command. Returns { pub, sec, events, ignored?, error? }.
 * cmd: { id, type, actorId, actorRole: 'student'|'teacher'|'host', at, payload }
 */
function applyCommand(pubIn, secIn, cmd, now) {
  const pub = clone(pubIn);
  const sec = clone(secIn);
  const events = [];

  if (cmd.id && sec.processed.includes(cmd.id)) {
    return { pub: pubIn, sec: secIn, events: [], ignored: 'duplicate' };
  }
  const markProcessed = () => {
    if (cmd.id) {
      sec.processed.push(cmd.id);
      if (sec.processed.length > PROCESSED_KEEP) sec.processed = sec.processed.slice(-PROCESSED_KEEP);
    }
  };

  if (TERMINAL.has(pub.status)) {
    markProcessed();
    return { pub, sec, events, ignored: 'terminal' };
  }

  const at = Math.min(cmd.at ?? now, now);

  // Abandoned sessions end; long gaps while reading become an implicit pause.
  if (now - pub.clock > ABANDON_MS && cmd.type !== 'terminate') {
    pub.status = 'TERMINATED';
    pub.terminatedReason = 'abandoned';
    events.push({ type: 'terminated', at: now, data: { reason: 'abandoned' } });
    markProcessed();
    pub.clock = now;
    pub.seq += 1;
    return { pub, sec, events };
  }
  if (
    ['READING_CLUE', 'AWAITING_ANSWER', 'BUZZ_LOCKED', 'BONUS'].includes(pub.status) &&
    now - pub.clock > STALL_MS &&
    pub.mode !== 'live_battle'
  ) {
    const delta = now - pub.clock - 500;
    shiftCurrent(pub, delta);
    events.push({ type: 'recovered', at: now, data: { gapMs: now - pub.clock } });
  }

  let outcome;
  try {
    outcome = handle(pub, sec, cmd, at, now, events);
  } catch (err) {
    if (err instanceof CommandError) {
      markProcessed();
      return { pub: pubIn, sec: { ...secIn, processed: sec.processed }, events: [], error: { code: err.code, message: err.message } };
    }
    throw err;
  }

  markProcessed();
  pub.clock = Math.max(pub.clock, now);
  pub.seq += 1;
  if (outcome?.rejected) return { pub, sec, events, error: outcome.rejected };
  return { pub, sec, events };
}

function requireStatus(pub, ...statuses) {
  if (!statuses.includes(pub.status)) throw new CommandError('bad-state', `Not allowed while ${pub.status}`);
}

function requireController(pub, cmd) {
  // Who may drive pacing: the owner in solo modes, the host (or a teacher) in live battles.
  if (pub.mode === 'live_battle') {
    if (cmd.actorRole === 'teacher' || cmd.actorId === pub.hostUid) return;
    throw new CommandError('forbidden', 'Only the host controls this battle');
  }
  if (cmd.actorId !== pub.ownerStudentId && cmd.actorRole !== 'teacher') throw new CommandError('forbidden', 'Not your session');
}

function handle(pub, sec, cmd, at, now, events) {
  const p = cmd.payload || {};
  const reject = (code, message) => {
    events.push({ type: 'buzz_rejected', at, actor: cmd.actorId, data: { reason: code } });
    return { rejected: { code, message } };
  };
  switch (cmd.type) {
    case 'start': {
      requireController(pub, cmd);
      requireStatus(pub, 'READY');
      events.push({ type: 'session_started', at });
      startQuestion(pub, sec, 0, now, events);
      return;
    }

    case 'sync': {
      advanceTo(pub, sec, now, { reveals: true }, now, events);
      return;
    }

    case 'reveal': {
      // Manual reading (Learn & Practice): reveal the next clue on request.
      requireController(pub, cmd);
      requireStatus(pub, 'READING_CLUE');
      if (!isManual(pub)) throw new CommandError('bad-state', 'Clues reveal automatically');
      const c = pub.current;
      if (c.clues.length >= c.clueCount) throw new CommandError('bad-state', 'No more clues');
      revealClue(pub, sec, now, events);
      return;
    }

    case 'buzz': {
      const side = sideOf(pub, cmd.actorId);
      if (!side || cmd.actorId === 'computer') throw new CommandError('forbidden', 'Not a player in this match');
      // Resolve anything that truly happened before this buzz (e.g. an earlier computer buzz).
      advanceTo(pub, sec, at - 1, { reveals: false, grace: 0 }, now, events);
      const c = pub.current;
      if (!c) throw new CommandError('bad-state', 'No question in play');
      const revealedAsOf = c.revealedAt.filter((t) => t <= at).length;
      const seen = Number.isInteger(p.seenClueIndex) ? p.seenClueIndex : revealedAsOf - 1;
      const clueIndex = Math.max(0, Math.min(seen, revealedAsOf - 1, c.clues.length - 1));
      const lastReveal = c.revealedAt[Math.max(0, clueIndex)] ?? at;
      const reactionMs = Math.max(0, at - lastReveal);

      if (pub.status === 'BUZZ_LOCKED' && c.buzz?.kind === 'computer' && at < c.buzz.at) {
        // Student actually buzzed first; their buzz was still in flight. Student wins the buzz.
        events.push({ type: 'buzz_overridden', at, data: { computerAt: c.buzz.at, studentAt: at } });
        c.computerBuzzed = false;
        c.buzz = null;
        pub.status = 'READING_CLUE';
      }
      // Rejections keep any computer buzz we just resolved, so the player sees it right away.
      if (pub.status !== 'READING_CLUE') return reject('too-late', 'Someone else buzzed first');
      if (c.lockedSides.includes(side)) return reject('locked-out', 'Your side already answered this one');
      const q = sec.tossups[pub.qIndex];
      const choices = pub.rules.answerFormat === 'typed' ? null : makeChoices(sec.seed, `${pub.qIndex}:${c.attempts.length}`, q);
      registerBuzz(pub, { actorId: cmd.actorId, side, kind: 'student', at, clueIndex, reactionMs, choices }, events);
      advanceTo(pub, sec, now, { reveals: false }, now, events);
      return;
    }

    case 'answer': {
      const c = pub.current;
      advanceTo(pub, sec, at - 1, { reveals: false, grace: 0 }, now, events);
      if (pub.status === 'AWAITING_ANSWER') {
        if (c.buzz.actorId !== cmd.actorId) throw new CommandError('forbidden', 'Only the buzzer can answer');
        if (c.answerDeadline != null && at > c.answerDeadline + ANSWER_GRACE_MS) throw new CommandError('too-late', 'Answer window closed');
        scoreTossupAnswer(pub, sec, { actorId: cmd.actorId, side: c.buzz.side, text: p.text, choice: p.choice, at }, events);
        advanceTo(pub, sec, now, { reveals: false }, now, events);
        return;
      }
      if (pub.status === 'BONUS') {
        const b = pub.bonus;
        const side = sideOf(pub, cmd.actorId);
        if (side !== b.side) throw new CommandError('forbidden', 'This bonus belongs to the other side');
        if (Number.isInteger(p.part) && p.part !== b.partIndex) throw new CommandError('stale', 'That part was already scored');
        if (b.deadline != null && at > b.deadline + ANSWER_GRACE_MS) throw new CommandError('too-late', 'Answer window closed');
        scoreBonusPart(pub, sec, { actorId: cmd.actorId, text: p.text, choice: p.choice, at }, events);
        return;
      }
      throw new CommandError('bad-state', `Not allowed while ${pub.status}`);
    }

    case 'skip': {
      // "I don't know" / give up on the current tossup (solo modes only).
      requireController(pub, cmd);
      if (pub.mode === 'live_battle') throw new CommandError('forbidden', 'Not in live battles');
      advanceTo(pub, sec, at - 1, { reveals: false, grace: 0 }, now, events);
      if (pub.status === 'BONUS') {
        if (pub.bonus.side !== sideOf(pub, cmd.actorId)) throw new CommandError('bad-state', 'Not your bonus');
        scoreBonusPart(pub, sec, { actorId: cmd.actorId, at, timedOut: true }, events);
        return;
      }
      requireStatus(pub, 'READING_CLUE', 'AWAITING_ANSWER');
      if (pub.status === 'AWAITING_ANSWER') {
        const c = pub.current;
        scoreTossupAnswer(pub, sec, { actorId: c.buzz.actorId, side: c.buzz.side, at, timedOut: true }, events);
        if (pub.status !== 'READING_CLUE') return;
      }
      // Student passes: let the computer finish its plan quickly, else end the question.
      const side = sideOf(pub, cmd.actorId);
      if (!pub.current.lockedSides.includes(side)) pub.current.lockedSides.push(side);
      events.push({ type: 'pass', at, actor: cmd.actorId, data: { questionId: pub.current.questionId } });
      // Judge by the plan, not computerBuzzTime(): that is null until the planned clue is revealed.
      const cs = computerSide(pub);
      const plan = sec.plan?.tossups?.[pub.qIndex];
      const computerWillBuzz = !!cs && plan?.buzzClue != null && !pub.current.lockedSides.includes(cs) && !pub.current.computerBuzzed;
      if (allSidesLocked(pub) || !computerWillBuzz) {
        // Computer never planned to buzz (or already out): reveal the answer now.
        endQuestion(pub, sec, null, at, events);
      } else {
        // Reveal remaining clues immediately so the computer's plan plays out.
        const c = pub.current;
        while (c.clues.length < c.clueCount) revealClue(pub, sec, now, events);
      }
      return;
    }

    case 'advance': {
      requireController(pub, cmd);
      requireStatus(pub, 'SCORED');
      const bonusDue =
        pub.scoredPhase === 'tossup' &&
        pub.rules.bonusesEnabled &&
        pub.current?.outcome?.winnerSide &&
        sec.bonuses?.[pub.qIndex];
      if (bonusDue) {
        startBonus(pub, sec, pub.current.outcome.winnerSide, now, events);
        return;
      }
      if (pub.qIndex + 1 >= pub.total) {
        completeSession(pub, now, events);
        return;
      }
      startQuestion(pub, sec, pub.qIndex + 1, now, events);
      return;
    }

    case 'pause': {
      requireController(pub, cmd);
      if (['READY', 'SCORED', 'PAUSED'].includes(pub.status)) return;
      pub.resumeStatus = pub.status;
      pub.pausedAt = at;
      pub.status = 'PAUSED';
      events.push({ type: 'paused', at });
      return;
    }

    case 'resume': {
      requireController(pub, cmd);
      requireStatus(pub, 'PAUSED');
      const delta = Math.max(0, now - pub.pausedAt);
      shiftCurrent(pub, delta);
      pub.status = pub.resumeStatus || 'READING_CLUE';
      pub.resumeStatus = null;
      pub.pausedAt = null;
      events.push({ type: 'resumed', at: now, data: { pausedMs: delta } });
      return;
    }

    case 'review': {
      // Student viewed an explanation or saved to review deck (logged only).
      events.push({ type: 'review', at, actor: cmd.actorId, data: { questionId: p.questionId, explanationViewed: !!p.explanationViewed, saved: !!p.saved } });
      return;
    }

    case 'terminate': {
      if (cmd.actorRole !== 'teacher' && cmd.actorId !== pub.hostUid && cmd.actorId !== pub.ownerStudentId) {
        throw new CommandError('forbidden', 'Not allowed');
      }
      pub.status = 'TERMINATED';
      pub.terminatedReason = String(p.reason || 'stopped').slice(0, 200);
      pub.terminatedBy = cmd.actorRole === 'teacher' ? 'teacher' : 'player';
      events.push({ type: 'terminated', at, actor: cmd.actorId, data: { reason: pub.terminatedReason, by: pub.terminatedBy } });
      return;
    }

    default:
      throw new CommandError('unknown', `Unknown command ${cmd.type}`);
  }
}

module.exports = {
  createSession,
  applyCommand,
  advanceTo,
  clueDurationMs,
  computerBuzzTime,
  makeChoices,
  CommandError,
  constants: { GRACE_MS, COMPUTER_THINK_MS, ANSWER_GRACE_MS, STALL_MS, ABANDON_MS, BONUS_COMPUTER_PART_MS }
};
