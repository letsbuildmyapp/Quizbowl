// Battle sound effects: tiny synthesized sounds, gentle volumes, no audio files.
// Callers check the student's sound setting before calling these.
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

/** One oscillator gliding from f0 to f1. */
function glide(f0, f1, { duration = 0.2, type = 'sine', gain = 0.06, delay = 0 } = {}) {
  const c = audio();
  if (!c) return;
  const t = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + duration);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(g).connect(c.destination);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}

/** Short filtered noise burst (whoosh / impact texture). */
function noise({ duration = 0.18, gain = 0.05, from = 800, to = 3000, delay = 0 } = {}) {
  const c = audio();
  if (!c) return;
  const t = c.currentTime + delay;
  const len = Math.floor(c.sampleRate * duration);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = 1.2;
  f.frequency.setValueAtTime(from, t);
  f.frequency.exponentialRampToValueAtTime(to, t + duration);
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  src.connect(f).connect(g).connect(c.destination);
  src.start(t);
}

function notes(freqs, { step = 0.1, duration = 0.14, type = 'triangle', gain = 0.07, delay = 0 } = {}) {
  freqs.forEach((f, i) => glide(f, f * 1.002, { duration, type, gain, delay: delay + i * step }));
}

export const sfx = {
  /** Buzzer pressed: a quick rising charge. */
  charge: () => glide(300, 900, { duration: 0.22, type: 'triangle', gain: 0.05 }),
  /** Attack launched. */
  whoosh: () => noise({ duration: 0.28, gain: 0.07, from: 500, to: 3200 }),
  /** Attack lands. */
  hit: () => {
    glide(180, 60, { duration: 0.16, type: 'square', gain: 0.05 });
    noise({ duration: 0.1, gain: 0.05, from: 1800, to: 600 });
  },
  /** Power buzz landed. */
  power: () => notes([784, 988, 1319, 1568], { step: 0.06, duration: 0.12, gain: 0.06 }),
  /** Soft, friendly miss (never harsh). */
  miss: () => glide(520, 360, { duration: 0.22, type: 'sine', gain: 0.05 }),
  /** Rival stumbles. */
  boing: () => glide(260, 520, { duration: 0.18, type: 'sine', gain: 0.05 }),
  /** Rival appears / intro sting. */
  appear: () => notes([392, 523, 659], { step: 0.08, duration: 0.12, gain: 0.05 }),
  /** Victory fanfare. */
  victory: () => notes([523, 659, 784, 1047, 784, 1047], { step: 0.11, duration: 0.16, gain: 0.07 }),
  /** Rival flees / fades. */
  flee: () => glide(900, 200, { duration: 0.45, type: 'triangle', gain: 0.04 }),
  /** Gentle end when the rival wins. */
  soft: () => notes([523, 440, 392], { step: 0.14, duration: 0.18, type: 'sine', gain: 0.05 })
};
