import { useId } from 'react';
import rewards from '@shared/rewards.json';

// Shared helpers for the QuizBot art system. Everything is drawn in SVG user units.

export const OUTLINE = '#1e1b4b';
export const SW = 2.4; // outline stroke width in a 240-unit art frame

export const DEFAULT_THEME = rewards.themes.find((t) => t.id === 'quizquest') || rewards.themes[0];

export function resolveTheme(theme) {
  return { ...DEFAULT_THEME, ...(theme || {}) };
}

const ITEMS = new Map(rewards.cosmetics.map((c) => [c.id, c]));
export function getItem(id) {
  return id ? ITEMS.get(id) || null : null;
}

// Unique, url()-safe id prefix per component instance.
export function useUid(prefix = 'q') {
  const raw = useId();
  return `${prefix}${raw.replace(/[^a-zA-Z0-9]/g, '')}`;
}

function toRgb(hex) {
  let h = String(hex || '#888').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function toHex([r, g, b]) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}
export function mix(a, b, t) {
  const A = toRgb(a);
  const B = toRgb(b);
  return toHex(A.map((v, i) => v + (B[i] - v) * t));
}
// amt > 0 lightens toward white, amt < 0 darkens toward deep ink.
export function shade(hex, amt) {
  return amt >= 0 ? mix(hex, '#ffffff', amt) : mix(hex, '#12102e', -amt);
}
export function luminance(hex) {
  const [r, g, b] = toRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
// Readable ink for a letter drawn on `bg`, preferring `preferred` when it has contrast.
export function inkOn(bg, preferred) {
  if (preferred && Math.abs(luminance(bg) - luminance(preferred)) > 0.3) return preferred;
  return luminance(bg) > 0.45 ? OUTLINE : '#ffffff';
}

// Five-point star path centered at (cx, cy).
export function starPath(cx, cy, r, inner = 0.45, points = 5, rot = -90) {
  const pts = [];
  for (let i = 0; i < points * 2; i++) {
    const rr = i % 2 === 0 ? r : r * inner;
    const a = ((rot + (i * 180) / points) * Math.PI) / 180;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}

// 4-point twinkle sparkle.
export function twinklePath(cx, cy, r) {
  const k = r * 0.22;
  return `M${cx} ${cy - r} Q${cx + k} ${cy - k} ${cx + r} ${cy} Q${cx + k} ${cy + k} ${cx} ${cy + r} Q${cx - k} ${cy + k} ${cx - r} ${cy} Q${cx - k} ${cy - k} ${cx} ${cy - r}Z`;
}

export function heartPath(cx, cy, s) {
  // s = half width
  return `M${cx} ${cy + s * 0.9} C${cx - s * 1.3} ${cy} ${cx - s * 0.9} ${cy - s * 1.05} ${cx} ${cy - s * 0.4} C${cx + s * 0.9} ${cy - s * 1.05} ${cx + s * 1.3} ${cy} ${cx} ${cy + s * 0.9}Z`;
}

export function prefersReducedMotion() {
  if (typeof window === 'undefined') return false;
  if (document.documentElement?.dataset?.reducedMotion === 'true') return true;
  return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export const cls = (...a) => a.filter(Boolean).join(' ');
