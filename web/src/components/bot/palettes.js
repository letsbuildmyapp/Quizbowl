import { resolveTheme, shade, mix, luminance } from './util.js';

// Paint palettes. main = armor shell, trim = ear discs, pauldrons, belt, hands, feet.
const PAINTS = {
  'paint-sky': { main: '#bfe4ff', trim: '#3d9df5', core: '#5ef2ff' },
  'paint-mint': { main: '#b6f2d8', trim: '#12a58f', core: '#b7ff6a' },
  'paint-sunset': { main: '#ffc27a', main2: '#ff7eb0', trim: '#e2447e', core: '#fff07a' },
  'paint-lava': { main: '#4a2320', trim: '#ff7a1a', core: '#ffb020', pattern: 'lava' },
  'paint-galaxy': { main: '#43237f', main2: '#241a5c', trim: '#d04ef0', core: '#7df9ff', pattern: 'galaxy' },
  'paint-gold': { main: '#ffd54a', trim: '#c7851c', core: '#ffffff', pattern: 'gold' }
};

export const PAINT_IDS = [...Object.keys(PAINTS), 'paint-school'];

export function paintPalette(id, theme) {
  const t = resolveTheme(theme);
  let p;
  if (id === 'paint-school') {
    const sec = t.secondaryColor;
    // Keep the shell light when the secondary is light, so the crest pops.
    p = {
      main: luminance(sec) > 0.7 ? mix(sec, '#e9e6f7', 0.25) : sec,
      trim: t.primaryColor,
      core: t.accentColor,
      pattern: 'school'
    };
  } else {
    p = PAINTS[id] || PAINTS['paint-sky'];
  }
  const main2 = p.main2 || p.main;
  const dark = luminance(p.main) < 0.12;
  return {
    ...p,
    id: PAINTS[id] || id === 'paint-school' ? id : 'paint-sky',
    mainHi: shade(p.main, dark ? 0.22 : 0.6),
    mainLo: shade(main2, dark ? -0.3 : -0.22),
    main2,
    trimHi: shade(p.trim, 0.35),
    trimLo: shade(p.trim, -0.3),
    joint: dark ? '#1a1633' : '#3b3766',
    jointHi: dark ? '#35305c' : '#5d5890'
  };
}

// Buzzer skins shared by the held item and the big match buzzer.
const SKINS = {
  'buzzer-classic': { dome: '#ff3b4e', base: '#3a3f63', trim: '#f5c04a', light: '#ff8a96' },
  'buzzer-crystal': { dome: '#46e3ff', base: '#34406b', trim: '#bfefff', light: '#b8f6ff', motif: 'crystal' },
  'buzzer-galaxy': { dome: '#8b3dff', base: '#2a2352', trim: '#d6b8ff', light: '#c9a3ff', motif: 'galaxy' },
  'buzzer-dna': { dome: '#35d46b', base: '#2d4a52', trim: '#b8ffcf', light: '#9dffba', motif: 'dna' },
  'buzzer-scroll': { dome: '#f2dcaa', base: '#8a5a2b', trim: '#d39b4c', light: '#fff4d8', motif: 'scroll' },
  'buzzer-note': { dome: '#ff6fb5', base: '#4a3066', trim: '#ffd1ea', light: '#ffc0df', motif: 'note' },
  'buzzer-champion': { dome: '#ffcc2e', base: '#6b4a12', trim: '#fff1a8', light: '#fff3b0', motif: 'star' }
};
export const BUZZER_SKIN_IDS = [...Object.keys(SKINS), 'buzzer-school'];

export function buzzerSkin(id, theme) {
  const t = resolveTheme(theme);
  const s =
    id === 'buzzer-school'
      ? { dome: t.primaryColor, base: '#2f3358', trim: '#f5c04a', light: shade(t.primaryColor, 0.5), motif: 'crest' }
      : SKINS[id] || SKINS['buzzer-classic'];
  return {
    ...s,
    domeHi: shade(s.dome, 0.55),
    domeLo: shade(s.dome, -0.35),
    baseHi: shade(s.base, 0.3),
    baseLo: shade(s.base, -0.35)
  };
}
