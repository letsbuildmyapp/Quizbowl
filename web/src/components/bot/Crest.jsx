import { OUTLINE, resolveTheme, useUid, shade, inkOn, cls } from './util.js';
import './bot.css';

export const SHIELD_PATH =
  'M50 4C66 12 82 13 96 8L96 52C96 80 76 99 50 110C24 99 4 80 4 52L4 8C18 13 34 12 50 4Z';

// Shield drawn in a 100x112 box. Place it with x/y (top-left) and w (width).
export function CrestShape({ theme, u, x = 0, y = 0, w = 100, trim = true, letterScale = 1 }) {
  const t = resolveTheme(theme);
  const s = w / 100;
  const id = `${u}-cr`;
  const letterInk = inkOn(t.primaryColor, t.secondaryColor);
  const inner = (k) => `translate(50 56) scale(${k}) translate(-50 -56)`;
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <defs>
        <linearGradient id={`${id}-gold`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff1a8" />
          <stop offset="0.5" stopColor="#f5c04a" />
          <stop offset="1" stopColor="#b7791f" />
        </linearGradient>
        <linearGradient id={`${id}-field`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={shade(t.primaryColor, 0.18)} />
          <stop offset="1" stopColor={shade(t.primaryColor, -0.22)} />
        </linearGradient>
      </defs>
      <path
        d={SHIELD_PATH}
        fill={trim ? `url(#${id}-gold)` : t.secondaryColor}
        stroke={OUTLINE}
        strokeWidth={4 / Math.max(s, 0.35)}
        strokeLinejoin="round"
      />
      <path d={SHIELD_PATH} transform={inner(0.87)} fill={t.secondaryColor} />
      <path d={SHIELD_PATH} transform={inner(0.74)} fill={`url(#${id}-field)`} />
      <path
        d="M20 22C34 24 44 20 50 16C58 20 70 23 82 21L82 34C62 38 38 38 20 34Z"
        fill="#ffffff"
        opacity="0.22"
      />
      <text
        x="50"
        y="58"
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="Fredoka, Nunito, 'Arial Rounded MT Bold', system-ui, sans-serif"
        fontWeight="700"
        fontSize={54 * letterScale}
        fill={letterInk}
        stroke={letterInk === '#ffffff' || letterInk === t.secondaryColor ? shade(t.primaryColor, -0.45) : 'none'}
        strokeWidth="3"
        paintOrder="stroke"
      >
        {String(t.crestLetter || 'Q').slice(0, 2)}
      </text>
    </g>
  );
}

export default function Crest({ theme, size = 64, title, className }) {
  const u = useUid('cr');
  const t = resolveTheme(theme);
  const label = title || `${t.displayName || t.mascotName} crest`;
  return (
    <svg
      viewBox="-4 -4 108 120"
      width={size}
      height={(size * 120) / 108}
      role="img"
      aria-label={label}
      className={cls('qqb-anim', className)}
      style={{ overflow: 'visible', display: 'inline-block' }}
    >
      <CrestShape theme={t} u={u} />
    </svg>
  );
}
