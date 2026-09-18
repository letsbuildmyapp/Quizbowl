// Procedural chiptune music: tiny, free, offline. Pentatonic melodies never
// clash, so generated loops always sound cheerful. Two moods (overworld,
// battle) with a different key and instrument color per world.

const WORLD_KEYS = {
  'science-lab': { root: 60, lead: 'square', seed: 3 },
  'space-station': { root: 62, lead: 'triangle', seed: 7 },
  'geography-galaxy': { root: 65, lead: 'square', seed: 11 },
  'history-kingdom': { root: 57, lead: 'sawtooth', seed: 13 },
  'literature-forest': { root: 64, lead: 'triangle', seed: 17 },
  'myth-mountain': { root: 59, lead: 'square', seed: 19 },
  'harmony-harbor': { root: 67, lead: 'triangle', seed: 23 },
  default: { root: 60, lead: 'square', seed: 1 }
};
const PENTA = [0, 2, 4, 7, 9];
const MOODS = {
  overworld: { bpm: 96, gain: 0.05, density: 0.55, bassEvery: 4 },
  battle: { bpm: 138, gain: 0.055, density: 0.8, bassEvery: 2 },
  victory: { bpm: 150, gain: 0.06, density: 1, bassEvery: 2, once: true }
};

const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function compose(worldId, mood) {
  const key = WORLD_KEYS[worldId] || WORLD_KEYS.default;
  const m = MOODS[mood];
  const r = rng(key.seed * 31 + (mood === 'battle' ? 5 : 0));
  const steps = mood === 'victory' ? 16 : 32;
  const lead = [];
  let degree = 0;
  for (let i = 0; i < steps; i++) {
    const rest = r() > m.density && i % 4 !== 0;
    degree = Math.max(0, Math.min(9, degree + Math.round((r() - 0.5) * 4)));
    const octave = Math.floor(degree / 5);
    lead.push(rest ? null : key.root + 12 * octave + PENTA[degree % 5]);
  }
  if (mood === 'victory') lead.splice(12, 4, key.root + 12, key.root + 16, key.root + 19, key.root + 24);
  const bassLine = [0, 0, 7, 9, 5, 5, 7, 4].map((d) => key.root - 24 + d);
  return { lead, bassLine, key, m, steps };
}

class Music {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.current = null;
    this.timer = null;
    this.master = null;
  }

  ensure() {
    if (this.ctx) return true;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 1;
      this.master.connect(this.ctx.destination);
      return true;
    } catch {
      return false;
    }
  }

  note(freq, start, dur, type, gain) {
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain, start + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(g).connect(this.master);
    osc.start(start);
    osc.stop(start + dur + 0.02);
  }

  /** Play a mood for a world. Safe to call repeatedly; only restarts on change. */
  play(mood, worldId = 'default') {
    const id = `${mood}:${worldId}`;
    if (!this.enabled || this.current === id) return;
    this.stop();
    if (!this.ensure()) return;
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    this.current = id;
    const song = compose(worldId, mood);
    const stepDur = 60 / song.m.bpm / 2;
    let step = 0;
    let t = this.ctx.currentTime + 0.1;
    const tick = () => {
      if (this.current !== id) return;
      // Schedule a little ahead so timers can jitter on busy Chromebooks.
      while (t < this.ctx.currentTime + 0.4) {
        const i = step % song.steps;
        const n = song.lead[i];
        if (n) this.note(hz(n), t, stepDur * 0.9, song.key.lead, song.m.gain);
        if (i % song.m.bassEvery === 0) this.note(hz(song.bassLine[Math.floor(i / 4) % song.bassLine.length]), t, stepDur * 1.8, 'triangle', song.m.gain * 1.3);
        if (song.m.bpm > 120 && i % 4 === 2) this.note(2200, t, 0.03, 'square', song.m.gain * 0.25);
        step += 1;
        t += stepDur;
        if (song.m.once && step >= song.steps) {
          this.current = null;
          return;
        }
      }
      this.timer = setTimeout(tick, 120);
    };
    tick();
  }

  stop() {
    this.current = null;
    clearTimeout(this.timer);
    this.timer = null;
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) this.stop();
  }
}

export const music = new Music();

// Browsers block audio until a user gesture; resume on the first interaction.
if (typeof window !== 'undefined') {
  const unlock = () => {
    if (music.ctx?.state === 'suspended') music.ctx.resume().catch(() => {});
  };
  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('keydown', unlock);
  document.addEventListener('visibilitychange', () => {
    if (!music.ctx) return;
    if (document.hidden) music.ctx.suspend().catch(() => {});
    else if (music.current) music.ctx.resume().catch(() => {});
  });
}
