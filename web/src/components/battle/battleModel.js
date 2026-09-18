// Pure presentation helpers for the battle scene. Nothing here affects scoring:
// HP is derived from the server's scores, only to make the battle readable.
import { ARENAS } from '../../lib/rewards.js';
import { worldForCategory } from '../../lib/catalog.js';

export const DEFAULT_WORLD = 'science-lab';
export const DUMMY_IMAGE = '/art/rivals/rookie-robot.webp';

/** Which world's arena to paint: the session's world, else the first question's category. */
export function arenaWorld(session) {
  if (session?.world && ARENAS[session.world]) return session.world;
  const cat = session?.category || session?.history?.[0]?.category || (session?.qIndex === 0 ? session?.current?.category : null);
  const w = cat ? worldForCategory(cat) : null;
  return w && ARENAS[w.id] ? w.id : cat ? DEFAULT_WORLD : null;
}

export function arenaFor(worldId) {
  return ARENAS[worldId] || ARENAS[DEFAULT_WORLD];
}

/** Who stands on the far platform. */
export function foeView(session, mySide) {
  const otherSide = mySide === 'B' ? 'A' : 'B';
  if (session.mode === 'live_battle') {
    const s = session.sides[otherSide] || {};
    return { type: 'team', side: otherSide, name: s.name || 'Other team', emoji: s.emoji || '🛡️', tag: 'Team', color: '#e5484d', hp: true };
  }
  if (session.opponent) {
    const r = session.rival;
    const battle = session.battle;
    return {
      type: 'rival',
      side: otherSide,
      id: r?.id || null,
      name: session.opponent.name || r?.name || 'Rival',
      image: r?.image || null,
      emoji: session.opponent.avatar || '🤖',
      color: r?.color || '#e5484d',
      tag: battle === 'boss' ? 'Boss' : battle === 'wild' ? 'Wild' : 'Rival',
      boss: battle === 'boss',
      wild: battle === 'wild',
      level: levelLabel(session.opponent),
      intro: r?.intro || session.opponent.intro || null,
      defeat: r?.defeat || null,
      lines: session.opponent.lines || {},
      hp: true
    };
  }
  return {
    type: 'dummy',
    side: null,
    name: 'Training Dummy',
    image: DUMMY_IMAGE,
    color: '#8b93b8',
    tag: session.mode === 'score_attack' ? 'Score Attack' : 'Practice',
    hp: false
  };
}

const TIER_LEVEL = [5, 12, 20, 30];
/** A friendly "Lv" number plus the difficulty word, from the opponent persona. */
export function levelLabel(opponent) {
  if (!opponent) return null;
  let tier = opponent.tier;
  if (tier == null || tier < 0) {
    // Adaptive rival: ladder level 0..6 maps across the same range.
    const a = opponent.adaptiveLevel ?? 2;
    return { lv: 5 + Math.round(a * 4.5), word: opponent.difficulty || 'Personalized' };
  }
  tier = Math.max(0, Math.min(3, tier));
  return { lv: TIER_LEVEL[tier], word: opponent.difficulty || '' };
}

/**
 * HP (0..100) for a side. Each point the OTHER side scores removes
 * points / (0.6 * total * 10) of the bar. Nobody faints before the final
 * question ends (min 8); at COMPLETE the loser drops to 0.
 */
export function hpFor(session, side) {
  const sides = session.sides || {};
  const other = Object.keys(sides).find((k) => k !== side);
  if (!other) return 100;
  const pool = 0.6 * Math.max(1, session.total) * 10;
  const taken = Math.max(0, sides[other]?.score || 0);
  const raw = Math.round(100 - (taken / pool) * 100);
  if (session.status === 'COMPLETE') {
    const winner = session.result?.winnerSide;
    if (winner && winner !== 'tie' && winner !== side) return 0;
    return Math.max(8, Math.min(100, raw));
  }
  return Math.max(8, Math.min(100, raw));
}

export function hpTone(hp) {
  if (hp > 50) return 'good';
  if (hp > 20) return 'warn';
  return 'low';
}

export function isReducedMotion() {
  if (typeof window === 'undefined') return false;
  if (document.documentElement?.dataset?.reducedMotion === 'true') return true;
  return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}
