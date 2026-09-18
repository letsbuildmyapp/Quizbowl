import { resolveTheme, useUid, cls, getItem, prefersReducedMotion } from './util.js';
import { paintPalette, PAINT_IDS } from './palettes.js';
import { PaintDefs, BotFigure, HELD_ANCHOR, COMPANION_ANCHOR } from './botParts.jsx';
import { HEADGEAR, BACK, HELD, COMPANION, EFFECT } from './gear.jsx';
import { EmoteBook, RocketPuffs, SaluteShield } from './emotes.jsx';
import './bot.css';

export const FACE_IDS = ['face-smile', 'face-visor', 'face-star', 'face-heart', 'face-shades'];


export function normalizeLoadout(loadout) {
  const l = loadout || {};
  const pick = (id, table) => (id && table[id] ? id : null);
  return {
    paint: PAINT_IDS.includes(l.paint) ? l.paint : 'paint-sky',
    face: FACE_IDS.includes(l.face) ? l.face : 'face-smile',
    headgear: pick(l.headgear, HEADGEAR),
    back: pick(l.back, BACK),
    held: pick(l.held, HELD),
    companion: pick(l.companion, COMPANION),
    effect: pick(l.effect, EFFECT),
    emote: l.emote && getItem(l.emote)?.slot === 'emote' ? l.emote : null
  };
}

// Emotes play once on mount of pose="emote"; remount (change `key`) to replay.
export default function QuizBot({ loadout, theme, size = 200, pose = 'idle', reducedMotion = false, title, className }) {
  const u = useUid('qb');
  const t = resolveTheme(theme);
  const l = normalizeLoadout(loadout);
  const p = paintPalette(l.paint, t);
  const ctx = { u, theme: t, p };
  const rm = reducedMotion || prefersReducedMotion();
  const emote = pose === 'emote' && !rm ? l.emote : null;
  const fx = l.effect ? EFFECT[l.effect] : null;
  const back = l.back ? BACK[l.back] : null;

  const held = l.held ? (
    <g transform={`translate(${HELD_ANCHOR.x} ${HELD_ANCHOR.y})`} className={emote === 'emote-salute' ? 'qqb-em-hide' : undefined}>
      {HELD[l.held].render({ ...ctx, u: `${u}-h` })}
    </g>
  ) : null;

  return (
    <svg
      viewBox="0 0 240 260"
      width={size}
      height={(size * 260) / 240}
      role="img"
      aria-label={title || 'QuizBot'}
      className={cls('qqb-anim qqb-bot', `qqb-pose-${pose}`, emote && `qqb-em-${emote.replace('emote-', '')}`, rm && 'qqb-rm', className)}
      style={{ overflow: 'visible', display: 'block' }}
    >
      <PaintDefs u={u} p={p} />
      <g className="qqb-bob">
        {fx?.back && <g>{fx.back({ ...ctx, u: `${u}-fx` })}</g>}
        <g className="qqb-bodymove" style={{ transformBox: 'view-box', transformOrigin: '108px 240px' }}>
          {back && <g>{back.render({ ...ctx, u: `${u}-b` })}</g>}
          <BotFigure u={u} p={p} theme={t} faceId={l.face} blink showAntenna={!l.headgear} held={held} />
          {back?.front && back.front(ctx)}
          {l.headgear && HEADGEAR[l.headgear].render({ ...ctx, u: `${u}-hg` })}
          {emote === 'emote-book' && <EmoteBook x={100} y={146} />}
          {emote === 'emote-salute' && <SaluteShield theme={t} u={u} />}
          {emote === 'emote-rocket' && <RocketPuffs />}
        </g>
      </g>
      {l.companion && (
        <g transform={`translate(${COMPANION_ANCHOR.x} ${COMPANION_ANCHOR.y})`}>
          <g className="qqb-float qqb-pet"><g transform="scale(1.15)">{COMPANION[l.companion].render({ ...ctx, u: `${u}-c` })}</g></g>
        </g>
      )}
      {fx?.front && <g>{fx.front({ ...ctx, u: `${u}-fx` })}</g>}
    </svg>
  );
}
