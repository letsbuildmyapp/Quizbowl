import { OUTLINE, SW, starPath } from './util.js';
import { CrestShape } from './Crest.jsx';

export const EMOTE_IDS = ['emote-wave', 'emote-spin', 'emote-dance', 'emote-book', 'emote-rocket', 'emote-salute'];

// Open book drawn centred at (x, y); the cover flips away to show pages.
export function EmoteBook({ x = 68, y = 170, animate = true }) {
  return (
    <g className={animate ? 'qqb-em-book-pop' : undefined} style={{ transformBox: 'view-box', transformOrigin: `${x}px ${y}px` }}>
      <g transform={`translate(${x} ${y})`}>
        <path d="M0 4Q-13 -2 -26 2V-18Q-13 -22 0 -16Z" fill="#fffaf0" stroke={OUTLINE} strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M0 4Q13 -2 26 2V-18Q13 -22 0 -16Z" fill="#fffaf0" stroke={OUTLINE} strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M0 6Q-14 0 -29 4V7Q-14 3 0 9Q14 3 29 7V4Q14 0 0 6Z" fill="#12a58f" stroke={OUTLINE} strokeWidth="1.6" />
        <path d="M-20 -11H-6M-20 -5H-6M6 -11H20M6 -5H20" stroke="#b9b3d6" strokeWidth="1.6" />
        <path d={starPath(0, -30, 5, 0.45)} fill="#ffe066" stroke="#f5b400" strokeWidth="0.8" />
        {animate && (
          <g className="qqb-em-book-cover" style={{ transformBox: 'view-box', transformOrigin: `${x}px ${y}px` }}>
            <rect x="0" y="-19" width="27" height="24" rx="3" fill="#12a58f" stroke={OUTLINE} strokeWidth="1.8" />
            <path d={starPath(13, -7, 5, 0.45)} fill="#ffe066" />
          </g>
        )}
      </g>
    </g>
  );
}

export function RocketPuffs({ animate = true }) {
  return (
    <g className={animate ? 'qqb-em-puff' : undefined}>
      {[88, 128].map((x) => (
        <g key={x}>
          <path d={`M${x - 9} 238Q${x} 266 ${x} 266Q${x} 266 ${x + 9} 238Z`} fill="#ff8a1f" stroke={OUTLINE} strokeWidth="1.6" strokeLinejoin="round" />
          <path d={`M${x - 4} 239Q${x} 254 ${x} 254Q${x} 254 ${x + 4} 239Z`} fill="#fff3a0" />
        </g>
      ))}
      {[[70, 252, 7], [146, 252, 7], [108, 258, 6]].map(([x, y, r]) => (
        <circle key={x} cx={x} cy={y} r={r} fill="#eef0fa" stroke="#9aa0c4" strokeWidth="1.4" />
      ))}
    </g>
  );
}

export function SaluteShield({ theme, u, animate = true }) {
  return (
    <g className={animate ? 'qqb-em-shield' : undefined} style={{ transformBox: 'view-box', transformOrigin: '182px 146px' }}>
      <CrestShape theme={theme} u={`${u}-ss`} x={160} y={118} w={44} />
    </g>
  );
}

// Static motion marks used by emote icons.
export function EmoteIconMarks({ emote }) {
  const st = { fill: 'none', stroke: '#ffc940', strokeWidth: 6, strokeLinecap: 'round' };
  const ol = { ...st, stroke: OUTLINE, strokeWidth: 10 };
  const both = (d) => (
    <g>
      <path d={d} {...ol} />
      <path d={d} {...st} />
    </g>
  );
  switch (emote) {
    case 'emote-wave':
      return both('M14 70Q6 50 16 30M28 56Q24 44 30 34');
    case 'emote-spin':
      return (
        <g>
          {both('M22 212Q108 262 196 212')}
          <path d="M196 200L212 214L192 226Z" fill="#ffc940" stroke={OUTLINE} strokeWidth={SW} strokeLinejoin="round" />
        </g>
      );
    case 'emote-dance':
      return (
        <g fill="#ff6fb5" stroke={OUTLINE} strokeWidth="2" strokeLinejoin="round">
          <path d="M20 36L40 30V70A9 7 0 1 1 34 64V44L26 46V76A9 7 0 1 1 20 70Z" />
          <path d="M200 16L208 14V44A8 6 0 1 1 202 38Z" />
        </g>
      );
    case 'emote-rocket':
      return (
        <g>
          {both('M40 250V238M108 256V240M176 250V238')}
        </g>
      );
    default:
      return null;
  }
}
