'use strict';

// Answer checking: exact normalized matching against reviewed answer lists,
// small spelling leniency, and "close" answers flagged for teacher review
// instead of being auto-accepted.

const ARTICLES = new Set(['the', 'a', 'an']);

function normalize(input) {
  if (input == null) return '';
  let s = String(input)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const words = s.split(' ').filter(Boolean);
  while (words.length > 1 && ARTICLES.has(words[0])) words.shift();
  s = words.join(' ');
  return s;
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Typos we forgive automatically (kids misspell a lot). */
function spellingTolerance(len) {
  if (len >= 9) return 2;
  if (len >= 5) return 1;
  return 0;
}

/**
 * @returns {{ result: 'correct'|'incorrect'|'close', normalized: string, matched?: string }}
 *   'close' means probably-right but not confidently: scored incorrect, flagged for teacher review.
 */
function checkAnswer(input, { canonicalAnswer, acceptedAnswers = [], rejectedAnswers = [] }) {
  const normalized = normalize(input);
  if (!normalized) return { result: 'incorrect', normalized };

  const rejected = rejectedAnswers.map(normalize).filter(Boolean);
  if (rejected.includes(normalized)) return { result: 'incorrect', normalized };

  const targets = [canonicalAnswer, ...acceptedAnswers].map(normalize).filter(Boolean);
  if (targets.includes(normalized)) return { result: 'correct', normalized, matched: normalized };

  let best = Infinity;
  let bestTarget = null;
  for (const t of targets) {
    const d = levenshtein(normalized, t);
    if (d < best) {
      best = d;
      bestTarget = t;
    }
  }
  if (bestTarget && best <= spellingTolerance(bestTarget.length)) {
    // A typo must not turn the answer into an explicitly rejected one.
    return { result: 'correct', normalized, matched: bestTarget };
  }

  // Close: larger edit distance, or one contains the other as whole words.
  const closeByDistance = bestTarget && best <= Math.max(2, Math.ceil(bestTarget.length * 0.34));
  const closeByContainment = targets.some((t) => {
    const a = ` ${normalized} `;
    const b = ` ${t} `;
    return (t.length >= 4 && a.includes(b)) || (normalized.length >= 4 && b.includes(a));
  });
  if (closeByDistance || closeByContainment) {
    return { result: 'close', normalized, matched: bestTarget };
  }
  return { result: 'incorrect', normalized };
}

module.exports = { normalize, levenshtein, checkAnswer };
