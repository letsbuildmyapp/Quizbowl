import { OUTLINE, useUid, shade, resolveTheme, starPath, luminance } from './util.js';
import './bot.css';

const FLAME = 'M50 86C30 86 20 74 21 58C22 46 28 40 30 28C34 36 36 41 40 42C38 30 42 18 52 6C54 18 60 26 66 32C68 27 70 22 70 16C78 30 81 44 79 58C78 76 68 86 50 86Z';
const FLAME_TOP = 6;
const FLAME_BOTTOM = 86;
const STAR = starPath(50, 58, 46, 0.5);
const STAR_TOP = 12;
const STAR_BOTTOM = 96;

export default function ProgressVisual({ type = 'flame', value = 0, max = 100, theme, size = 160, label }) {
  const u = useUid('pv');
  const t = resolveTheme(theme);
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const pctText = `${Math.round(pct * 100)}%`;
  const pri = t.primaryColor;
  // Use the accent for trim only when it reads as a light/gold colour.
  const trim = luminance(t.accentColor) > 0.35 ? t.accentColor : '#f5c04a';
  const isStar = type === 'star';
  const shape = isStar ? STAR : FLAME;
  const top = isStar ? STAR_TOP : FLAME_TOP;
  const bottom = isStar ? STAR_BOTTOM : FLAME_BOTTOM;
  const fillY = bottom - (bottom - top) * pct;
  const name = label || t.progressLabel || (isStar ? 'Quest Power' : 'Team Flame');

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={`${name}: ${pctText}`}
      aria-label={name}
      style={{ display: 'inline-flex', alignItems: 'center', gap: size * 0.08 }}
    >
      <svg viewBox="0 0 100 130" width={size * 0.77} height={size} aria-hidden="true" style={{ overflow: 'visible', display: 'block' }}>
        <defs>
          <clipPath id={`${u}-clip`}>
            <path d={shape} />
          </clipPath>
          <linearGradient id={`${u}-fill`} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor={shade(pri, -0.2)} />
            <stop offset="0.6" stopColor={pri} />
            <stop offset="1" stopColor={shade(pri, 0.45)} />
          </linearGradient>
          <linearGradient id={`${u}-gold`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff1a8" />
            <stop offset="0.5" stopColor={trim} />
            <stop offset="1" stopColor={shade(trim, -0.4)} />
          </linearGradient>
          <linearGradient id={`${u}-wood`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#8a5a2b" />
            <stop offset="0.4" stopColor="#c98450" />
            <stop offset="1" stopColor="#6b3a1a" />
          </linearGradient>
        </defs>
        {!isStar && (
          <g>
            <path d="M40 96L60 96L55 126Q50 129 45 126Z" fill={`url(#${u}-wood)`} stroke={OUTLINE} strokeWidth="2.4" strokeLinejoin="round" />
            <rect x="42" y="106" width="16" height="5" fill={`url(#${u}-gold)`} stroke={OUTLINE} strokeWidth="1.4" />
            <path d="M22 80H78L70 98H30Z" fill={`url(#${u}-gold)`} stroke={OUTLINE} strokeWidth="2.4" strokeLinejoin="round" />
            <rect x="18" y="76" width="64" height="8" rx="4" fill={`url(#${u}-gold)`} stroke={OUTLINE} strokeWidth="2" />
          </g>
        )}
        <path d={shape} fill={shade(pri, 0.82)} opacity="0.9" />
        <g clipPath={`url(#${u}-clip)`}>
          <rect x="0" y={fillY} width="100" height={bottom - fillY + 2} fill={`url(#${u}-fill)`} />
          {pct > 0 && pct < 1 && (
            <path d={`M0 ${fillY}Q12 ${fillY - 4} 25 ${fillY}T50 ${fillY}T75 ${fillY}T100 ${fillY}`} fill="none" stroke="#ffffff" strokeWidth="2.5" opacity="0.8" />
          )}
          {!isStar && pct > 0.35 && (
            <path d="M50 44C56 54 64 60 62 70C61 78 56 82 50 82C44 82 39 78 38 70C37 62 46 56 50 44Z" fill={t.secondaryColor} opacity="0.85" />
          )}
        </g>
        <path d={shape} fill="none" stroke={OUTLINE} strokeWidth="2.6" strokeLinejoin="round" />
        {isStar && <path d={shape} fill="none" stroke={trim} strokeWidth="1.2" strokeLinejoin="round" transform="translate(50 58) scale(0.9) translate(-50 -58)" />}
        <path d={isStar ? 'M34 44L42 30' : 'M34 56Q34 42 42 32'} stroke="#ffffff" strokeWidth="3.5" strokeLinecap="round" opacity="0.55" fill="none" />
      </svg>
      <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
        <span style={{ fontFamily: 'var(--font-display, Fredoka, system-ui, sans-serif)', fontWeight: 700, fontSize: Math.max(14, size * 0.2) }}>{pctText}</span>
        <span style={{ fontSize: Math.max(11, size * 0.08), fontWeight: 700, opacity: 0.8 }}>{name}</span>
      </span>
    </div>
  );
}
