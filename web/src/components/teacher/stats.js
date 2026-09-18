// Pure aggregation helpers over sessionSummaries docs (see docs/DATA_MODEL.md).
// Everything the teacher sees is computed from summaries so totals reconcile
// with the stored game events.
import { CATEGORIES, WORLDS, personaById } from '../../lib/catalog.js';
import { rewards } from '../../lib/rewards.js';

export const DAY_MS = 86400000;

export function totals(summaries) {
  const t = { sessions: 0, seen: 0, answered: 0, correct: 0, early: 0, powers: 0, points: 0 };
  for (const s of summaries) {
    t.sessions += 1;
    t.seen += s.seen || 0;
    t.answered += s.answered || 0;
    t.correct += s.correct || 0;
    t.early += s.early || 0;
    t.powers += s.powers || 0;
    t.points += s.points || 0;
  }
  return t;
}

/** { [category]: { seen, answered, correct } } summed over summaries. */
export function categoryTotals(summaries) {
  const out = {};
  for (const s of summaries) {
    for (const [cat, v] of Object.entries(s.byCategory || {})) {
      const o = (out[cat] ||= { seen: 0, answered: 0, correct: 0 });
      o.seen += v?.seen || 0;
      o.answered += v?.answered || 0;
      o.correct += v?.correct || 0;
    }
  }
  return out;
}

/** Categories in catalog order, plus any unknown ones that showed up in data. */
export function orderedCategories(catTotals) {
  const known = CATEGORIES.map((c) => c.id);
  const extra = Object.keys(catTotals).filter((c) => !known.includes(c));
  return [...known, ...extra];
}

/** Map studentId -> totals + lastPlayed. */
export function byStudent(summaries) {
  const groups = {};
  for (const s of summaries) (groups[s.studentId] ||= []).push(s);
  const out = {};
  for (const [id, list] of Object.entries(groups)) {
    out[id] = { ...totals(list), lastPlayed: Math.max(...list.map((s) => s.completedAt || 0)) };
  }
  return out;
}

/** Computer-opponent results per persona: [{ personaId, name, avatar, played, wins }]. */
export function personaResults(summaries) {
  const out = {};
  for (const s of summaries) {
    if (s.mode !== 'versus' || !s.opponent) continue;
    const id = s.opponent.personaId || 'unknown';
    const meta = personaById(id);
    const o = (out[id] ||= { personaId: id, name: s.opponent.name || meta?.name || 'Computer', avatar: meta?.avatar || '🤖', tier: s.opponent.tier, played: 0, wins: 0 });
    o.played += 1;
    if (s.won) o.wins += 1;
  }
  return Object.values(out).sort((a, b) => b.played - a.played);
}

export const MODE_LABELS = {
  practice: 'Learn & Practice',
  score_attack: 'Score Attack',
  versus: 'Battle the Computer',
  daily: 'Daily Quest',
  review: 'Review',
  live_battle: 'Live Team Battle'
};

export const ACTIVE_SESSION_STATUSES = ['READY', 'READING_CLUE', 'BUZZ_LOCKED', 'AWAITING_ANSWER', 'SCORED', 'BONUS', 'PAUSED'];

/** Percent label without the shared em-dash placeholder: "72%" or "n/a". */
export const pctText = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : 'n/a');

const FIRST_WORLD = WORLDS[0]?.id;
export const unlockedSet = (s) => new Set(s.unlockedWorlds?.length ? s.unlockedWorlds : [FIRST_WORLD]);

/**
 * The locked world the most students are stuck in front of: its prerequisite world is open,
 * it is still locked, and the student has played at least 3 sessions.
 */
export function stuckWorld(activeRoster) {
  const counts = {};
  for (const s of activeRoster) {
    if ((s.stats?.sessions || 0) < 3) continue;
    const open = unlockedSet(s);
    for (const w of WORLDS) {
      const rule = rewards.worldUnlocks[w.id];
      if (!rule || open.has(w.id) || !open.has(rule.world)) continue;
      (counts[w.id] ||= []).push(s);
    }
  }
  const [worldId, students] = Object.entries(counts).sort((a, b) => b[1].length - a[1].length)[0] || [];
  if (!worldId) return null;
  return { worldId, students, rule: rewards.worldUnlocks[worldId] };
}
