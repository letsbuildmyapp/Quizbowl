'use strict';

// Reward economy: unlock rules, world states, chest contents, grants, loadout
// validation. Pure functions over the student doc + rewards.json. Cosmetics
// never touch scoring; the game engine only emits the finished session.

const rewards = require('../shared/rewards.json');
const catalog = require('../shared/catalog.json');
const { streamFor } = require('./rng');

const ITEMS = Object.fromEntries(rewards.cosmetics.map((c) => [c.id, c]));
const CHESTS = Object.fromEntries(rewards.chests.map((c) => [c.id, c]));
const RARITY_ORDER = rewards.rarities.map((r) => r.id);
const RARITY = Object.fromEntries(rewards.rarities.map((r) => [r.id, r]));
const SLOTS = rewards.slots.map((s) => s.id);
const rank = (r) => RARITY_ORDER.indexOf(r);

const WORLD_BY_CATEGORY = Object.fromEntries(catalog.worlds.map((w) => [w.category, w.id]));
const THEMES = Object.fromEntries(rewards.themes.map((t) => [t.id, t]));

function resolveTheme(theme) {
  const base = THEMES[theme?.presetId] || THEMES.quizquest;
  return { ...base, ...(theme || {}) };
}

function isStarter(itemId) {
  return ITEMS[itemId]?.unlock?.type === 'starter';
}

function owns(student, itemId) {
  return isStarter(itemId) || !!student?.inventory?.[itemId];
}

/** Which world a finished session counts as a quest for. */
function sessionWorld(pub) {
  if (pub.category && WORLD_BY_CATEGORY[pub.category]) return WORLD_BY_CATEGORY[pub.category];
  const counts = {};
  for (const h of pub.history || []) counts[h.category] = (counts[h.category] || 0) + 1;
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return top ? WORLD_BY_CATEGORY[top[0]] || null : null;
}

function worldName(id) {
  return catalog.worlds.find((w) => w.id === id)?.name || id;
}

/** Evaluate a map/world rule. Returns { met, have, need, label }. */
function evaluateRule(rule, student) {
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
    const noun = rule.quests === 1 ? 'quest' : 'quests';
    return { met: have >= rule.quests, have, need: rule.quests, label: `Complete ${rule.quests} ${worldName(rule.world)} ${noun}` };
  }
  return { met: false, have: 0, need: 1, label: 'Locked' };
}

function worldUnlockRule(worldId) {
  return rewards.worldUnlocks[worldId] ?? null;
}

/** locked | available | active | completed | mastered, plus the unlock explanation. */
function worldState(worldId, student) {
  const rule = worldUnlockRule(worldId);
  const unlock = evaluateRule(rule, student);
  const quests = student?.worldQuests?.[worldId] || 0;
  const stars = student?.worldStars?.[worldId] || 0;
  let state = 'available';
  if (!unlock.met) state = 'locked';
  else if ((student?.masteredWorlds || []).includes(worldId)) state = 'mastered';
  else if (stars >= 3) state = 'completed';
  else if (quests > 0) state = 'active';
  return { state, unlock, quests, stars };
}

function isMastered(worldId, stats, student) {
  const w = catalog.worlds.find((x) => x.id === worldId);
  if (!w) return false;
  const c = stats?.categories?.[w.category];
  const r = rewards.worldRules;
  if (!c || c.answered < r.masteryMinAnswered) return false;
  const stars = catalog.worldStarThresholds.filter((t) => c.correct >= t).length;
  return stars >= 3 && c.correct / c.answered >= r.masteryAccuracy && (student?.worldQuests?.[worldId] || 0) >= r.masteryQuests;
}

/**
 * Pick a chest's contents. Deterministic when random is off (highest-rarity unowned
 * item first); seeded weighted pick from the published pool when random is on.
 * Everything already owned converts to Crafting Stars.
 */
function chestPool(chestId, { world, schoolCatalog } = {}) {
  const chest = CHESTS[chestId];
  if (!chest) return [];
  const max = rank(chest.maxItemRarity);
  let pool;
  if (chest.schoolOnly) {
    const approved = schoolCatalog?.approved;
    pool = rewards.cosmetics.filter((c) => c.school && (!approved || approved.includes(c.id)));
  } else {
    pool = rewards.cosmetics.filter((c) => c.unlock.type === 'chest' && !c.school && rank(c.rarity) <= max);
    if (world) {
      const local = pool.filter((c) => c.world === world || !c.world);
      if (local.length) pool = local;
    }
  }
  return pool;
}

const WEIGHTS = { common: 6, rare: 3, epic: 1.5, legendary: 1, mythic: 0.5 };

function pickChestContents(chestId, student, { world, schoolCatalog, random = true, seed = 'seed' } = {}) {
  const chest = CHESTS[chestId];
  const pool = chestPool(chestId, { world, schoolCatalog }).filter((c) => !owns(student, c.id));
  if (!pool.length) {
    return { itemId: null, craftingStars: RARITY[chest?.rarity || 'common'].duplicateStars, duplicate: true };
  }
  let item;
  if (random) {
    const rng = streamFor(seed, 'chest', chestId);
    const total = pool.reduce((s, c) => s + WEIGHTS[c.rarity], 0);
    let roll = rng.next() * total;
    item = pool.find((c) => (roll -= WEIGHTS[c.rarity]) <= 0) || pool[pool.length - 1];
  } else {
    item = pool.slice().sort((a, b) => rank(b.rarity) - rank(a.rarity))[0];
  }
  return { itemId: item.id, craftingStars: 0, duplicate: false };
}

/** Items a student qualifies for by level/badge/streak (auto-granted once). */
function autoUnlocks(student) {
  const out = [];
  for (const c of rewards.cosmetics) {
    if (owns(student, c.id)) continue;
    const u = c.unlock;
    if (u.type === 'level' && (student.level || 1) >= u.value) out.push(c.id);
    else if (u.type === 'badge' && (student.badges || []).includes(u.value)) out.push(c.id);
    else if (u.type === 'streak' && (student.streak?.best || 0) >= u.value) out.push(c.id);
    else if (u.type === 'all_worlds_mastered' && (student.masteredWorlds || []).length >= catalog.worlds.length) out.push(c.id);
  }
  return out;
}

function makeItemGrant(id, itemId, source, at) {
  const item = ITEMS[itemId];
  return { id, type: 'item', itemId, chestId: null, rarity: item.rarity, craftingStars: 0, duplicate: false, source, createdAt: at, acknowledgedAt: null };
}

function makeChestGrant(id, chestId, contents, source, at) {
  const chest = CHESTS[chestId];
  return {
    id,
    type: 'chest',
    chestId,
    itemId: contents.itemId,
    rarity: contents.itemId ? ITEMS[contents.itemId].rarity : chest.rarity,
    chestRarity: chest.rarity,
    craftingStars: contents.craftingStars,
    duplicate: contents.duplicate,
    source,
    createdAt: at,
    acknowledgedAt: null
  };
}

/** Apply a list of grants to a student (inventory + crafting stars). Returns the doc patch. */
function applyGrants(student, grants) {
  const inventory = { ...(student.inventory || {}) };
  let craftingStars = student.craftingStars || 0;
  for (const g of grants) {
    if (g.itemId && !inventory[g.itemId] && !isStarter(g.itemId)) {
      inventory[g.itemId] = { earnedAt: g.createdAt, source: g.source, grantId: g.id, isNew: true, duplicates: 0 };
    } else if (g.itemId) {
      // Already owned (earned twice): convert.
      const r = RARITY[ITEMS[g.itemId].rarity];
      inventory[g.itemId] = { ...inventory[g.itemId], duplicates: (inventory[g.itemId]?.duplicates || 0) + 1 };
      g.duplicate = true;
      g.craftingStars = (g.craftingStars || 0) + r.duplicateStars;
    }
    craftingStars += g.craftingStars || 0;
  }
  return { inventory, craftingStars };
}

/**
 * Grants earned by a finished session. before/after are the student doc before
 * and after progression; returns grants with deterministic idempotency ids.
 */
function grantsForSession({ before, after, sessionId, pub, won, at, classRewards, schoolCatalog, world }) {
  const grants = [];
  const random = classRewards?.randomChests !== false;
  // Contents are resolved against the evolving inventory so two chests don't grant the same item.
  const working = { ...after, inventory: { ...(after.inventory || {}) } };
  const addChest = (id, chestId, source, opts = {}) => {
    const contents = pickChestContents(chestId, working, { random, seed: `${id}:${sessionId}`, schoolCatalog, world: opts.world });
    const g = makeChestGrant(id, chestId, contents, source, at);
    if (g.itemId) working.inventory[g.itemId] = { pending: true };
    grants.push(g);
  };
  for (const rule of rewards.grantRules) {
    if (rule.event === 'LEVEL_UP') {
      for (let L = (before.level || 1) + 1; L <= (after.level || 1); L++) {
        if (L % rule.every === 0) addChest(`level-${L}`, rule.chest, { rule: rule.id, sessionId });
      }
    } else if (rule.event === 'STREAK') {
      const prev = before.streak?.current || 0;
      const cur = after.streak?.current || 0;
      if (prev < rule.value && cur >= rule.value) addChest(`streak-${rule.value}-${after.streak.lastDay}`, rule.chest, { rule: rule.id, sessionId });
    } else if (rule.event === 'FIRST_WIN') {
      if (won && pub.opponent && !(before.beatenPersonas || []).length) addChest('first-win', rule.chest, { rule: rule.id, sessionId });
    } else if (rule.event === 'BOSS_DEFEATED') {
      if (won && pub.battle === 'boss' && pub.world && !(before.bossesDefeated || []).includes(pub.world)) {
        addChest(`boss-${pub.world}`, rule.chest, { rule: rule.id, sessionId, world: pub.world }, { world: pub.world });
      }
    } else if (rule.event === 'WORLD_MASTERED') {
      for (const w of after.masteredWorlds || []) {
        if (!(before.masteredWorlds || []).includes(w)) addChest(`mastery-${w}`, rule.chest, { rule: rule.id, sessionId, world: w }, { world: w });
      }
    }
  }
  for (const itemId of autoUnlocks(working)) {
    grants.push(makeItemGrant(`unlock-${itemId}`, itemId, { rule: 'unlock', sessionId }, at));
    working.inventory[itemId] = { pending: true };
  }
  return grants;
}

/** Validate a loadout against ownership, slots, and school availability. */
function validateLoadout(loadout, student, { schoolCatalog } = {}) {
  const errors = [];
  const out = {};
  for (const slot of SLOTS) {
    const id = loadout?.[slot] ?? null;
    if (id == null) {
      if (slot === 'paint' || slot === 'face') errors.push(`${slot} is required`);
      out[slot] = null;
      continue;
    }
    const item = ITEMS[id];
    if (!item || item.slot !== slot) {
      errors.push(`${id} doesn't fit the ${slot} slot`);
      continue;
    }
    if (!owns(student, id)) {
      errors.push(`${item.name} isn't unlocked yet`);
      continue;
    }
    if (item.school && schoolCatalog?.approved && !schoolCatalog.approved.includes(id)) {
      errors.push(`${item.name} isn't available at your school`);
      continue;
    }
    out[slot] = id;
  }
  return { ok: errors.length === 0, loadout: out, errors };
}

/** Human-readable requirement for a locked item. */
function unlockLabel(item) {
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

module.exports = {
  rewards,
  ITEMS,
  CHESTS,
  RARITY,
  RARITY_ORDER,
  SLOTS,
  resolveTheme,
  isStarter,
  owns,
  sessionWorld,
  evaluateRule,
  worldState,
  worldUnlockRule,
  isMastered,
  chestPool,
  pickChestContents,
  autoUnlocks,
  makeItemGrant,
  makeChestGrant,
  applyGrants,
  grantsForSession,
  validateLoadout,
  unlockLabel
};
