'use strict';

// Deterministic, seedable randomness. Every random decision in a match derives
// from (matchSeed, purpose keys) so the same seed replays the same match.

function hashString(str) {
  // cyrb53-style 32-bit hash; stable across Node and browsers.
  let h1 = 0xdeadbeef ^ 0;
  let h2 = 0x41c6ce57 ^ 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h1 ^ h2) >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Returns an rng stream for a specific purpose within a match. */
function streamFor(seed, ...keys) {
  const rand = mulberry32(hashString([seed, ...keys].join(':')));
  return {
    next: rand,
    range(min, max) {
      return min + (max - min) * rand();
    },
    int(min, maxInclusive) {
      return Math.floor(min + (maxInclusive - min + 1) * rand());
    },
    pick(arr) {
      return arr[Math.floor(rand() * arr.length)];
    },
    shuffle(arr) {
      const out = arr.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    }
  };
}

function newSeed() {
  return require('crypto').randomBytes(8).toString('hex');
}

module.exports = { hashString, mulberry32, streamFor, newSeed };
