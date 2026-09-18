import { OUTLINE, starPath } from './util.js';
import { CrestShape } from './Crest.jsx';

// Buzzer drawn around (0,0) = centre of the base's top rim, in a ~200 unit wide frame.
// Used small (held item) and large (match buzzer).
export function BuzzerDefs({ u, s }) {
  return (
    <defs>
      <radialGradient id={`${u}-dome`} cx="0.35" cy="0.25" r="0.85">
        <stop offset="0" stopColor={s.domeHi} />
        <stop offset="0.45" stopColor={s.dome} />
        <stop offset="1" stopColor={s.domeLo} />
      </radialGradient>
      <linearGradient id={`${u}-metal`} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor={s.baseLo} />
        <stop offset="0.3" stopColor={s.baseHi} />
        <stop offset="0.7" stopColor={s.base} />
        <stop offset="1" stopColor={s.baseLo} />
      </linearGradient>
      <linearGradient id={`${u}-rim`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={s.baseHi} />
        <stop offset="1" stopColor={s.base} />
      </linearGradient>
    </defs>
  );
}

export function BuzzerBase({ u, s, sw = 4, lights = true, lightColor }) {
  const lc = lightColor || s.light;
  return (
    <g>
      <path d="M-90 0L-90 34A90 28 0 0 0 90 34L90 0Z" fill={`url(#${u}-metal)`} stroke={OUTLINE} strokeWidth={sw} strokeLinejoin="round" />
      <path d="M-90 12A90 28 0 0 0 90 12" fill="none" stroke={s.trim} strokeWidth={sw * 1.4} />
      {lights &&
        [-62, -22, 22, 62].map((x) => {
          const y = 22 + Math.sqrt(Math.max(0, 1 - (x / 90) ** 2)) * 26;
          return <rect key={x} x={x - 11} y={y - 5} width="22" height="8" rx="4" fill={lc} stroke={OUTLINE} strokeWidth={sw * 0.5} />;
        })}
      {s.motif === 'scroll' && (
        <g stroke={OUTLINE} strokeWidth={sw * 0.8}>
          <path d="M-96 6L-96 30A96 30 0 0 0 96 30L96 6" fill="none" stroke="#f2dcaa" strokeWidth={sw * 2.2} />
          <circle cx="-96" cy="18" r="11" fill="#f2dcaa" />
          <circle cx="96" cy="18" r="11" fill="#f2dcaa" />
          <circle cx="-96" cy="18" r="4" fill="#c99a52" />
          <circle cx="96" cy="18" r="4" fill="#c99a52" />
        </g>
      )}
      {s.motif === 'star' && (
        <g fill={s.trim} stroke={OUTLINE} strokeWidth={sw * 0.7}>
          <path d="M-88 10Q-116 -6 -112 -34Q-100 -18 -86 -12Z" />
          <path d="M88 10Q116 -6 112 -34Q100 -18 86 -12Z" />
        </g>
      )}
      <ellipse cx="0" cy="0" rx="90" ry="28" fill={`url(#${u}-rim)`} stroke={OUTLINE} strokeWidth={sw} />
      <ellipse cx="0" cy="-1" rx="70" ry="19" fill={s.baseLo} opacity="0.85" />
    </g>
  );
}

export function BuzzerDome({ u, s, sw = 4, theme, domeFill }) {
  const fill = domeFill || `url(#${u}-dome)`;
  const crystal = s.motif === 'crystal';
  return (
    <g>
      {crystal ? (
        <g stroke={OUTLINE} strokeWidth={sw} strokeLinejoin="round">
          <path d="M-60 -2L-54 -38L-26 -76L0 -86L26 -76L54 -38L60 -2A60 16 0 0 1 -60 -2Z" fill={fill} />
          <g fill="none" stroke="#ffffff" strokeWidth={sw * 0.6} opacity="0.75">
            <path d="M-54 -38L-18 -44L0 -86M-18 -44L0 8M-18 -44L18 -44L54 -38M18 -44L0 -86M18 -44L0 8M-26 -76L-18 -44M26 -76L18 -44" />
          </g>
          <path d="M-40 -40L-22 -70L-14 -48Z" fill="#ffffff" stroke="none" opacity="0.6" />
        </g>
      ) : (
        <g>
          <path d="M-62 -2C-62 -104 62 -104 62 -2A62 16 0 0 1 -62 -2Z" fill={fill} stroke={OUTLINE} strokeWidth={sw} strokeLinejoin="round" />
          <ellipse cx="-26" cy="-52" rx="18" ry="10" transform="rotate(-32 -26 -52)" fill="#ffffff" opacity="0.7" />
          <circle cx="-6" cy="-68" r="4.5" fill="#ffffff" opacity="0.6" />
        </g>
      )}
      {s.motif === 'galaxy' && (
        <g>
          {[[-30, -20, 2.5], [18, -40, 3], [34, -18, 2], [-8, -28, 1.8], [8, -12, 2.2]].map(([x, y, r], i) => (
            <circle key={i} cx={x} cy={y} r={r} fill="#ffffff" />
          ))}
          <path d={starPath(22, -24, 8, 0.4, 4, 0)} fill="#fff4b0" />
          <ellipse cx="0" cy="-26" rx="84" ry="16" transform="rotate(-10)" fill="none" stroke="#e7d6ff" strokeWidth={sw * 1.1} strokeDasharray="120 40" opacity="0.9" />
        </g>
      )}
      {s.motif === 'dna' && (
        <g fill="none" strokeLinecap="round" strokeWidth={sw * 1.3}>
          <path d="M-44 -20C-30 -52 -10 -52 4 -20S34 12 44 -26" stroke="#ffffff" opacity="0.9" />
          <path d="M-44 -26C-32 8 -12 8 4 -26S34 -54 44 -20" stroke="#0b6b3a" opacity="0.8" />
          {[-34, -18, 14, 30].map((x) => (
            <line key={x} x1={x} y1={-40} x2={x} y2={-6} stroke="#e8fff0" strokeWidth={sw * 0.7} opacity="0.8" />
          ))}
        </g>
      )}
      {s.motif === 'note' && (
        <g fill="#ffffff" stroke={OUTLINE} strokeWidth={sw * 0.6}>
          <path d="M6 -62L30 -68L30 -58L12 -53L12 -20A11 8 0 1 1 6 -28Z" />
        </g>
      )}
      {s.motif === 'scroll' && (
        <g stroke="#a8763c" strokeWidth={sw * 0.9} strokeLinecap="round" opacity="0.8">
          <line x1="-30" y1="-44" x2="26" y2="-44" />
          <line x1="-38" y1="-30" x2="34" y2="-30" />
          <line x1="-40" y1="-16" x2="18" y2="-16" />
        </g>
      )}
      {s.motif === 'star' && (
        <path d={starPath(0, -34, 24, 0.46)} fill="#fff7cf" stroke="#c7851c" strokeWidth={sw * 0.7} strokeLinejoin="round" />
      )}
      {s.motif === 'crest' && <CrestShape theme={theme} u={`${u}-dc`} x={-22} y={-62} w={44} />}
    </g>
  );
}

// Small held buzzer. Grip (hand) is at (0,0); art extends upward.
export function HeldBuzzer({ u, s, theme, scale = 0.3 }) {
  const sw = 2.2 / scale;
  return (
    <g transform={`translate(0 ${-6}) scale(${scale})`}>
      <BuzzerDefs u={u} s={s} />
      <BuzzerBase u={u} s={s} sw={sw} />
      <BuzzerDome u={u} s={s} sw={sw} theme={theme} />
    </g>
  );
}
