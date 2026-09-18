import { OUTLINE, useUid, cls } from './util.js';
import './bot.css';

const NAMES = { 'myth-mountain': 'Myth Mountain', 'harmony-harbor': 'Harmony Harbor' };

function Leafy({ x, y, flip }) {
  const leaves = [0, 1, 2, 3].map((i) => (
    <ellipse key={i} cx={i * 5} cy={-i * 4} rx="4.5" ry="2.2" transform={`rotate(${-40 + i * 8} ${i * 5} ${-i * 4})`} fill="#f5c04a" stroke={OUTLINE} strokeWidth="1" />
  ));
  return <g transform={`translate(${x} ${y}) scale(${flip ? -1 : 1} 1)`}>{leaves}</g>;
}

function Note({ x, y, s = 1 }) {
  return (
    <path
      transform={`translate(${x} ${y}) scale(${s})`}
      d="M0 0L10 -3V16A4 3 0 1 1 7 13V3L3 4V19A4 3 0 1 1 0 16Z"
      fill="#ff6fb5"
      stroke={OUTLINE}
      strokeWidth={1.4 / s}
      strokeLinejoin="round"
    />
  );
}

export default function FloatingIsland({ world = 'myth-mountain', locked = false, size = 120, title, className }) {
  const u = useUid('fi');
  const name = NAMES[world] || world;
  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      role="img"
      aria-label={title || `${name}${locked ? ' (locked)' : ''}`}
      className={cls('qqb-anim', className)}
      style={{ overflow: 'visible', display: 'inline-block' }}
    >
      <defs>
        <linearGradient id={`${u}-rock`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#b07a4a" />
          <stop offset="1" stopColor="#5e3a22" />
        </linearGradient>
        <linearGradient id={`${u}-grass`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8be36a" />
          <stop offset="1" stopColor="#3fae5a" />
        </linearGradient>
        <linearGradient id={`${u}-peak`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#c9c6dc" />
          <stop offset="1" stopColor="#6e6a8e" />
        </linearGradient>
        <linearGradient id={`${u}-violin`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#e39a52" />
          <stop offset="1" stopColor="#9a5220" />
        </linearGradient>
        <radialGradient id={`${u}-beam`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#fff3a0" stopOpacity="0.95" />
          <stop offset="1" stopColor="#fff3a0" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g style={locked ? { filter: 'grayscale(1)', opacity: 0.6 } : undefined}>
        <g className={locked ? undefined : 'qqb-island-float'} style={{ transformBox: 'fill-box' }}>
          {/* cloud puffs under the island */}
          <g fill="#ffffff" opacity="0.9" stroke="#c9c6e6" strokeWidth="1">
            <path d="M8 88a8 8 0 0 1 14 -4a7 7 0 0 1 12 4Z" />
            <path d="M84 96a8 8 0 0 1 14 -4a7 7 0 0 1 12 4Z" />
          </g>
          <path d="M14 72Q26 96 48 110Q60 118 68 106Q90 94 106 72Z" fill={`url(#${u}-rock)`} stroke={OUTLINE} strokeWidth="2.2" strokeLinejoin="round" />
          <path d="M26 84Q50 90 92 84M40 98Q58 102 76 96" fill="none" stroke="#4a2c18" strokeWidth="1.5" opacity="0.6" />
          <ellipse cx="60" cy="72" rx="47" ry="12" fill={`url(#${u}-grass)`} stroke={OUTLINE} strokeWidth="2.2" />

          {world === 'harmony-harbor' ? (
            <g>
              <ellipse cx="38" cy="73" rx="22" ry="6" fill="#3d9df5" stroke={OUTLINE} strokeWidth="1.6" />
              <path d="M24 72Q30 70 36 72M42 75Q48 73 54 75" stroke="#bfe4ff" strokeWidth="1.4" fill="none" />
              <path d="M44 70H62V74H44Z" fill="#b8703c" stroke={OUTLINE} strokeWidth="1.3" />
              <path d="M26 66L34 62L34 68Z" fill="#ffffff" stroke={OUTLINE} strokeWidth="1.2" />
              <path d="M22 70Q28 72 36 70L34 68H24Z" fill="#e5484d" stroke={OUTLINE} strokeWidth="1.2" />
              <ellipse cx="80" cy="8" rx="26" ry="10" fill={`url(#${u}-beam)`} />
              {/* violin lighthouse */}
              <rect x="77" y="10" width="6" height="30" rx="2" fill="#5e3a22" stroke={OUTLINE} strokeWidth="1.4" />
              <circle cx="80" cy="9" r="5" fill="#fff3a0" stroke={OUTLINE} strokeWidth="1.6" />
              <path d="M80 4Q86 0 84 -4" fill="none" stroke={OUTLINE} strokeWidth="2" strokeLinecap="round" />
              <path
                d="M80 30C70 30 68 38 72 44C66 46 64 58 70 64C74 70 86 70 90 64C96 58 94 46 88 44C92 38 90 30 80 30Z"
                fill={`url(#${u}-violin)`}
                stroke={OUTLINE}
                strokeWidth="2"
                strokeLinejoin="round"
              />
              <path d="M74 50Q72 54 75 58M86 50Q88 54 85 58" fill="none" stroke={OUTLINE} strokeWidth="1.5" strokeLinecap="round" />
              <path d="M80 34V64" stroke="#2b1a10" strokeWidth="1.2" />
              <path d="M76 66H84" stroke="#2b1a10" strokeWidth="2" />
              <Note x={18} y={30} s={0.9} />
              <Note x={40} y={16} s={0.7} />
            </g>
          ) : (
            <g>
              <path d="M22 72L50 16L84 72Z" fill={`url(#${u}-peak)`} stroke={OUTLINE} strokeWidth="2.2" strokeLinejoin="round" />
              <path d="M62 72L80 38L100 72Z" fill="#8f8bab" stroke={OUTLINE} strokeWidth="2" strokeLinejoin="round" />
              <path d="M40 36L50 16L60 36L55 32L50 38L45 32Z" fill="#ffffff" stroke={OUTLINE} strokeWidth="1.6" strokeLinejoin="round" />
              <path d="M50 22L42 48" stroke="#ffffff" strokeWidth="2" opacity="0.5" />
              <g>
                <path d="M78 16a7 7 0 0 1 12 -5a8 8 0 0 1 14 3a6 6 0 0 1 2 11H78a6 6 0 0 1 0 -9Z" fill="#6e6a8e" stroke={OUTLINE} strokeWidth="1.6" />
                <path d="M92 26L86 36H91L87 46L98 32H93L97 26Z" fill="#ffe14a" stroke={OUTLINE} strokeWidth="1.3" strokeLinejoin="round" />
              </g>
              <Leafy x={44} y={70} flip />
              <Leafy x={56} y={70} />
              <circle cx="50" cy="70" r="2.5" fill="#e5484d" stroke={OUTLINE} strokeWidth="1" />
            </g>
          )}
        </g>
      </g>
      {locked && (
        <g transform="translate(60 66)">
          <path d="M-9 -4V-11A9 9 0 0 1 9 -11V-4" fill="none" stroke={OUTLINE} strokeWidth="6" />
          <path d="M-9 -4V-11A9 9 0 0 1 9 -11V-4" fill="none" stroke="#c3cadf" strokeWidth="3" />
          <rect x="-14" y="-5" width="28" height="22" rx="5" fill="#f5c04a" stroke={OUTLINE} strokeWidth="2.2" />
          <circle cx="0" cy="4" r="3" fill={OUTLINE} />
          <path d="M-1.4 5L-2 11H2L1.4 5Z" fill={OUTLINE} />
        </g>
      )}
    </svg>
  );
}
