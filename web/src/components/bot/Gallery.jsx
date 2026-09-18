import { useState } from 'react';
import rewards from '@shared/rewards.json';
import QuizBot from './QuizBot.jsx';
import ItemArt, { itemDisplayName } from './ItemArt.jsx';
import ChestArt from './ChestArt.jsx';
import Crest from './Crest.jsx';
import BuzzerArt from './BuzzerArt.jsx';
import ProgressVisual from './ProgressVisual.jsx';
import FloatingIsland from './FloatingIsland.jsx';
import { PAINT_IDS, BUZZER_SKIN_IDS } from './palettes.js';
import { FACE_IDS } from './QuizBot.jsx';

// Dev-only art gallery for the QuizBot system. ?bg=dark renders on the dark page colour.
const themes = rewards.themes;
const westside = themes.find((t) => t.id === 'westside-warriors') || themes[0];
const quizquest = themes.find((t) => t.id === 'quizquest') || themes[0];

const LOADOUTS = [
  { name: 'Starter', theme: quizquest, l: rewards.starterLoadout },
  {
    name: 'Westside',
    theme: westside,
    l: { paint: 'paint-school', face: 'face-smile', headgear: 'head-school', back: 'back-school', held: 'buzzer-school', companion: 'pet-dragon', effect: 'fx-fire', emote: 'emote-salute' }
  },
  {
    name: 'Space',
    theme: quizquest,
    l: { paint: 'paint-galaxy', face: 'face-visor', headgear: 'head-astronaut', back: 'back-jetpack', held: 'buzzer-galaxy', companion: 'pet-planet', effect: 'fx-constellation', emote: 'emote-rocket' }
  },
  {
    name: 'Myth',
    theme: quizquest,
    l: { paint: 'paint-gold', face: 'face-star', headgear: 'head-laurel', back: 'back-dragon', held: 'buzzer-champion', companion: 'pet-phoenix', effect: 'fx-rainbow', emote: 'emote-dance' }
  },
  {
    name: 'Knight',
    theme: quizquest,
    l: { paint: 'paint-lava', face: 'face-shades', headgear: 'head-knight', back: 'back-banner', held: 'buzzer-scroll', companion: 'pet-fox', effect: 'fx-lightning', emote: 'emote-spin' }
  },
  {
    name: 'Scholar',
    theme: quizquest,
    l: { paint: 'paint-mint', face: 'face-heart', headgear: 'head-wizard', back: 'back-books', held: 'buzzer-crystal', companion: 'pet-questy', effect: 'fx-ink', emote: 'emote-book' }
  },
  {
    name: 'Lab',
    theme: quizquest,
    l: { paint: 'paint-sunset', face: 'face-smile', headgear: 'head-goggles', back: 'back-reactor', held: 'buzzer-dna', companion: 'pet-atom', effect: 'fx-sparkles', emote: 'emote-wave' }
  },
  {
    name: 'Explorer',
    theme: westside,
    l: { paint: 'paint-sky', face: 'face-visor', headgear: 'head-explorer', back: 'back-explorer', held: 'shield-school', companion: 'pet-compass', effect: 'fx-hearts', emote: 'emote-wave' }
  },
  {
    name: 'Artist',
    theme: quizquest,
    l: { paint: 'paint-sunset', face: 'face-heart', headgear: 'head-beret', back: 'back-lightning', held: 'buzzer-note', companion: 'pet-robot', effect: null, emote: 'emote-dance' }
  },
  {
    name: 'Royal',
    theme: westside,
    l: { paint: 'paint-school', face: 'face-shades', headgear: 'head-crown', back: null, held: 'buzzer-classic', companion: null, effect: 'fx-sparkles', emote: 'emote-wave' }
  }
];

const BUZZER_STATES = ['idle', 'ready', 'pressed', 'accepted', 'late', 'disabled'];
const CHEST_STATES = ['closed', 'ready', 'opening', 'open'];
const RARITIES = ['common', 'rare', 'epic', 'legendary', 'mythic'];

const ONLY = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('only') : null;

function Section({ title, children }) {
  if (ONLY && !ONLY.split(',').some((k) => title.toLowerCase().includes(k))) return null;
  return (
    <section style={{ marginBottom: 40 }}>
      <h2 style={{ fontFamily: 'Fredoka, system-ui, sans-serif', fontSize: 22, margin: '0 0 12px' }}>{title}</h2>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end' }}>{children}</div>
    </section>
  );
}
function Cell({ label, children, w }) {
  return (
    <figure style={{ margin: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: w }}>
      {children}
      <figcaption style={{ fontSize: 12, fontWeight: 700, textAlign: 'center', opacity: 0.85 }}>{label}</figcaption>
    </figure>
  );
}

export default function Gallery() {
  const initialDark = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('bg') === 'dark';
  const [dark, setDark] = useState(initialDark);
  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const [pose, setPose] = useState(params.get('pose') || 'idle');
  // ?freeze=0.4 pauses every animation at that many seconds (for screenshot review).
  const freeze = params.get('freeze');
  const [replay, setReplay] = useState(0);
  const bg = dark ? '#14122b' : '#f6f3ff';
  const fg = dark ? '#f3f0ff' : '#1e1b4b';

  return (
    <div style={{ background: bg, color: fg, minHeight: '100vh', padding: 24, fontFamily: 'Nunito, system-ui, sans-serif' }}>
      {freeze && <style>{`.qqb-anim, .qqb-anim * { animation-play-state: paused !important; animation-delay: -${Number(freeze)}s !important; }`}</style>}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontFamily: 'Fredoka, system-ui, sans-serif', margin: 0 }}>QuizBot art gallery</h1>
        <button type="button" onClick={() => setDark((d) => !d)}>{dark ? 'Light background' : 'Dark background'}</button>
        {['idle', 'emote', 'static'].map((p) => (
          <button key={p} type="button" onClick={() => { setPose(p); setReplay((r) => r + 1); }} aria-pressed={pose === p}>
            Pose: {p}
          </button>
        ))}
      </div>

      <Section title="Full loadouts">
        {LOADOUTS.map((o, i) => (
          <Cell key={o.name} label={`${o.name} (${o.theme.displayName})`} w={i < 3 ? 280 : 200}>
            <QuizBot key={`${o.name}-${replay}`} loadout={o.l} theme={o.theme} size={i < 3 ? 280 : 200} pose={pose} title={`${o.name} QuizBot`} />
          </Cell>
        ))}
      </Section>

      <Section title="Large (400px bot, 220px chests)">
        <QuizBot loadout={LOADOUTS[1].l} theme={westside} size={400} pose={pose} title="Westside QuizBot large" />
        <ChestArt rarity="legendary" state="open" size={220} />
        <ChestArt rarity="mythic" state="ready" size={220} />
        <ChestArt rarity="epic" state="closed" school theme={westside} size={220} />
      </Section>

      <Section title="Paint x face">
        {PAINT_IDS.map((paint) => (
          <div key={paint} style={{ display: 'flex', gap: 4 }}>
            {FACE_IDS.map((face) => (
              <QuizBot key={face} loadout={{ paint, face }} theme={paint === 'paint-school' ? westside : quizquest} size={72} pose="static" title={`${paint} ${face}`} />
            ))}
          </div>
        ))}
      </Section>

      <Section title="Small sizes (32 / 48 / 64)">
        {[32, 48, 64].map((s) => (
          <QuizBot key={s} loadout={LOADOUTS[1].l} theme={westside} size={s} pose="static" />
        ))}
        {[32, 48, 64].map((s) => (
          <QuizBot key={`b${s}`} loadout={LOADOUTS[2].l} theme={quizquest} size={s} pose="static" />
        ))}
      </Section>

      {['paint', 'face', 'headgear', 'back', 'held', 'companion', 'effect', 'emote'].map((slot) => (
        <Section key={slot} title={`Items: ${slot}`}>
          {rewards.cosmetics
            .filter((c) => c.slot === slot)
            .map((c) => (
              <Cell key={c.id} label={`${itemDisplayName(c, c.school ? westside : quizquest)} (${c.rarity})`} w={96}>
                <ItemArt itemId={c.id} theme={c.school ? westside : quizquest} size={72} />
                <ItemArt itemId={c.id} theme={c.school ? westside : quizquest} size={48} />
              </Cell>
            ))}
        </Section>
      ))}

      <Section title="Chests">
        {RARITIES.map((r) => (
          <div key={r} style={{ display: 'flex', gap: 8 }}>
            {CHEST_STATES.map((s) => (
              <Cell key={s} label={`${r} ${s}`}>
                <ChestArt rarity={r} state={s} size={110} />
              </Cell>
            ))}
          </div>
        ))}
        {CHEST_STATES.map((s) => (
          <Cell key={`school-${s}`} label={`school ${s}`}>
            <ChestArt rarity="epic" state={s} school theme={westside} size={110} />
          </Cell>
        ))}
        <Cell label="school (QuizQuest)">
          <ChestArt rarity="epic" state="closed" school theme={quizquest} size={110} />
        </Cell>
      </Section>

      <Section title="Buzzer states (classic, team #2f86e8)">
        {BUZZER_STATES.map((s) => (
          <Cell key={s} label={s}>
            <BuzzerArt state={s} teamColor="#2f86e8" size={170} />
          </Cell>
        ))}
      </Section>
      <Section title="Buzzer skins (ready)">
        {BUZZER_SKIN_IDS.map((sk) => (
          <Cell key={sk} label={sk}>
            <BuzzerArt state="ready" skin={sk} theme={westside} size={150} />
          </Cell>
        ))}
      </Section>

      <Section title="Crests">
        {themes.map((t) => (
          <Cell key={t.id} label={t.displayName}>
            <Crest theme={t} size={96} />
            <Crest theme={t} size={40} />
          </Cell>
        ))}
      </Section>

      <Section title="Progress">
        {[0, 40, 100].map((v) => (
          <ProgressVisual key={`f${v}`} type="flame" value={v} max={100} theme={westside} size={120} />
        ))}
        {[0, 40, 100].map((v) => (
          <ProgressVisual key={`s${v}`} type="star" value={v} max={100} theme={quizquest} size={120} />
        ))}
      </Section>

      <Section title="Floating islands">
        <Cell label="Myth Mountain"><FloatingIsland world="myth-mountain" size={140} /></Cell>
        <Cell label="Harmony Harbor"><FloatingIsland world="harmony-harbor" size={140} /></Cell>
        <Cell label="Myth (locked)"><FloatingIsland world="myth-mountain" locked size={140} /></Cell>
        <Cell label="Harbor (locked)"><FloatingIsland world="harmony-harbor" locked size={140} /></Cell>
      </Section>
    </div>
  );
}
