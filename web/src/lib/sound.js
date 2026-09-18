// Tiny synthesized sound effects (no audio files, nothing leaves the device).
let ctx = null;

function tone(freqs, { duration = 0.12, type = 'sine', gain = 0.12, gap = 0.02 } = {}) {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    let t = ctx.currentTime;
    for (const f of freqs) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.value = f;
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      osc.connect(g).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + duration);
      t += duration + gap;
    }
  } catch {
    /* audio unavailable */
  }
}

export const sounds = {
  buzz: () => tone([520, 780], { type: 'square', duration: 0.09, gain: 0.08 }),
  correct: () => tone([660, 880, 1320], { type: 'triangle', duration: 0.11 }),
  wrong: () => tone([300, 220], { type: 'sawtooth', duration: 0.14, gain: 0.06 }),
  opponent: () => tone([440, 330], { type: 'square', duration: 0.08, gain: 0.06 }),
  clue: () => tone([880], { type: 'sine', duration: 0.05, gain: 0.04 }),
  win: () => tone([523, 659, 784, 1047], { type: 'triangle', duration: 0.13 })
};

/** Read text aloud with the browser's built-in speech (on-device where supported). */
export function speak(text, { rate = 1 } = {}) {
  if (!('speechSynthesis' in window) || !text) return;
  const u = new SpeechSynthesisUtterance(text);
  u.rate = rate;
  u.lang = 'en-US';
  window.speechSynthesis.speak(u);
}

export function stopSpeaking() {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}

export const SPEECH_RATE = { slow: 0.85, medium: 1, fast: 1.2, manual: 1 };
