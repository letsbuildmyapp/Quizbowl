'use strict';

// Question bank access for the game server. Only published questions with
// rights metadata and an open usage window are ever eligible for play.

const { db, now, toMillis } = require('./common');
const { streamFor } = require('../engine/rng');

const CACHE_MS = 60 * 1000;
let cache = { at: 0, tossups: [], bonuses: [] };

function isPlayable(q, at = now()) {
  if (q.status !== 'published') return false;
  if (!q.license || !q.sourceOwner) return false;
  const end = toMillis(q.usageWindowEnd);
  if (end && end < at) return false;
  if (q.type === 'tossup') return Array.isArray(q.clues) && q.clues.length >= 2 && !!q.canonicalAnswer;
  if (q.type === 'bonus') return Array.isArray(q.parts) && q.parts.length > 0;
  return false;
}

function toGameQuestion(id, q) {
  // Strip admin metadata; keep only what the engine needs.
  const base = {
    id,
    type: q.type,
    setId: q.setId || null,
    category: q.category,
    subcategory: q.subcategory || null,
    difficulty: Number(q.difficulty) || 2,
    gradeBand: q.gradeBand || null,
    promptLeadin: q.promptLeadin || '',
    explanation: q.explanation || '',
    pronunciationNotes: q.pronunciationNotes || null,
    ambiguity: q.ambiguity || 0
  };
  if (q.type === 'tossup') {
    return {
      ...base,
      clues: q.clues.map((c, i) => ({ text: c.text, clueIndex: i, difficultyWeight: Number(c.difficultyWeight ?? 0.5) })),
      powerClueIndex: q.powerClueIndex ?? null,
      canonicalAnswer: q.canonicalAnswer,
      acceptedAnswers: q.acceptedAnswers || [],
      rejectedAnswers: q.rejectedAnswers || [],
      approvedDistractors: q.approvedDistractors || []
    };
  }
  return {
    ...base,
    parts: q.parts.map((p) => ({
      text: p.text,
      canonicalAnswer: p.canonicalAnswer,
      acceptedAnswers: p.acceptedAnswers || [],
      rejectedAnswers: p.rejectedAnswers || [],
      approvedDistractors: p.approvedDistractors || [],
      explanation: p.explanation || ''
    }))
  };
}

async function loadPlayable(force = false) {
  if (!force && now() - cache.at < CACHE_MS && cache.tossups.length) return cache;
  const snap = await db.collection('questions').where('status', '==', 'published').get();
  const at = now();
  const tossups = [];
  const bonuses = [];
  snap.forEach((d) => {
    const q = d.data();
    if (!isPlayable(q, at)) return;
    const gq = toGameQuestion(d.id, q);
    (q.type === 'tossup' ? tossups : bonuses).push(gq);
  });
  cache = { at, tossups, bonuses };
  return cache;
}

function invalidateQuestionCache() {
  cache = { at: 0, tossups: [], bonuses: [] };
}

/**
 * Pick tossups (and aligned bonuses) for a match.
 * filter: { category, difficulty, setId, ids, count, avoidIds, gradeBand }
 */
async function pickQuestions(seed, filter) {
  const { tossups, bonuses } = await loadPlayable();
  const count = Math.max(1, Math.min(20, filter.count || 10));
  let pool = tossups;
  if (filter.ids?.length) pool = pool.filter((q) => filter.ids.includes(q.id));
  if (filter.category) pool = pool.filter((q) => q.category === filter.category);
  if (filter.setId) pool = pool.filter((q) => q.setId === filter.setId);
  if (filter.difficulty) {
    const exact = pool.filter((q) => q.difficulty === Number(filter.difficulty));
    if (exact.length >= count) pool = exact;
  }
  const rng = streamFor(seed, 'questions');
  const avoid = new Set(filter.avoidIds || []);
  const fresh = rng.shuffle(pool.filter((q) => !avoid.has(q.id)));
  const seen = rng.shuffle(pool.filter((q) => avoid.has(q.id)));
  const chosen = [...fresh, ...seen].slice(0, count);

  const used = new Set();
  const bonusRng = streamFor(seed, 'bonuses');
  const shuffledBonuses = bonusRng.shuffle(bonuses);
  const alignedBonuses = chosen.map((t) => {
    const b = shuffledBonuses.find((x) => !used.has(x.id) && x.category === t.category) || shuffledBonuses.find((x) => !used.has(x.id)) || null;
    if (b) used.add(b.id);
    return b;
  });
  return { tossups: chosen, bonuses: alignedBonuses };
}

module.exports = { isPlayable, toGameQuestion, loadPlayable, pickQuestions, invalidateQuestionCache };
