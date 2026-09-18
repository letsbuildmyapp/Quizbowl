'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../engine/rewards');
const engine = require('../engine');

const base = () => ({ level: 1, xp: 0, inventory: {}, badges: [], streak: { current: 0, best: 0 }, worldQuests: {}, claimedMap: [], questStars: 0, masteredWorlds: [] });

test('catalog integrity: every cosmetic has a valid slot, rarity and unlock; chests and map objects reference real things', () => {
  const slots = new Set(R.SLOTS);
  for (const c of R.rewards.cosmetics) {
    assert.ok(slots.has(c.slot), `${c.id} slot`);
    assert.ok(R.RARITY[c.rarity], `${c.id} rarity`);
    assert.ok(c.unlock?.type, `${c.id} unlock`);
  }
  for (const slot of R.SLOTS) assert.ok(R.rewards.cosmetics.some((c) => c.slot === slot), `no items for ${slot}`);
  for (const ch of R.rewards.map.chests) assert.ok(R.CHESTS[ch.chest]);
  for (const g of R.rewards.grantRules) if (g.chest) assert.ok(R.CHESTS[g.chest]);
  const starter = R.rewards.starterLoadout;
  assert.ok(R.validateLoadout(starter, base()).ok, 'starter loadout valid');
});

test('unlock rules explain exact prerequisites and flip when met', () => {
  const s = base();
  const ws = R.worldState('geography-galaxy', s);
  assert.equal(ws.state, 'locked');
  assert.equal(ws.unlock.label, 'Complete 3 Science Lab quests');
  assert.equal(R.worldState('science-lab', s).state, 'available');
  s.worldQuests['science-lab'] = 3;
  assert.equal(R.worldState('geography-galaxy', s).state, 'available');
  s.worldQuests['geography-galaxy'] = 1;
  assert.equal(R.worldState('geography-galaxy', s).state, 'active');
  const starRule = R.rewards.map.chests.find((c) => c.id === 'mapchest-crossroads').rule;
  assert.equal(R.evaluateRule(starRule, s).label, 'Collect 4 Quest Stars');
  assert.equal(R.evaluateRule(starRule, { ...s, questStars: 4 }).met, true);
});

test('chest contents: deterministic when random is off, seeded when on, never an owned item, duplicates become Crafting Stars', () => {
  const s = base();
  const a = R.pickChestContents('chest-rare', s, { random: false, world: 'space-station' });
  const b = R.pickChestContents('chest-rare', s, { random: false, world: 'space-station' });
  assert.deepEqual(a, b);
  assert.equal(R.ITEMS[a.itemId].rarity, 'rare');
  const r1 = R.pickChestContents('chest-epic', s, { random: true, seed: 'x' });
  const r2 = R.pickChestContents('chest-epic', s, { random: true, seed: 'x' });
  assert.deepEqual(r1, r2, 'same seed, same pick');
  for (let i = 0; i < 40; i++) {
    const pick = R.pickChestContents('chest-epic', s, { random: true, seed: `s${i}` });
    assert.ok(R.RARITY_ORDER.indexOf(R.ITEMS[pick.itemId].rarity) <= R.RARITY_ORDER.indexOf('epic'));
    assert.ok(!R.ITEMS[pick.itemId].school, 'no school gear in general chests');
  }
  // Own the whole common pool -> duplicate conversion.
  const pool = R.chestPool('chest-common', {});
  const full = { ...s, inventory: Object.fromEntries(pool.map((c) => [c.id, { earnedAt: 1 }])) };
  const dupe = R.pickChestContents('chest-common', full, { random: true, seed: 'z' });
  assert.equal(dupe.itemId, null);
  assert.equal(dupe.duplicate, true);
  assert.equal(dupe.craftingStars, R.RARITY.common.duplicateStars);
});

test('organization catalog filtering: school chests only contain approved school gear', () => {
  const approved = ['head-school', 'paint-school'];
  for (let i = 0; i < 20; i++) {
    const pick = R.pickChestContents('chest-school', base(), { random: true, seed: `q${i}`, schoolCatalog: { approved } });
    assert.ok(approved.includes(pick.itemId));
  }
  const v = R.validateLoadout({ ...R.rewards.starterLoadout, held: 'buzzer-school' }, { ...base(), inventory: { 'buzzer-school': {} } }, { schoolCatalog: { approved } });
  assert.equal(v.ok, false);
  assert.match(v.errors[0], /isn't available at your school/);
});

test('loadout validation: ownership, slot fit, required slots', () => {
  const s = { ...base(), inventory: { 'head-wizard': { earnedAt: 1 } } };
  assert.ok(R.validateLoadout({ ...R.rewards.starterLoadout, headgear: 'head-wizard' }, s).ok);
  assert.equal(R.validateLoadout({ ...R.rewards.starterLoadout, headgear: 'head-crown' }, s).ok, false);
  assert.equal(R.validateLoadout({ ...R.rewards.starterLoadout, headgear: 'back-jetpack' }, s).ok, false);
  assert.equal(R.validateLoadout({ ...R.rewards.starterLoadout, paint: null }, s).ok, false);
});

test('session grants have deterministic idempotency keys and never double-grant', () => {
  const before = base();
  const after = { ...before, level: 10, streak: { current: 3, best: 3, lastDay: '2026-09-18' }, masteredWorlds: ['science-lab'] };
  const pub = { opponent: { personaId: 'rookie-robot' } };
  const g1 = R.grantsForSession({ before, after, sessionId: 's1', pub, won: true, at: 1, classRewards: { randomChests: true } });
  const g2 = R.grantsForSession({ before, after, sessionId: 's1', pub, won: true, at: 1, classRewards: { randomChests: true } });
  assert.deepEqual(g1.map((g) => g.id), g2.map((g) => g.id));
  const ids = g1.map((g) => g.id);
  assert.ok(ids.includes('level-5') && ids.includes('level-10'));
  assert.ok(ids.includes('streak-3-2026-09-18'));
  assert.ok(ids.includes('first-win'));
  assert.ok(ids.includes('mastery-science-lab'));
  assert.ok(ids.includes('unlock-fx-sparkles') && ids.includes('unlock-pet-robot'));
  const items = g1.map((g) => g.itemId).filter(Boolean);
  assert.equal(new Set(items).size, items.length, 'no two grants contain the same item');
  const legendary = g1.find((g) => g.id === 'mastery-science-lab');
  assert.equal(legendary.chestRarity, 'legendary');
  // Applying the same grants twice: second application converts to duplicates, never two inventory rows.
  const once = R.applyGrants(before, g1.map((g) => ({ ...g })));
  const twice = R.applyGrants({ ...before, ...once }, g1.filter((g) => g.itemId).map((g) => ({ ...g, craftingStars: 0 })));
  assert.equal(Object.keys(twice.inventory).length, Object.keys(once.inventory).length);
  assert.ok(twice.craftingStars > once.craftingStars);
});

test('cosmetics never affect scoring: XP rules come from configuration and ignore the loadout', () => {
  const { buildSession, Driver } = require('./helpers');
  const d = new Driver(buildSession({ mode: 'practice', n: 2 }));
  d.cmd('start', 0);
  d.cmd('skip', 10);
  d.cmd('advance', 20);
  d.cmd('skip', 30);
  d.cmd('advance', 40);
  const plain = engine.applySessionRewards(base(), d.pub, { now: Date.UTC(2026, 8, 18, 15), studentId: 'stu1' });
  const decked = engine.applySessionRewards({ ...base(), loadout: { paint: 'paint-gold', face: 'face-shades', headgear: 'head-crown', held: 'buzzer-champion' } }, d.pub, { now: Date.UTC(2026, 8, 18, 15), studentId: 'stu1' });
  assert.equal(plain.xpEarned, decked.xpEarned);
  assert.equal(plain.xpEarned, R.rewards.xpRules.sessionComplete);
});

test('world quests and mastery from sessions', () => {
  const { buildSession, Driver } = require('./helpers');
  const d = new Driver(buildSession({ mode: 'practice', n: 1 }));
  d.pub.category = 'Science';
  d.cmd('start', 0);
  d.cmd('skip', 10);
  d.cmd('advance', 20);
  const out = engine.applySessionRewards(base(), d.pub, { now: Date.UTC(2026, 8, 18, 15), studentId: 'stu1' });
  assert.equal(out.update.worldQuests['science-lab'], 1);
  assert.equal(out.questWorld, 'science-lab');
  const stats = { categories: { Science: { seen: 40, answered: 30, correct: 30 } } };
  assert.equal(R.isMastered('science-lab', stats, { worldQuests: { 'science-lab': 5 } }), true);
  assert.equal(R.isMastered('science-lab', stats, { worldQuests: { 'science-lab': 4 } }), false);
});
