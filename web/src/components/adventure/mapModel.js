// Pure helpers for the Adventure overworld: map geometry, path graph, labels.
// Coordinates in rewards.map are % of the island image; "map units" are image pixels.
import { rewards, worldState, mapObjectState, CHESTS, worldName } from '../../lib/rewards.js';
import { WORLDS } from '../../lib/catalog.js';

export const MAP = rewards.map;
export const MAP_W = MAP.width;
export const MAP_H = MAP.height;
export const ASPECT = MAP_W / MAP_H;
export const DEFAULT_WORLD = 'science-lab';

export const WORLD_BY_ID = Object.fromEntries(WORLDS.map((w) => [w.id, w]));
export const GATE_BY_WORLD = Object.fromEntries(MAP.entrances.map((e) => [e.world, e]));

/** % position -> map units. */
export const toUnits = (p) => ({ x: (p.x / 100) * MAP_W, y: (p.y / 100) * MAP_H });

/** Where the QuizBot's feet go when standing at a world's gate (% of the image). */
export function standPoint(worldId) {
  const g = GATE_BY_WORLD[worldId] || GATE_BY_WORLD[DEFAULT_WORLD];
  // Feet sit in front of and slightly right of the door so the plaque badge stays visible.
  return g.floating ? { x: g.x, y: g.y + 4 } : { x: g.x + 2.5, y: Math.min(g.y + 14, 95) };
}

/** Quadratic curve between two gates, bulging gently downward (roads dip on the art). */
export function pathCurve(fromWorld, toWorld) {
  const a = toUnits(GATE_BY_WORLD[fromWorld]);
  const b = toUnits(GATE_BY_WORLD[toWorld]);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  let nx = -dy / len;
  let ny = dx / len;
  if (Math.abs(dx) >= Math.abs(dy) ? ny < 0 : nx < 0) {
    nx = -nx;
    ny = -ny;
  }
  const k = Math.min(0.14 * len, 60);
  const c = { x: (a.x + b.x) / 2 + nx * k, y: (a.y + b.y) / 2 + ny * k };
  return { a, b, c, len };
}

export function curvePoint({ a, b, c }, t) {
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
}

export function neighbors(worldId) {
  return MAP.paths.flatMap((p) => (p.from === worldId ? [p.to] : p.to === worldId ? [p.from] : []));
}

/** Shortest route between two worlds through unlocked gates (inclusive), or null. */
export function route(from, to, isOpen) {
  if (from === to) return [from];
  const prev = { [from]: null };
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift();
    for (const n of neighbors(cur)) {
      if (n in prev || !isOpen(n)) continue;
      prev[n] = cur;
      if (n === to) {
        const out = [to];
        let p = cur;
        while (p) {
          out.unshift(p);
          p = prev[p];
        }
        return out;
      }
      queue.push(n);
    }
  }
  return null;
}

/** Unlocked neighbor that best matches an arrow direction ({dx,dy} unit vector). */
export function neighborInDirection(worldId, dir, isOpen) {
  const here = toUnits(GATE_BY_WORLD[worldId]);
  let best = null;
  let bestScore = 0.2;
  for (const n of neighbors(worldId)) {
    if (!isOpen(n)) continue;
    const p = toUnits(GATE_BY_WORLD[n]);
    const vx = p.x - here.x;
    const vy = p.y - here.y;
    const len = Math.hypot(vx, vy) || 1;
    const score = (vx * dir.dx + vy * dir.dy) / len;
    if (score > bestScore) {
      bestScore = score;
      best = n;
    }
  }
  return best;
}

export const STATE_TEXT = {
  locked: 'Locked',
  available: 'Ready to explore',
  active: 'In progress',
  completed: 'All stars earned',
  mastered: 'Mastered'
};

export const starText = (n) => `${'★'.repeat(n)}${'☆'.repeat(Math.max(0, 3 - n))}`;

export function gateInfo(worldId, student) {
  const world = WORLD_BY_ID[worldId];
  const ws = worldState(worldId, student);
  const stars = Math.min(3, ws.stars);
  const name = world?.name || worldName(worldId);
  const stateText = ws.state === 'locked' ? ws.unlock.label : STATE_TEXT[ws.state];
  const label =
    ws.state === 'locked'
      ? `${name} entrance, locked. ${ws.unlock.label}. ${ws.unlock.have} of ${ws.unlock.need} done.`
      : `${name} entrance, ${STATE_TEXT[ws.state].toLowerCase()}, ${stars} of 3 stars`;
  return { world, ws, stars, name, stateText, label };
}

function objectName(obj, kind) {
  if (kind === 'chest') return CHESTS[obj.chest]?.name || 'Treasure chest';
  const n = obj.id.match(/(\d+)$/)?.[1];
  return `${worldName(obj.world)} star${n ? ` ${n}` : ''}`;
}

export function objectInfo(obj, kind, student) {
  const st = mapObjectState(obj, student);
  const name = objectName(obj, kind);
  const rarity = kind === 'chest' ? CHESTS[obj.chest]?.rarity || 'common' : null;
  const status = st.claimed ? (kind === 'chest' ? 'opened' : 'collected') : st.ready ? (kind === 'chest' ? 'ready to open' : 'ready to collect') : 'not ready';
  const req = !st.claimed && !st.ready ? `${st.rule.label} (${st.rule.have} of ${st.rule.need})` : null;
  const label = `${name}${rarity ? `, ${rarity}` : ''}, ${status}${req ? `. ${req}` : ''}`;
  return { ...st, name, rarity, status, req, label };
}

export function startWorld(student) {
  const w = student?.lastWorld;
  if (w && GATE_BY_WORLD[w] && worldState(w, student).state !== 'locked') return w;
  return DEFAULT_WORLD;
}
