import { OUTLINE, useUid, shade, cls, resolveTheme, prefersReducedMotion } from './util.js';
import { buzzerSkin } from './palettes.js';
import { BuzzerDefs, BuzzerBase, BuzzerDome } from './buzzerShape.jsx';
import './bot.css';

function recolor(s, dome) {
  return { ...s, dome, domeHi: shade(dome, 0.55), domeLo: shade(dome, -0.35), light: shade(dome, 0.45) };
}

// Presentation only: place inside a real <button>; the svg is aria-hidden and ignores pointer events.
export default function BuzzerArt({ state = 'idle', teamColor, skin = 'buzzer-classic', theme, size = 240, reducedMotion = false, className }) {
  const u = useUid('bz');
  const t = resolveTheme(theme);
  const rm = reducedMotion || prefersReducedMotion();
  const team = teamColor || t.primaryColor;
  let s = buzzerSkin(skin, t);
  let ring = shade(s.dome, 0.25);
  if (state === 'accepted') {
    s = recolor(s, team);
    ring = team;
  } else if (state === 'late') {
    s = { ...recolor(s, '#a4a8bf'), motif: s.motif === 'crystal' ? 'crystal' : null };
    ring = '#a4a8bf';
  }
  const lit = state === 'ready' || state === 'pressed' || state === 'accepted';
  const ringOpacity = lit ? 1 : state === 'idle' ? 0.45 : 0.25;
  const ringW = state === 'accepted' ? 7 : 5;

  const ringArc = (front) => (
    <g opacity={ringOpacity}>
      <path
        d={front ? 'M8 168A112 40 0 0 0 232 168' : 'M8 168A112 40 0 0 1 232 168'}
        fill="none"
        stroke={ring}
        strokeWidth={ringW * 3.2}
        opacity="0.28"
        className="qqb-bz-ring-glow"
      />
      <path d={front ? 'M8 168A112 40 0 0 0 232 168' : 'M8 168A112 40 0 0 1 232 168'} fill="none" stroke={OUTLINE} strokeWidth={ringW + 3} opacity="0.5" />
      <path d={front ? 'M8 168A112 40 0 0 0 232 168' : 'M8 168A112 40 0 0 1 232 168'} fill="none" stroke={ring} strokeWidth={ringW} />
      <path d={front ? 'M8 168A112 40 0 0 0 232 168' : 'M8 168A112 40 0 0 1 232 168'} fill="none" stroke="#ffffff" strokeWidth="1.6" strokeDasharray="14 22" opacity="0.8" />
    </g>
  );

  return (
    <svg
      viewBox="0 0 240 240"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={cls('qqb-anim', `qqb-bz-${state}`, rm && 'qqb-rm', className)}
      style={{
        overflow: 'visible',
        display: 'block',
        pointerEvents: 'none',
        opacity: state === 'disabled' ? 0.45 : 1,
        filter: state === 'disabled' ? 'grayscale(0.85)' : undefined
      }}
    >
      <defs>
        <radialGradient id={`${u}-halo`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor={s.light} stopOpacity="0.8" />
          <stop offset="1" stopColor={s.light} stopOpacity="0" />
        </radialGradient>
      </defs>
      <g transform="translate(120 150)">
        <BuzzerDefs u={u} s={s} />
      </g>
      {state !== 'late' && state !== 'disabled' && (
        <ellipse cx="120" cy="110" rx="112" ry="86" fill={`url(#${u}-halo)`} opacity={lit ? 0.7 : 0.35} className={state === 'ready' ? 'qqb-bz-ring-glow' : undefined} />
      )}
      {ringArc(false)}
      <g transform="translate(120 150)">
        <BuzzerBase u={u} s={s} sw={3} lightColor={state === 'late' ? '#c9ccda' : s.light} />
      </g>
      <g className="qqb-bz-dome">
        <g transform="translate(120 150)">
          <BuzzerDome u={u} s={s} sw={3} theme={t} />
        </g>
      </g>
      {ringArc(true)}
      {state === 'pressed' && (
        <ellipse className="qqb-bz-ripple" cx="120" cy="168" rx="112" ry="40" fill="none" stroke={shade(s.dome, 0.3)} strokeWidth="6" opacity={rm ? 0 : undefined} />
      )}
    </svg>
  );
}
