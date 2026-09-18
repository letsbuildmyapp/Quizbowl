'use strict';

// Rewards and progression: XP, levels, streaks, badges, knowledge cards,
// world stars/unlocks, personal bests, and the post-match recommendation.
// Pure: (student doc, finished session) -> updates.

const catalog = require('../shared/catalog.json');
const rewardsCatalog = require('../shared/rewards.json');
const { sessionWorld, evaluateRule, isMastered } = require('./rewards');

// XP values are configuration (rewards.json xpRules), not constants here.
const XP = rewardsCatalog.xpRules;

function levelForXp(xp) {
  // xp needed to reach level n = factor * n * (n - 1)
  const f = catalog.levels.xpFactor;
  let n = 1;
  while (f * (n + 1) * n <= xp) n++;
  return n;
}

function xpForLevel(n) {
  return catalog.levels.xpFactor * n * (n - 1);
}

function titleForLevel(level) {
  let title = catalog.levels.titles[0].title;
  for (const t of catalog.levels.titles) if (level >= t.minLevel) title = t.title;
  return title;
}

function dayKey(ts, timeZone = 'America/New_York') {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts));
}

function weekKey(ts, timeZone = 'America/New_York') {
  const [y, m, d] = dayKey(ts, timeZone).split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dow = (date.getUTCDay() + 6) % 7; // Monday = 0
  date.setUTCDate(date.getUTCDate() - dow + 3); // Thursday of this week
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((date - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function previousDay(key) {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d - 1));
  return date.toISOString().slice(0, 10);
}

function starsFor(correct) {
  return catalog.worldStarThresholds.filter((t) => correct >= t).length;
}

/** Per-student stats for one finished session. */
function summarizeForStudent(pub, studentId) {
  const side = pub.participants.find((p) => p.id === studentId)?.side;
  const byCategory = {};
  const topics = new Set();
  const topicsCorrect = [];
  let seen = 0;
  let answered = 0;
  let correct = 0;
  let powers = 0;
  let early = 0;
  let clueFractionSum = 0;
  let negs = 0;
  let bonusParts = 0;
  let bonusCorrect = 0;
  let longestStreak = 0;
  let run = 0;
  const missed = [];
  const closeAnswers = [];

  for (const h of pub.history) {
    seen += 1;
    const cat = (byCategory[h.category] ||= { seen: 0, answered: 0, correct: 0 });
    cat.seen += 1;
    if (h.subcategory) topics.add(h.subcategory);
    const mine = (h.attempts || []).filter((a) => a.actorId === studentId);
    if (mine.length) {
      answered += 1;
      cat.answered += 1;
    }
    const right = mine.find((a) => a.result === 'correct');
    if (right) {
      correct += 1;
      cat.correct += 1;
      run += 1;
      longestStreak = Math.max(longestStreak, run);
      if (right.powered) powers += 1;
      if (right.clueIndex < h.clueCount - 1) early += 1;
      clueFractionSum += h.clueCount > 1 ? right.clueIndex / (h.clueCount - 1) : 1;
      if (h.subcategory) topicsCorrect.push({ topic: h.subcategory, category: h.category });
    } else {
      run = 0;
      missed.push({ questionId: h.questionId, category: h.category, canonicalAnswer: h.canonicalAnswer, computerBuzzClue: null });
    }
    for (const a of mine) {
      if (a.points < 0) negs += 1;
      if (a.flaggedClose) closeAnswers.push({ questionId: h.questionId, answer: a.answer, canonicalAnswer: h.canonicalAnswer, part: null });
    }
    if (h.bonus && h.bonus.side === side) {
      bonusParts += h.bonus.parts;
      bonusCorrect += h.bonus.correctParts;
    }
  }

  const points = side ? pub.sides[side].score : 0;
  const winnerSide = pub.result?.winnerSide ?? null;
  const hasOpponent = Object.keys(pub.sides).length > 1;
  return {
    side,
    seen,
    answered,
    correct,
    powers,
    early,
    negs,
    bonusParts,
    bonusCorrect,
    longestStreak,
    accuracy: answered ? correct / answered : 0,
    avgCorrectClueFraction: correct ? clueFractionSum / correct : null,
    points,
    won: hasOpponent ? winnerSide === side : null,
    tie: winnerSide === 'tie',
    byCategory,
    topics: [...topics],
    topicsCorrect,
    missed,
    closeAnswers
  };
}

function recommendNext(stats, fallbackCategory) {
  const cats = catalog.categories.map((c) => c.id);
  let weakest = null;
  for (const c of cats) {
    const s = stats?.categories?.[c];
    if (!s || s.answered < 3) continue;
    const acc = s.correct / s.answered;
    if (!weakest || acc < weakest.acc) weakest = { category: c, acc };
  }
  if (weakest && weakest.acc < 0.7) {
    return {
      category: weakest.category,
      mode: 'practice',
      count: 5,
      reason: `Your ${weakest.category} accuracy is ${Math.round(weakest.acc * 100)}%. A short practice quest will help it grow.`
    };
  }
  const leastPlayed = cats
    .map((c) => ({ c, n: stats?.categories?.[c]?.seen || 0 }))
    .sort((a, b) => a.n - b.n)[0];
  const category = leastPlayed?.c || fallbackCategory || 'Science';
  return { category, mode: 'versus', count: 5, reason: `Try a ${category} match. You haven't explored it much yet.` };
}

/**
 * Compute a student's updated progression after a session.
 * student: current student doc data. sessionPub: finished session public state.
 * ctx: { now, timeZone, teamQuestContribution, versusPersonaId }
 * Returns { update, summary, xpEarned, xpBreakdown, newBadges, newCards, unlockedWorlds, leveledUp, recommendation }
 */
function applySessionRewards(student, sessionPub, ctx) {
  const s = summarizeForStudent(sessionPub, ctx.studentId);
  const tz = ctx.timeZone || 'America/New_York';
  const today = dayKey(ctx.now, tz);

  const breakdown = [];
  const add = (label, amount) => {
    if (amount > 0) breakdown.push({ label, amount });
  };
  const complete = sessionPub.status === 'COMPLETE';
  add('Questions tried', Math.min(s.answered * XP.attempt, XP.maxAttemptXpPerSession));
  add('Correct answers', s.correct * XP.correct);
  add('Power buzzes', s.powers * XP.powerBonus);
  add('Early buzzes', Math.max(0, s.early - s.powers) * XP.earlyBonus);
  add('Bonus parts', s.bonusCorrect * XP.bonusPart);
  if (complete) add('Quest complete', XP.sessionComplete);
  if (s.won && sessionPub.opponent) add(`Beat ${sessionPub.opponent.name}`, XP.beatComputer);
  if (sessionPub.dailyQuest && complete && student.dailyQuestDay !== today) add("Today's Quest", XP.dailyQuest);
  if (ctx.assignmentFirst && complete) add('Assignment complete', XP.assignmentFirstComplete);
  const xpEarned = breakdown.reduce((sum, b) => sum + b.amount, 0);

  const prevXp = student.xp || 0;
  const xp = prevXp + xpEarned;
  const prevLevel = levelForXp(prevXp);
  const level = levelForXp(xp);

  // Streak: consecutive days with a completed session.
  const streak = { current: 0, best: 0, lastDay: null, ...(student.streak || {}) };
  if (sessionPub.status === 'COMPLETE' && streak.lastDay !== today) {
    streak.current = streak.lastDay === previousDay(today) ? streak.current + 1 : 1;
    streak.lastDay = today;
    streak.best = Math.max(streak.best, streak.current);
  }

  // Lifetime stats.
  const stats = JSON.parse(JSON.stringify(student.stats || {}));
  stats.seen = (stats.seen || 0) + s.seen;
  stats.answered = (stats.answered || 0) + s.answered;
  stats.correct = (stats.correct || 0) + s.correct;
  stats.powers = (stats.powers || 0) + s.powers;
  stats.early = (stats.early || 0) + s.early;
  stats.bonusParts = (stats.bonusParts || 0) + s.bonusParts;
  stats.bonusCorrect = (stats.bonusCorrect || 0) + s.bonusCorrect;
  stats.sessions = (stats.sessions || 0) + (sessionPub.status === 'COMPLETE' ? 1 : 0);
  stats.clueFractionSum = (stats.clueFractionSum || 0) + (s.avgCorrectClueFraction != null ? s.avgCorrectClueFraction * s.correct : 0);
  stats.categories = stats.categories || {};
  for (const [cat, c] of Object.entries(s.byCategory)) {
    const t = (stats.categories[cat] ||= { seen: 0, answered: 0, correct: 0 });
    t.seen += c.seen;
    t.answered += c.answered;
    t.correct += c.correct;
  }
  if (sessionPub.opponent && s.won !== null) {
    stats.versusPlayed = (stats.versusPlayed || 0) + 1;
    stats.versusWon = (stats.versusWon || 0) + (s.won ? 1 : 0);
  }

  // Knowledge cards.
  const cards = { ...(student.cards || {}) };
  const newCards = [];
  for (const { topic, category } of s.topicsCorrect) {
    if (!cards[topic]) {
      cards[topic] = { count: 0, category, firstAt: ctx.now };
      newCards.push(topic);
    }
    cards[topic] = { ...cards[topic], count: cards[topic].count + 1 };
  }

  // Worlds: a completed session counts as a quest in its world; stars from category
  // correct counts; unlocks from quest rules (e.g. "Complete 3 Science Lab quests").
  const worldQuests = { ...(student.worldQuests || {}) };
  const questWorld = complete ? sessionWorld(sessionPub) : null;
  if (questWorld) worldQuests[questWorld] = (worldQuests[questWorld] || 0) + 1;
  const worldStars = {};
  let totalStars = 0;
  for (const w of catalog.worlds) {
    const stars = starsFor(stats.categories[w.category]?.correct || 0);
    worldStars[w.id] = stars;
    totalStars += stars;
  }
  const probe = { ...student, worldQuests, claimedMap: student.claimedMap || [], questStars: student.questStars || 0 };
  const unlocked = catalog.worlds.filter((w) => evaluateRule(rewardsCatalog.worldUnlocks[w.id], probe).met).map((w) => w.id);
  const prevUnlocked = student.unlockedWorlds || [catalog.worlds[0].id];
  const unlockedWorlds = unlocked.filter((id) => !prevUnlocked.includes(id));
  const masteredWorlds = Array.from(
    new Set([...(student.masteredWorlds || []), ...catalog.worlds.filter((w) => isMastered(w.id, stats, { ...student, worldQuests })).map((w) => w.id)])
  );

  // Adaptive rival history.
  let recentVersus = (student.recentVersus || []).slice();
  if (sessionPub.opponent && s.won !== null && !s.tie) {
    recentVersus.push(!!s.won);
    recentVersus = recentVersus.slice(-20);
  }
  // QuizDex: every rival you've beaten (Pokédex style), and world bosses defeated.
  const dex = { ...(student.dex || {}) };
  const bossesDefeated = new Set(student.bossesDefeated || []);
  if (sessionPub.rival && s.won) {
    const id = sessionPub.rival.id;
    dex[id] = { wins: (dex[id]?.wins || 0) + 1, firstAt: dex[id]?.firstAt || ctx.now, world: sessionPub.world || null, kind: sessionPub.rival.kind };
    if (sessionPub.battle === 'boss' && sessionPub.world) bossesDefeated.add(sessionPub.world);
  }
  const beatenPersonas = new Set(student.beatenPersonas || []);
  if (sessionPub.opponent && s.won) beatenPersonas.add(sessionPub.opponent.personaId);

  // Personal bests (Solo Score Attack).
  const personalBests = { ...(student.personalBests || {}) };
  if (sessionPub.mode === 'score_attack' && sessionPub.status === 'COMPLETE') {
    const prev = personalBests.score_attack || {};
    const earlyScore = s.early * 10 + s.powers * 5;
    personalBests.score_attack = {
      points: Math.max(prev.points || 0, s.points),
      accuracy: Math.max(prev.accuracy || 0, Math.round(s.accuracy * 100)),
      streak: Math.max(prev.streak || 0, s.longestStreak),
      earlyBuzz: Math.max(prev.earlyBuzz || 0, earlyScore)
    };
    s.newBests = Object.keys(personalBests.score_attack).filter((k) => personalBests.score_attack[k] > (prev[k] || 0));
  }

  const teamContribution = (student.teamContribution || 0) + (ctx.teamQuestContribution || 0);

  // Badges.
  const have = new Set(student.badges || []);
  const earn = (id) => {
    if (!have.has(id)) have.add(id);
  };
  if (stats.correct >= 1) earn('first-buzz');
  if (stats.powers >= 1) earn('early-bird');
  if (streak.current >= 3) earn('streak-3');
  if (streak.current >= 7) earn('streak-7');
  if (streak.current >= 12) earn('streak-12');
  if (sessionPub.status === 'COMPLETE' && s.seen >= 5 && s.correct === s.seen) earn('perfect-round');
  const personaBadge = { 'rookie-robot': 'robot-beater', 'questy-owl': 'owl-outflyer', 'category-captain': 'captain-crusher', 'quiz-master': 'master-challenger' };
  for (const p of beatenPersonas) if (personaBadge[p]) earn(personaBadge[p]);
  if (teamContribution >= 50) earn('team-player');
  if (Object.keys(cards).length >= 10) earn('card-collector');
  if ((student.reviewDeckCount || 0) >= 10) earn('review-ranger');
  for (const c of catalog.categories) if ((stats.categories[c.id]?.correct || 0) >= 10) earn(`explorer-${c.id}`);
  for (const w of bossesDefeated) earn(`champion-${w}`);
  const newBadges = [...have].filter((b) => !(student.badges || []).includes(b));

  const update = {
    xp,
    level,
    title: titleForLevel(level),
    streak,
    stats,
    cards,
    worldStars,
    totalStars,
    worldQuests,
    masteredWorlds,
    dex,
    bossesDefeated: [...bossesDefeated],
    lastWorld: questWorld || student.lastWorld || null,
    unlockedWorlds: [...new Set([...prevUnlocked, ...unlocked])],
    recentVersus,
    beatenPersonas: [...beatenPersonas],
    personalBests,
    teamContribution,
    badges: [...have],
    lastPlayedAt: ctx.now
  };
  if (sessionPub.dailyQuest && sessionPub.status === 'COMPLETE') update.dailyQuestDay = today;
  if (newBadges.length || newCards.length || unlockedWorlds.length) {
    update.latestUnlock = {
      at: ctx.now,
      worlds: unlockedWorlds,
      badges: newBadges,
      cards: newCards
    };
  }

  return {
    update,
    summary: s,
    xpEarned,
    xpBreakdown: breakdown,
    newBadges,
    newCards,
    unlockedWorlds,
    leveledUp: level > prevLevel ? level : null,
    recommendation: recommendNext(stats, sessionPub.history[0]?.category),
    questWorld,
    dayKey: today,
    weekKey: weekKey(ctx.now, tz)
  };
}

module.exports = {
  levelForXp,
  xpForLevel,
  titleForLevel,
  dayKey,
  weekKey,
  previousDay,
  starsFor,
  summarizeForStudent,
  applySessionRewards,
  recommendNext
};
