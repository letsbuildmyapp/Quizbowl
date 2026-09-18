// Client view of the reward catalog. Mirrors functions/engine/rewards.js for
// display only; the server stays authoritative for every grant and claim.
import rewards from '@shared/rewards.json';
import catalog from '@shared/catalog.json';

export { rewards };
export const ITEMS = Object.fromEntries(rewards.cosmetics.map((c) => [c.id, c]));
export const CHESTS = Object.fromEntries(rewards.chests.map((c) => [c.id, c]));
export const RARITY = Object.fromEntries(rewards.rarities.map((r) => [r.id, r]));
export const RARITY_ORDER = rewards.rarities.map((r) => r.id);
export const SLOTS = rewards.slots;
export const RIVALS = Object.fromEntries(rewards.rivals.map((r) => [r.id, r]));
export const ARENAS = rewards.arenas;
export const THEMES = Object.fromEntries(rewards.themes.map((t) => [t.id, t]));
export const DEFAULT_THEME = THEMES.quizquest;
const WORLDS = Object.fromEntries(catalog.worlds.map((w) => [w.id, w]));

export const worldName = (id) => WORLDS[id]?.name || id;
export const rivalsForWorld = (worldId, kind) => rewards.rivals.filter((r) => r.world === worldId && (!kind || r.kind === kind));

export function resolveTheme(theme) {
  const base = THEMES[theme?.presetId] || DEFAULT_THEME;
  return { ...base, ...(theme || {}) };
}

export function isStarter(itemId) {
  return ITEMS[itemId]?.unlock?.type === 'starter';
}

export function owns(student, itemId) {
  return isStarter(itemId) || !!student?.inventory?.[itemId];
}

export function currentLoadout(student) {
  return { ...rewards.starterLoadout, ...(student?.loadout || {}) };
}

export function evaluateRule(rule, student) {
  if (!rule) return { met: true, have: 0, need: 0, label: 'Open' };
  if (rule.questStars != null && !rule.world) {
    const have = student?.questStars || 0;
    return { met: have >= rule.questStars, have, need: rule.questStars, label: `Collect ${rule.questStars} Quest Stars` };
  }
  if (rule.questStars != null && rule.world) {
    const have = (student?.claimedMap || []).filter((id) => rewards.map.stars.find((s) => s.id === id)?.world === rule.world).length;
    return { met: have >= rule.questStars, have, need: rule.questStars, label: `Collect ${rule.questStars} ${worldName(rule.world)} stars` };
  }
  if (rule.quests != null) {
    const have = student?.worldQuests?.[rule.world] || 0;
    return { met: have >= rule.quests, have, need: rule.quests, label: `Complete ${rule.quests} ${worldName(rule.world)} ${rule.quests === 1 ? 'quest' : 'quests'}` };
  }
  return { met: false, have: 0, need: 1, label: 'Locked' };
}

/** locked | available | active | completed | mastered, plus unlock explanation and boss readiness. */
export function worldState(worldId, student) {
  const unlock = evaluateRule(rewards.worldUnlocks[worldId] ?? null, student);
  const quests = student?.worldQuests?.[worldId] || 0;
  const stars = student?.worldStars?.[worldId] || 0;
  let state = 'available';
  if (!unlock.met) state = 'locked';
  else if ((student?.masteredWorlds || []).includes(worldId)) state = 'mastered';
  else if (stars >= 3) state = 'completed';
  else if (quests > 0) state = 'active';
  const bossNeed = rewards.battles.boss.requiresQuests;
  return {
    state,
    unlock,
    quests,
    stars,
    bossReady: unlock.met && quests >= bossNeed,
    bossLabel: `Complete ${bossNeed} ${worldName(worldId)} quests to challenge the boss`,
    bossDefeated: (student?.bossesDefeated || []).includes(worldId)
  };
}

export function mapObjectState(obj, student) {
  const claimed = (student?.claimedMap || []).includes(obj.id);
  const rule = evaluateRule(obj.rule, student);
  return { claimed, ready: !claimed && rule.met, rule };
}

export function botEvolution(level = 1) {
  let t = rewards.botEvolutions[0];
  for (const e of rewards.botEvolutions) if (level >= e.minLevel) t = e;
  return t;
}

export function unlockLabel(item) {
  const u = item.unlock;
  switch (u.type) {
    case 'starter':
      return 'Starter item';
    case 'level':
      return `Reach level ${u.value}`;
    case 'badge':
      return `Earn the ${catalog.badges.find((b) => b.id === u.value)?.name || u.value} badge`;
    case 'streak':
      return `Play ${u.value} days in a row`;
    case 'chest':
      return item.world ? `Found in ${worldName(item.world)} chests` : 'Found in treasure chests';
    case 'school_quest':
      return "Complete your school's weekly quest";
    case 'teacher_award':
      return 'Awarded by your teacher';
    case 'all_worlds_mastered':
      return 'Master every world';
    default:
      return 'Keep playing to unlock';
  }
}

export function chestPool(chestId, { world, schoolCatalog } = {}) {
  const chest = CHESTS[chestId];
  if (!chest) return [];
  const max = RARITY_ORDER.indexOf(chest.maxItemRarity);
  if (chest.schoolOnly) return rewards.cosmetics.filter((c) => c.school && (!schoolCatalog?.approved || schoolCatalog.approved.includes(c.id)));
  let pool = rewards.cosmetics.filter((c) => c.unlock.type === 'chest' && !c.school && RARITY_ORDER.indexOf(c.rarity) <= max);
  if (world) {
    const local = pool.filter((c) => c.world === world || !c.world);
    if (local.length) pool = local;
  }
  return pool;
}
