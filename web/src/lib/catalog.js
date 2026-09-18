import catalog from '@shared/catalog.json';

export { catalog };
export const CATEGORIES = catalog.categories;
export const CATEGORY_IDS = catalog.categories.map((c) => c.id);
export const WORLDS = catalog.worlds;
export const PERSONAS = catalog.personas;
export const BADGES = catalog.badges;
export const AVATARS = catalog.avatars;
export const READING_SPEEDS = catalog.readingSpeeds;
export const DEFAULT_RULES = catalog.defaultRules;

const byId = (list) => Object.fromEntries(list.map((x) => [x.id, x]));
const CAT = byId(CATEGORIES);
const PERSONA = byId(PERSONAS);
const BADGE = byId(BADGES);

export const categoryMeta = (id) => CAT[id] || { id, emoji: '❓', color: '#6d4df2' };
export const personaById = (id) => PERSONA[id];
export const badgeById = (id) => BADGE[id];
export const worldForCategory = (cat) => WORLDS.find((w) => w.category === cat);
export const TIER_LABELS = ['Beginner', 'Developing', 'Intermediate', 'Advanced'];

export function xpForLevel(n) {
  return catalog.levels.xpFactor * n * (n - 1);
}
export function levelForXp(xp = 0) {
  let n = 1;
  while (xpForLevel(n + 1) <= xp) n++;
  return n;
}
export function titleForLevel(level) {
  let title = catalog.levels.titles[0].title;
  for (const t of catalog.levels.titles) if (level >= t.minLevel) title = t.title;
  return title;
}
export function levelProgress(xp = 0) {
  const level = levelForXp(xp);
  const start = xpForLevel(level);
  const next = xpForLevel(level + 1);
  return { level, title: titleForLevel(level), into: xp - start, needed: next - start, pct: Math.round(((xp - start) / (next - start)) * 100) };
}
