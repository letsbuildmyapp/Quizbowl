import { OUTLINE, SW, resolveTheme, useUid, getItem, starPath, cls } from './util.js';
import { paintPalette } from './palettes.js';
import { PaintDefs, BotFigure, Screen, SCREEN, HELD_ANCHOR } from './botParts.jsx';
import { CrestShape } from './Crest.jsx';
import { HEADGEAR, BACK, HELD, COMPANION, EFFECT } from './gear.jsx';
import { EmoteBook, RocketPuffs, EmoteIconMarks } from './emotes.jsx';
import './bot.css';

export function itemDisplayName(item, theme) {
  const t = resolveTheme(theme);
  const it = typeof item === 'string' ? getItem(item) : item;
  if (!it) return '';
  return String(it.name || '')
    .replace(/\{mascot\}/g, t.mascotName || '')
    .replace(/\{crest\}/g, t.crestLetter || '');
}

function PaintCan({ u, p, theme }) {
  return (
    <g>
      <defs>
        <linearGradient id={`${u}-can`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#8e97b8" />
          <stop offset="0.35" stopColor="#f2f5fb" />
          <stop offset="1" stopColor="#7b85a8" />
        </linearGradient>
      </defs>
      <path d="M30 34Q50 2 70 34" fill="none" stroke={OUTLINE} strokeWidth="3" />
      <path d="M22 38V84Q22 94 50 94Q78 94 78 84V38Z" fill={`url(#${u}-can)`} stroke={OUTLINE} strokeWidth={SW} strokeLinejoin="round" />
      <path d="M22 54Q50 60 78 54V78Q50 84 22 78Z" fill={`url(#${u}-trim)`} stroke={OUTLINE} strokeWidth="1.8" />
      {p.pattern === 'school' && <CrestShape theme={theme} u={`${u}-pc`} x={40} y={56} w={20} />}
      <ellipse cx="50" cy="38" rx="28" ry="8" fill="#c9d2e6" stroke={OUTLINE} strokeWidth={SW} />
      <path
        d="M26 38Q26 32 50 32Q74 32 74 38Q74 42 70 44V56Q70 60 66 60Q62 60 62 56V45Q50 47 40 46V62Q40 66 36 66Q32 66 32 62V44Q26 42 26 38Z"
        fill={`url(#${u}-main)`}
        stroke={OUTLINE}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {p.pattern === 'lava' && <path d="M34 36L42 40L48 36L56 40" fill="none" stroke="#ff8a1f" strokeWidth="2" strokeLinecap="round" />}
      {p.pattern === 'galaxy' && (
        <g fill="#ffffff">
          <circle cx="40" cy="37" r="1.2" />
          <circle cx="58" cy="35" r="1" />
          <path d={starPath(50, 38, 3, 0.4, 4, 0)} />
        </g>
      )}
      {p.pattern === 'gold' && <path d={starPath(50, 22, 7, 0.3, 4, 0)} fill="#fff7cf" stroke="#c7851c" strokeWidth="1" />}
      <ellipse cx="42" cy="35" rx="7" ry="2" fill="#ffffff" opacity="0.55" />
      <rect x="28" y="62" width="5" height="22" rx="2.5" fill="#ffffff" opacity="0.45" />
    </g>
  );
}

const MONO = '#8b6cff';

function EmoteFigure({ u, emote, theme, p }) {
  const t = resolveTheme(theme);
  const base = { u, p, theme: t, faceId: 'face-smile', mono: MONO, showAntenna: true };
  const heldPlain = (
    <g transform={`translate(${HELD_ANCHOR.x} ${HELD_ANCHOR.y})`}>
      <circle cx="0" cy="-8" r="0" />
    </g>
  );
  let fig;
  let wrap = '';
  switch (emote) {
    case 'emote-wave':
      fig = <BotFigure {...base} leftArmRot={150} />;
      break;
    case 'emote-dance':
      fig = <BotFigure {...base} leftArmRot={120} rightArmRot={-20} />;
      wrap = 'rotate(-8 108 240)';
      break;
    case 'emote-book':
      fig = (
        <g>
          <BotFigure {...base} leftArmRot={-52} />
          <EmoteBook x={100} y={146} animate={false} />
        </g>
      );
      break;
    case 'emote-rocket':
      fig = (
        <g>
          <g transform="translate(0 -16)">
            <BotFigure {...base} />
          </g>
          <RocketPuffs animate={false} />
        </g>
      );
      break;
    case 'emote-salute':
      fig = (
        <g>
          <BotFigure {...base} leftArmRot={158} held={heldPlain} />
          <CrestShape theme={t} u={`${u}-ss`} x={158} y={116} w={48} />
        </g>
      );
      break;
    case 'emote-spin':
    default:
      fig = <BotFigure {...base} rightArmRot={-30} />;
  }
  return (
    <g>
      <g transform={wrap}>{fig}</g>
      <EmoteIconMarks emote={emote} />
    </g>
  );
}

function pad([x, y, w, h], k = 0.08) {
  const m = Math.max(w, h);
  const cx = x + w / 2;
  const cy = y + h / 2;
  const s = m * (1 + k * 2);
  return `${cx - s / 2} ${cy - s / 2} ${s} ${s}`;
}

export default function ItemArt({ itemId, theme, size = 64, title, className }) {
  const u = useUid('ia');
  const t = resolveTheme(theme);
  const item = getItem(itemId);
  const label = title || (item ? itemDisplayName(item, t) : 'Unknown item');
  const slot = item?.slot;
  let viewBox = '0 0 100 100';
  let body = null;
  let defsPalette = paintPalette('paint-sky', t);

  if (slot === 'paint') {
    defsPalette = paintPalette(itemId, t);
    body = <PaintCan u={u} p={defsPalette} theme={t} />;
  } else if (slot === 'face') {
    viewBox = pad([SCREEN.cx - 48, SCREEN.cy - 48, 96, 96], 0);
    body = (
      <g>
        <rect x={SCREEN.cx - 50} y={SCREEN.cy - 37} width="100" height="74" rx="30" fill="#e6e3f5" stroke={OUTLINE} strokeWidth={SW} />
        <Screen u={u} faceId={itemId} />
      </g>
    );
  } else if (slot === 'headgear' && HEADGEAR[itemId]) {
    const g = HEADGEAR[itemId];
    viewBox = pad(g.box);
    body = (
      <g>
        {g.withHead && <BotFigure u={u} p={defsPalette} theme={t} faceId="face-smile" showAntenna={false} headOnly />}
        {g.render({ u: `${u}-g`, theme: t })}
      </g>
    );
  } else if (slot === 'back' && BACK[itemId]) {
    const g = BACK[itemId];
    if (g.icon && g.iconBox) {
      body = g.icon({ u: `${u}-g`, theme: t });
    } else {
      viewBox = pad(g.box);
      body = (
        <g>
          {(g.icon || g.render)({ u: `${u}-g`, theme: t })}
          {g.front && g.front({ u })}
        </g>
      );
    }
  } else if (slot === 'held' && HELD[itemId]) {
    viewBox = pad(HELD[itemId].box, 0.04);
    body = HELD[itemId].render({ u: `${u}-g`, theme: t });
  } else if (slot === 'companion' && COMPANION[itemId]) {
    viewBox = pad([-30, -32, 60, 62], 0.02);
    body = COMPANION[itemId].render({ u: `${u}-g`, theme: t });
  } else if (slot === 'effect' && EFFECT[itemId]) {
    body = EFFECT[itemId].icon({ u: `${u}-g`, theme: t });
  } else if (slot === 'emote') {
    viewBox = '-6 -4 252 266';
    body = <EmoteFigure u={u} emote={itemId} theme={t} p={defsPalette} />;
  } else {
    body = (
      <g>
        <circle cx="50" cy="50" r="36" fill="#ece7ff" stroke={OUTLINE} strokeWidth={SW} />
        <text x="50" y="52" textAnchor="middle" dominantBaseline="central" fontSize="44" fontWeight="800" fill={OUTLINE} fontFamily="Fredoka, Nunito, system-ui, sans-serif">?</text>
      </g>
    );
  }

  return (
    <svg
      viewBox={viewBox}
      width={size}
      height={size}
      role="img"
      aria-label={label}
      className={cls('qqb-anim', className)}
      style={{ overflow: 'hidden', display: 'inline-block' }}
    >
      <PaintDefs u={u} p={defsPalette} />
      {body}
    </svg>
  );
}
