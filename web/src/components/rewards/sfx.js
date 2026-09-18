// Synthesized reward sounds (no audio files). Each rarity gets its own voice so
// kids can hear what they got before they read it.
let ctx = null;

function audio() {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

// notes: [freq, startOffsetSec, durationSec]
function play(notes, { type = 'triangle', gain = 0.1 } = {}) {
  const a = audio();
  if (!a) return;
  const t0 = a.currentTime + 0.01;
  for (const [f, at, dur] of notes) {
    const osc = a.createOscillator();
    const g = a.createGain();
    osc.type = type;
    osc.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t0 + at);
    g.gain.exponentialRampToValueAtTime(gain, t0 + at + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
    osc.connect(g).connect(a.destination);
    osc.start(t0 + at);
    osc.stop(t0 + at + dur + 0.02);
  }
}

const seq = (freqs, step, dur) => freqs.map((f, i) => [f, i * step, dur]);

export const rewardSfx = {
  chestShake: () => play(seq([196, 220, 196, 247], 0.1, 0.09), { type: 'square', gain: 0.04 }),
  chestOpen: () => play(seq([392, 523, 659], 0.07, 0.18), { type: 'triangle', gain: 0.08 }),
  common: () => play([[880, 0, 0.25]], { type: 'sine', gain: 0.09 }),
  rare: () => play(seq([659, 988], 0.09, 0.22), { type: 'triangle', gain: 0.09 }),
  epic: () => play([...seq([523, 659, 784, 1047], 0.07, 0.2), [1568, 0.3, 0.35]], { type: 'triangle', gain: 0.08 }),
  legendary: () => {
    play([...seq([392, 523, 659, 784], 0.1, 0.22), [1047, 0.42, 0.6]], { type: 'sawtooth', gain: 0.035 });
    play([...seq([784, 1047, 1319], 0.12, 0.3), [1568, 0.45, 0.6]], { type: 'triangle', gain: 0.06 });
  },
  mythic: () => play(seq([523, 659, 784, 988, 1175, 1319, 1568, 2093], 0.06, 0.32), { type: 'sine', gain: 0.07 }),
  stars: () => play(seq([1319, 1568, 1319, 1760], 0.06, 0.12), { type: 'square', gain: 0.03 }),
  equip: () => play(seq([523, 784], 0.06, 0.12), { type: 'triangle', gain: 0.07 })
};
