import { OUTLINE, SW, starPath, cls } from './util.js';
import { CrestShape } from './Crest.jsx';

// Bot geometry (240x260 frame). Everything is drawn in absolute coords so CSS
// transform-origins in px line up with the viewBox.
export const HEAD = { x: 50, y: 26, w: 116, h: 102, r: 48 };
export const SCREEN = { cx: 108, cy: 83, w: 84, h: 58, r: 22 };
export const HAND_R = { x: 181, y: 160 }; // right hand (held item grip)
export const HELD_ANCHOR = { x: 182, y: 152 };
export const COMPANION_ANCHOR = { x: 206, y: 222 };

const EYE = '#5ef2ff';

export function PaintDefs({ u, p }) {
  return (
    <defs>
      <linearGradient id={`${u}-main`} x1="0" y1="0" x2="0.35" y2="1">
        <stop offset="0" stopColor={p.mainHi} />
        <stop offset="0.45" stopColor={p.main} />
        <stop offset="1" stopColor={p.mainLo} />
      </linearGradient>
      <linearGradient id={`${u}-trim`} x1="0" y1="0" x2="0.3" y2="1">
        <stop offset="0" stopColor={p.trimHi} />
        <stop offset="0.55" stopColor={p.trim} />
        <stop offset="1" stopColor={p.trimLo} />
      </linearGradient>
      <linearGradient id={`${u}-joint`} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor={p.jointHi} />
        <stop offset="1" stopColor={p.joint} />
      </linearGradient>
      <linearGradient id={`${u}-screen`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#2b3270" />
        <stop offset="1" stopColor="#0c0f2e" />
      </linearGradient>
      <radialGradient id={`${u}-core`} cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#ffffff" />
        <stop offset="0.45" stopColor={p.core} />
        <stop offset="1" stopColor={p.trimLo} />
      </radialGradient>
    </defs>
  );
}

// ---------- Face panel ----------
function PixelHeart({ cx, cy, px = 3, color = '#ff5fa2' }) {
  const rows = ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'];
  const x0 = cx - (7 * px) / 2;
  const y0 = cy - (6 * px) / 2;
  const cells = [];
  rows.forEach((row, r) =>
    [...row].forEach((c, col) => {
      if (c === 'X') cells.push(<rect key={`${r}-${col}`} x={x0 + col * px} y={y0 + r * px} width={px + 0.15} height={px + 0.15} fill={color} />);
    })
  );
  return (
    <g>
      <ellipse cx={cx} cy={cy} rx={px * 4.6} ry={px * 4} fill={color} opacity="0.28" />
      {cells}
      <rect x={x0 + px} y={y0 + px} width={px} height={px} fill="#ffffff" opacity="0.85" />
    </g>
  );
}

// Face drawn centered on (cx, cy) of the screen.
export function FaceMarks({ faceId, cx = SCREEN.cx, cy = SCREEN.cy, blink = false }) {
  const ex = 15;
  const ey = cy - 5;
  const smile = (color = EYE, w = 8) => (
    <path d={`M${cx - w} ${cy + 11}Q${cx} ${cy + 18} ${cx + w} ${cy + 11}`} fill="none" stroke={color} strokeWidth="3.2" strokeLinecap="round" />
  );
  const eyesCls = cls(blink && 'qqb-blink');
  switch (faceId) {
    case 'face-visor':
      return (
        <g>
          <g className={eyesCls}>
            <rect x={cx - 36} y={ey - 11} width="72" height="20" rx="10" fill={EYE} opacity="0.25" />
            <rect x={cx - 32} y={ey - 7} width="64" height="12" rx="6" fill={EYE} />
            <rect x={cx - 26} y={ey - 5} width="20" height="4" rx="2" fill="#ffffff" opacity="0.8" />
            <rect x={cx + 4} y={ey - 5} width="10" height="4" rx="2" fill="#ffffff" opacity="0.55" />
          </g>
          <path d={`M${cx - 6} ${cy + 13}Q${cx} ${cy + 16} ${cx + 6} ${cy + 13}`} fill="none" stroke={EYE} strokeWidth="3" strokeLinecap="round" />
        </g>
      );
    case 'face-star':
      return (
        <g>
          <g className={eyesCls}>
            {[-ex, ex].map((dx) => (
              <g key={dx}>
                <circle cx={cx + dx} cy={ey} r="12" fill="#ffe066" opacity="0.25" />
                <path d={starPath(cx + dx, ey, 10.5, 0.48)} fill="#ffe066" stroke="#ffb020" strokeWidth="1.2" strokeLinejoin="round" />
                <circle cx={cx + dx - 2.5} cy={ey - 3} r="1.8" fill="#ffffff" />
              </g>
            ))}
          </g>
          {smile(EYE, 7)}
        </g>
      );
    case 'face-heart':
      return (
        <g>
          <g className={eyesCls}>
            <PixelHeart cx={cx - ex} cy={ey} />
            <PixelHeart cx={cx + ex} cy={ey} />
          </g>
          {smile('#ff9fcb', 6)}
        </g>
      );
    case 'face-shades':
      return (
        <g>
          <path
            d={`M${cx - 36} ${ey - 10}H${cx + 36}V${ey - 6}H${cx + 34}L${cx + 31} ${ey + 5}Q${cx + 30} ${ey + 9} ${cx + 25} ${ey + 9}H${cx + 8}Q${cx + 4} ${ey + 9} ${cx + 3} ${ey + 5}L${cx + 2} ${ey - 3}H${cx - 2}L${cx - 3} ${ey + 5}Q${cx - 4} ${ey + 9} ${cx - 8} ${ey + 9}H${cx - 25}Q${cx - 30} ${ey + 9} ${cx - 31} ${ey + 5}L${cx - 34} ${ey - 6}H${cx - 36}Z`}
            fill="#05060f"
            stroke="#8f95c9"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          <path d={`M${cx - 24} ${ey - 4}L${cx - 18} ${ey - 4}L${cx - 24} ${ey + 5}L${cx - 28} ${ey + 5}Z`} fill="#ffffff" opacity="0.85" />
          <path d={`M${cx + 13} ${ey - 4}L${cx + 17} ${ey - 4}L${cx + 12} ${ey + 4}L${cx + 9} ${ey + 4}Z`} fill="#ffffff" opacity="0.6" />
          <path d={`M${cx - 5} ${cy + 14}Q${cx + 3} ${cy + 18} ${cx + 10} ${cy + 11}`} fill="none" stroke={EYE} strokeWidth="3" strokeLinecap="round" />
        </g>
      );
    case 'face-smile':
    default:
      return (
        <g>
          <g className={eyesCls}>
            {[-ex, ex].map((dx) => (
              <g key={dx}>
                <ellipse cx={cx + dx} cy={ey} rx="10" ry="12" fill={EYE} opacity="0.25" />
                <ellipse cx={cx + dx} cy={ey} rx="6.5" ry="8.5" fill={EYE} />
                <circle cx={cx + dx - 2} cy={ey - 4} r="2.2" fill="#ffffff" />
              </g>
            ))}
          </g>
          <ellipse cx={cx - 27} cy={cy + 9} rx="5" ry="3" fill="#ff7eb0" opacity="0.5" />
          <ellipse cx={cx + 27} cy={cy + 9} rx="5" ry="3" fill="#ff7eb0" opacity="0.5" />
          {smile()}
        </g>
      );
  }
}

export function Screen({ u, cx = SCREEN.cx, cy = SCREEN.cy, faceId, blink }) {
  const { w, h, r } = SCREEN;
  return (
    <g>
      <rect x={cx - w / 2 - 3} y={cy - h / 2 - 3} width={w + 6} height={h + 6} rx={r + 3} fill={OUTLINE} opacity="0.35" />
      <rect x={cx - w / 2} y={cy - h / 2} width={w} height={h} rx={r} fill={`url(#${u}-screen)`} stroke={OUTLINE} strokeWidth={SW} />
      <FaceMarks faceId={faceId} cx={cx} cy={cy} blink={blink} />
      <path
        d={`M${cx - w / 2 + 10} ${cy - h / 2 + 16}Q${cx - w / 2 + 12} ${cy - h / 2 + 5} ${cx - w / 2 + 26} ${cy - h / 2 + 5}`}
        fill="none"
        stroke="#ffffff"
        strokeWidth="3"
        strokeLinecap="round"
        opacity="0.3"
      />
    </g>
  );
}

// ---------- Paint pattern overlays ----------
function PatternHead({ p }) {
  if (p.pattern === 'lava')
    return (
      <g fill="none" stroke="#ff8a1f" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M60 50L68 56L64 64L72 70" opacity="0.9" />
        <path d="M150 40L144 48L152 52" opacity="0.9" />
        <path d="M156 100L150 106L156 114" opacity="0.9" />
        <path d="M84 36L92 40L90 46" opacity="0.9" />
        <path d="M60 50L68 56L64 64L72 70" stroke="#ffe08a" strokeWidth="0.8" />
      </g>
    );
  if (p.pattern === 'galaxy')
    return (
      <g fill="#ffffff">
        {[
          [70, 44, 1.6], [96, 34, 1.1], [140, 42, 1.8], [154, 64, 1.1], [60, 104, 1.3], [152, 112, 1.5], [124, 32, 1], [62, 70, 0.9]
        ].map(([x, y, r], i) => (
          <circle key={i} cx={x} cy={y} r={r} opacity="0.9" />
        ))}
        <path d={starPath(146, 52, 4, 0.3, 4, 0)} fill="#ffe8ff" />
      </g>
    );
  if (p.pattern === 'gold')
    return <path d="M130 30L142 34L100 124L88 122Z" fill="#ffffff" opacity="0.35" />;
  return null;
}
function PatternBody({ p }) {
  if (p.pattern === 'lava')
    return (
      <g fill="none" stroke="#ff8a1f" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M76 142L82 150L78 158" />
        <path d="M140 150L134 160L140 170" />
        <path d="M84 206L90 212" />
      </g>
    );
  if (p.pattern === 'galaxy')
    return (
      <g fill="#ffffff">
        {[[78, 146, 1.3], [138, 168, 1.5], [82, 176, 1], [140, 142, 1]].map(([x, y, r], i) => (
          <circle key={i} cx={x} cy={y} r={r} />
        ))}
      </g>
    );
  if (p.pattern === 'gold') return <path d="M132 130L140 132L118 198L110 198Z" fill="#ffffff" opacity="0.3" />;
  return null;
}

// ---------- Figure ----------
// Pose props allow static poses (emote icons) via rotation attributes; CSS emotes animate inner groups.
export function BotFigure({
  u,
  p,
  theme,
  faceId,
  showAntenna = true,
  blink = false,
  leftArmRot = 0,
  rightArmRot = 0,
  held = null, // JSX drawn at HELD_ANCHOR
  leftHeld = null, // JSX drawn in left hand (emote props)
  mono = null, // silhouette colour
  headOnly = false
}) {
  const f = (k) => (mono ? mono : `url(#${u}-${k})`);
  const sk = mono ? OUTLINE : OUTLINE;
  const common = { stroke: sk, strokeWidth: SW, strokeLinejoin: 'round' };
  return (
    <g>
      {!headOnly && (<>
      {/* legs + feet */}
      <rect x="84" y="192" width="18" height="34" rx="8" fill={f('joint')} {...common} />
      <rect x="114" y="192" width="18" height="34" rx="8" fill={f('joint')} {...common} />
      <rect x="72" y="218" width="34" height="22" rx="10" fill={f('trim')} {...common} />
      <rect x="110" y="218" width="34" height="22" rx="10" fill={f('trim')} {...common} />
      {!mono && (
        <g fill="#ffffff" opacity="0.35">
          <rect x="78" y="221" width="14" height="4" rx="2" />
          <rect x="116" y="221" width="14" height="4" rx="2" />
        </g>
      )}

      {/* torso */}
      <path d="M76 124H140Q153 124 151 137L145 188Q143 201 130 201H86Q73 201 71 188L65 137Q63 124 76 124Z" fill={f('main')} {...common} />
      {!mono && <PatternBody p={p} />}
      {!mono && (
        <>
          <rect x="86" y="138" width="44" height="40" rx="13" fill={p.mainHi} stroke={OUTLINE} strokeWidth="1.6" opacity="0.9" />
          {p.pattern === 'school' ? (
            <CrestShape theme={theme} u={`${u}-chest`} x={94} y={140} w={28} />
          ) : (
            <g>
              <circle cx="108" cy="158" r="12" fill={f('trim')} stroke={OUTLINE} strokeWidth="1.8" />
              <circle cx="108" cy="158" r="7" fill={`url(#${u}-core)`} />
              <circle cx="105.5" cy="155.5" r="2" fill="#ffffff" opacity="0.9" />
            </g>
          )}
        </>
      )}
      <rect x="69" y="183" width="78" height="13" rx="6.5" fill={f('trim')} {...common} />
      {!mono && <rect x="100" y="181" width="16" height="17" rx="4" fill={p.mainHi} stroke={OUTLINE} strokeWidth="1.8" />}

      </>)}
      {/* head */}
      <rect x={HEAD.x} y={HEAD.y} width={HEAD.w} height={HEAD.h} rx={HEAD.r} fill={f('main')} {...common} />
      {!mono && <PatternHead p={p} />}
      {!mono && (
        <path d="M66 58Q70 36 96 31" fill="none" stroke="#ffffff" strokeWidth="6" strokeLinecap="round" opacity="0.55" />
      )}
      {showAntenna && (
        <g>
          <rect x="105" y="12" width="6" height="16" rx="3" fill={f('joint')} {...common} strokeWidth={SW * 0.8} />
          <circle cx="108" cy="11" r="6.5" fill={f('trim')} {...common} />
          {!mono && <circle cx="106" cy="9" r="2" fill="#ffffff" opacity="0.8" />}
        </g>
      )}
      {/* ear discs */}
      {[48, 168].map((x) => (
        <g key={x}>
          <circle cx={x} cy="84" r="18" fill={f('trim')} {...common} />
          {!mono && <circle cx={x} cy="84" r="10" fill={p.trimHi} stroke={OUTLINE} strokeWidth="1.5" />}
          {!mono && <circle cx={x} cy="84" r="4" fill={p.core} opacity="0.9" />}
        </g>
      ))}
      {mono ? (
        <g>
          <rect x={SCREEN.cx - SCREEN.w / 2} y={SCREEN.cy - SCREEN.h / 2} width={SCREEN.w} height={SCREEN.h} rx={SCREEN.r} fill="#ffffff" stroke={OUTLINE} strokeWidth={SW} />
          <ellipse cx={SCREEN.cx - 15} cy={SCREEN.cy - 4} rx="7" ry="9" fill={OUTLINE} />
          <ellipse cx={SCREEN.cx + 15} cy={SCREEN.cy - 4} rx="7" ry="9" fill={OUTLINE} />
          <path d={`M${SCREEN.cx - 8} ${SCREEN.cy + 12}Q${SCREEN.cx} ${SCREEN.cy + 19} ${SCREEN.cx + 8} ${SCREEN.cy + 12}`} fill="none" stroke={OUTLINE} strokeWidth="4" strokeLinecap="round" />
        </g>
      ) : (
        <Screen u={u} faceId={faceId} blink={blink} />
      )}

      {!headOnly && (<>
      {/* left (free) arm */}
      <g transform={`rotate(${leftArmRot} 68 138)`}>
        <g className="qqb-arm-l" style={{ transformBox: 'view-box', transformOrigin: '68px 138px' }}>
          <rect x="58" y="134" width="20" height="42" rx="10" fill={f('main')} {...common} />
          <rect x="57" y="163" width="22" height="8" rx="4" fill={f('trim')} {...common} strokeWidth={SW * 0.7} />
          {leftHeld}
          <circle cx="68" cy="181" r="11" fill={f('trim')} {...common} />
        </g>
      </g>
      <ellipse cx="70" cy="136" rx="16" ry="13" fill={f('trim')} {...common} />
      {!mono && <ellipse cx="66" cy="131" rx="7" ry="3.5" fill="#ffffff" opacity="0.45" />}

      {/* right (holding) arm */}
      <g transform={`rotate(${rightArmRot} 147 138)`}>
        <g className="qqb-arm-r" style={{ transformBox: 'view-box', transformOrigin: '147px 138px' }}>
          <g transform="rotate(-62 147 138)">
            <rect x="137" y="134" width="20" height="40" rx="10" fill={f('main')} {...common} />
            <rect x="136" y="161" width="22" height="8" rx="4" fill={f('trim')} {...common} strokeWidth={SW * 0.7} />
          </g>
          {held}
          <circle cx={HAND_R.x} cy={HAND_R.y} r="11" fill={f('trim')} {...common} />
          {!mono && <circle cx={HAND_R.x - 3} cy={HAND_R.y - 3} r="3" fill="#ffffff" opacity="0.4" />}
        </g>
      </g>
      <ellipse cx="146" cy="136" rx="16" ry="13" fill={f('trim')} {...common} />
      {!mono && <ellipse cx="142" cy="131" rx="7" ry="3.5" fill="#ffffff" opacity="0.45" />}
      </>)}
    </g>
  );
}
