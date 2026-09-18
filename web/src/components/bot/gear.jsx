import { OUTLINE, SW, shade, starPath, twinklePath, heartPath } from './util.js';
import { CrestShape } from './Crest.jsx';
import { buzzerSkin } from './palettes.js';
import { HeldBuzzer } from './buzzerShape.jsx';

// Each entry: render(ctx) in bot coords, box [x,y,w,h] used by ItemArt, optional icon(ctx) in a 0..100 box,
// optional front(ctx) drawn in front of the body, withHead for headgear previews.
const S = { stroke: OUTLINE, strokeWidth: SW, strokeLinejoin: 'round', strokeLinecap: 'round' };

function Grad({ id, a, b, c, x2 = 0, y2 = 1 }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2={x2} y2={y2}>
      <stop offset="0" stopColor={a} />
      {c && <stop offset="0.5" stopColor={b} />}
      <stop offset="1" stopColor={c || b} />
    </linearGradient>
  );
}
const GOLD = ['#fff1a8', '#f5c04a', '#b7791f'];

// ======================= HEADGEAR =======================
export const HEADGEAR = {
  'head-goggles': {
    box: [62, 20, 92, 42],
    render: ({ u }) => (
      <g>
        <defs>
          <radialGradient id={`${u}-lens`} cx="0.35" cy="0.3" r="0.8">
            <stop offset="0" stopColor="#d4fff7" />
            <stop offset="0.5" stopColor="#3fd6c4" />
            <stop offset="1" stopColor="#0f6f78" />
          </radialGradient>
        </defs>
        <path d="M52 62Q108 26 164 62" fill="none" stroke={OUTLINE} strokeWidth="12" strokeLinecap="round" />
        <path d="M52 62Q108 26 164 62" fill="none" stroke="#7a4a24" strokeWidth="8" strokeLinecap="round" />
        <rect x="100" y="36" width="16" height="7" rx="3" fill="#c98b3a" {...S} strokeWidth="1.8" />
        {[88, 128].map((x) => (
          <g key={x}>
            <circle cx={x} cy="40" r="16" fill="#d9a441" {...S} />
            <circle cx={x} cy="40" r="11" fill={`url(#${u}-lens)`} stroke={OUTLINE} strokeWidth="1.8" />
            <ellipse cx={x - 4} cy="35" rx="4" ry="2.5" fill="#ffffff" opacity="0.85" />
            {[0, 90, 180, 270].map((a) => (
              <circle key={a} cx={x + 13.5 * Math.cos((a * Math.PI) / 180 + 0.8)} cy={40 + 13.5 * Math.sin((a * Math.PI) / 180 + 0.8)} r="1.4" fill="#7a4a24" />
            ))}
          </g>
        ))}
      </g>
    )
  },
  'head-explorer': {
    box: [38, 0, 140, 52],
    render: ({ u }) => (
      <g>
        <defs>
          <Grad id={`${u}-khaki`} a="#f6dfa6" b="#d9b77a" c="#a9854a" />
        </defs>
        <ellipse cx="108" cy="40" rx="66" ry="12" fill="#b99459" {...S} />
        <path d="M62 40C62 2 154 2 154 40Z" fill={`url(#${u}-khaki)`} {...S} />
        <path d="M63 30H153L154 40H62Z" fill="#6b3f1d" {...S} strokeWidth="1.8" />
        <path d="M42 42Q108 58 174 42" fill="none" stroke={OUTLINE} strokeWidth={SW} strokeLinecap="round" />
        <circle cx="108" cy="6" r="5" fill="#a9854a" {...S} strokeWidth="1.8" />
        <path d="M78 16Q86 8 98 7" fill="none" stroke="#ffffff" strokeWidth="4" strokeLinecap="round" opacity="0.6" />
        <path d={starPath(132, 35, 4, 0.45)} fill="#ffd54a" />
      </g>
    )
  },
  'head-astronaut': {
    box: [22, 0, 172, 150],
    withHead: true,
    render: ({ u }) => (
      <g>
        <defs>
          <radialGradient id={`${u}-glass`} cx="0.3" cy="0.25" r="0.9">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.45" />
            <stop offset="0.6" stopColor="#bfe8ff" stopOpacity="0.12" />
            <stop offset="1" stopColor="#6fb8ff" stopOpacity="0.35" />
          </radialGradient>
        </defs>
        <ellipse cx="108" cy="74" rx="82" ry="72" fill={`url(#${u}-glass)`} stroke={OUTLINE} strokeWidth={SW} />
        <ellipse cx="108" cy="74" rx="78" ry="68" fill="none" stroke="#dff4ff" strokeWidth="3" opacity="0.8" />
        <path d="M44 56Q56 18 98 10" fill="none" stroke="#ffffff" strokeWidth="7" strokeLinecap="round" opacity="0.75" />
        <path d="M168 104Q164 120 150 130" fill="none" stroke="#ffffff" strokeWidth="4" strokeLinecap="round" opacity="0.6" />
        <rect x="56" y="124" width="104" height="18" rx="9" fill="#e8ecf7" {...S} />
        <rect x="70" y="129" width="14" height="8" rx="3" fill="#ff5d5d" stroke={OUTLINE} strokeWidth="1.4" />
        <rect x="132" y="129" width="14" height="8" rx="3" fill="#3d9df5" stroke={OUTLINE} strokeWidth="1.4" />
        <circle cx="108" cy="5" r="4.5" fill="#ff5d5d" {...S} strokeWidth="1.6" />
      </g>
    )
  },
  'head-knight': {
    box: [36, 0, 144, 130],
    withHead: true,
    render: ({ u }) => (
      <g>
        <defs>
          <Grad id={`${u}-steel`} a="#f4f7fd" b="#b9c3da" c="#76819f" x2="0.4" />
          <Grad id={`${u}-plume`} a="#ff8a8f" b="#e5484d" c="#a61b2b" />
        </defs>
        <path d="M110 22C104 -2 72 -6 54 10C70 6 84 14 90 26C80 18 66 20 60 28C80 24 92 30 100 34Z" fill={`url(#${u}-plume)`} {...S} />
        <path
          fillRule="evenodd"
          d="M96 18H120A54 54 0 0 1 174 72V96Q174 126 150 126H66Q42 126 42 96V72A54 54 0 0 1 96 18Z M86 50Q64 50 64 74V94Q64 114 86 114H130Q152 114 152 94V74Q152 50 130 50Z"
          fill={`url(#${u}-steel)`}
          {...S}
        />
        <path d="M102 18H114V50H102Z" fill="#d9a441" {...S} strokeWidth="1.8" />
        {[56, 160].map((x) => [66, 84, 102].map((y) => <circle key={`${x}${y}`} cx={x} cy={y} r="2.4" fill="#5d6685" />))}
        <path d="M58 44Q66 28 86 24" fill="none" stroke="#ffffff" strokeWidth="5" strokeLinecap="round" opacity="0.7" />
      </g>
    )
  },
  'head-wizard': {
    box: [44, -4, 128, 58],
    render: ({ u }) => (
      <g>
        <defs>
          <Grad id={`${u}-wiz`} a="#9b6bff" b="#6d3fd6" c="#3f1f96" x2="0.6" />
        </defs>
        <ellipse cx="108" cy="40" rx="62" ry="13" fill="#4b2aa8" {...S} />
        <path d="M70 38C80 14 100 -2 138 0C128 8 124 18 128 26C132 30 140 32 146 38Z" fill={`url(#${u}-wiz)`} {...S} />
        <path d="M72 30Q108 22 144 30L146 38Q108 30 70 38Z" fill="#ffc940" {...S} strokeWidth="1.8" />
        <path d={starPath(104, 18, 6, 0.45)} fill="#ffe066" />
        <path d={starPath(124, 12, 3.5, 0.45)} fill="#ffe066" />
        <circle cx="90" cy="24" r="1.8" fill="#ffffff" />
        <circle cx="138" cy="0" r="4" fill="#ffe066" {...S} strokeWidth="1.5" />
      </g>
    )
  },
  'head-laurel': {
    box: [40, 14, 136, 52],
    render: ({ u }) => {
      const leaves = [];
      for (let side of [-1, 1]) {
        for (let i = 0; i < 6; i++) {
          const t = i / 5;
          const x = 108 + side * (54 - 44 * t);
          const y = 58 - 26 * Math.sin(t * 1.2) - 4 * t;
          const ang = side * (-60 + 55 * t);
          leaves.push(
            <g key={`${side}${i}`} transform={`translate(${x} ${y}) rotate(${ang})`}>
              <ellipse cx={-6} cy={-4} rx="8" ry="4" transform="rotate(-35)" fill={`url(#${u}-gold)`} stroke={OUTLINE} strokeWidth="1.5" />
              <ellipse cx={6} cy={-4} rx="8" ry="4" transform="rotate(35)" fill={`url(#${u}-gold)`} stroke={OUTLINE} strokeWidth="1.5" />
            </g>
          );
        }
      }
      return (
        <g>
          <defs>
            <Grad id={`${u}-gold`} a={GOLD[0]} b={GOLD[1]} c={GOLD[2]} />
          </defs>
          <path d="M54 58Q70 34 104 30M162 58Q146 34 112 30" fill="none" stroke="#b7791f" strokeWidth="3" strokeLinecap="round" />
          {leaves}
          <circle cx="108" cy="30" r="5.5" fill="#35d46b" {...S} strokeWidth="1.6" />
        </g>
      );
    }
  },
  'head-beret': {
    box: [58, 4, 116, 46],
    render: ({ u }) => (
      <g>
        <defs>
          <Grad id={`${u}-beret`} a="#ff7d95" b="#e24462" c="#a31c3c" />
        </defs>
        <path d="M66 42C58 24 86 8 122 10C160 12 176 28 166 40C150 34 90 34 66 42Z" fill={`url(#${u}-beret)`} {...S} />
        <path d="M66 42Q116 30 166 40" fill="none" stroke="#7d1330" strokeWidth="4" strokeLinecap="round" />
        <path d="M120 10Q122 2 128 4" fill="none" stroke={OUTLINE} strokeWidth="4" strokeLinecap="round" />
        <circle cx="96" cy="24" r="4" fill="#ffd54a" />
        <circle cx="108" cy="18" r="3" fill="#3d9df5" />
        <circle cx="138" cy="22" r="3.5" fill="#35d46b" />
        <path d="M84 20Q94 14 106 13" fill="none" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" opacity="0.55" />
      </g>
    )
  },
  'head-crown': {
    box: [64, -6, 88, 52],
    render: ({ u }) => (
      <g>
        <defs>
          <Grad id={`${u}-gold`} a={GOLD[0]} b={GOLD[1]} c={GOLD[2]} />
        </defs>
        <path d="M74 42L70 8L90 24L108 0L126 24L146 8L142 42Z" fill={`url(#${u}-gold)`} {...S} />
        <rect x="72" y="32" width="72" height="12" rx="4" fill="#e3a82f" {...S} />
        {[[70, 8], [108, 0], [146, 8]].map(([x, y]) => (
          <circle key={x} cx={x} cy={y} r="4.5" fill="#fff1a8" {...S} strokeWidth="1.6" />
        ))}
        <path d="M108 16L115 25L108 34L101 25Z" fill="#e5484d" stroke={OUTLINE} strokeWidth="1.6" />
        <circle cx="86" cy="38" r="3.4" fill="#3d9df5" stroke={OUTLINE} strokeWidth="1.2" />
        <circle cx="130" cy="38" r="3.4" fill="#35d46b" stroke={OUTLINE} strokeWidth="1.2" />
        <path d="M80 30L82 16" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" opacity="0.6" />
      </g>
    )
  },
  'head-school': {
    box: [26, 12, 164, 120],
    withHead: true,
    render: ({ u, theme }) => {
      const pri = theme.primaryColor;
      return (
        <g>
          <defs>
            <Grad id={`${u}-shell`} a="#ffffff" b={shade(theme.secondaryColor, -0.03)} c={shade(theme.secondaryColor, -0.25)} x2="0.4" />
            <Grad id={`${u}-pri`} a={shade(pri, 0.25)} b={pri} c={shade(pri, -0.3)} />
          </defs>
          <path
            fillRule="evenodd"
            d="M98 20H118A54 54 0 0 1 172 74V92Q172 118 150 118H66Q44 118 44 92V74A54 54 0 0 1 98 20Z M86 50Q64 50 64 74V94Q64 114 86 114H130Q152 114 152 94V74Q152 50 130 50Z"
            fill={`url(#${u}-shell)`}
            {...S}
          />
          <path d="M84 21Q78 34 76 50H84Q86 34 92 20Z" fill={pri} />
          <path d="M132 21Q138 34 140 50H132Q130 34 124 20Z" fill={pri} />
          <CrestShape theme={theme} u={`${u}-hc`} x={95} y={20} w={26} />
          {[48, 168].map((x) => (
            <g key={x}>
              <circle cx={x} cy="84" r="20" fill={`url(#${u}-pri)`} {...S} />
              <circle cx={x} cy="84" r="10" fill={theme.secondaryColor} stroke={OUTLINE} strokeWidth="1.6" />
              <circle cx={x} cy="84" r="4" fill={pri} />
            </g>
          ))}
          <path d="M58 50Q64 34 84 26" fill="none" stroke="#ffffff" strokeWidth="5" strokeLinecap="round" opacity="0.8" />
        </g>
      );
    }
  }
};

// ======================= BACK =======================
function Cape({ u, main, lining, hem, emblem, icon }) {
  return (
    <g>
      <defs>
        <Grad id={`${u}-cape`} a={shade(main, 0.2)} b={main} c={shade(main, -0.35)} x2="0.3" />
      </defs>
      <path
        d="M72 124C52 160 34 200 26 240L46 232L60 244L78 234L96 246L112 236L128 246L146 236L162 244L176 232L188 238C182 196 170 158 146 124Z"
        fill={`url(#${u}-cape)`}
        {...S}
      />
      <path d="M72 124C60 144 50 166 42 190" fill="none" stroke={lining} strokeWidth="4" strokeLinecap="round" opacity="0.9" />
      <path d="M146 124C156 144 164 166 170 190" fill="none" stroke={lining} strokeWidth="4" strokeLinecap="round" opacity="0.9" />
      <path d="M30 236L46 230L60 240L78 232L96 242L112 234L128 242L146 234L162 240L176 230L186 234" fill="none" stroke={hem} strokeWidth="3.5" />
      {icon && emblem}
    </g>
  );
}

function Book({ x, y, rot = 0, color, open = false }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot})`}>
      {open ? (
        <g>
          <path d="M0 4Q-12 -2 -24 2V-16Q-12 -20 0 -14Z" fill="#fffaf0" {...S} strokeWidth="1.8" />
          <path d="M0 4Q12 -2 24 2V-16Q12 -20 0 -14Z" fill="#fffaf0" {...S} strokeWidth="1.8" />
          <path d="M0 6Q-13 0 -27 4V6Q-13 2 0 8Q13 2 27 6V4Q13 0 0 6Z" fill={color} {...S} strokeWidth="1.6" />
          <path d="M-19 -10H-6M-19 -5H-6M6 -10H19M6 -5H19" stroke="#b9b3d6" strokeWidth="1.5" />
        </g>
      ) : (
        <g>
          <rect x="-15" y="-11" width="30" height="22" rx="3" fill={color} {...S} strokeWidth="1.8" />
          <rect x="11" y="-9" width="4" height="18" fill="#fffaf0" stroke={OUTLINE} strokeWidth="1.2" />
          <rect x="-15" y="-11" width="7" height="22" rx="2" fill={shade(color, -0.3)} stroke={OUTLINE} strokeWidth="1.2" />
          <path d={starPath(3, 0, 5, 0.45)} fill="#ffe066" />
        </g>
      )}
    </g>
  );
}

function WingPath({ u, side }) {
  const m = side === 1 ? '' : 'translate(216 0) scale(-1 1)';
  return (
    <g transform={m}>
      <path
        d="M92 146C70 110 40 76 4 58C14 78 16 92 12 106C24 104 32 112 32 124C42 120 52 128 52 140C62 138 72 146 74 160Z"
        fill={`url(#${u}-wing)`}
        {...S}
      />
      <path d="M88 144L12 106M86 148L32 124M84 152L52 140" fill="none" stroke="#4b1a78" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M92 146C70 110 40 76 4 58" fill="none" stroke="#5b2296" strokeWidth="5" strokeLinecap="round" />
      <circle cx="4" cy="58" r="3.5" fill="#ffc940" stroke={OUTLINE} strokeWidth="1.2" />
    </g>
  );
}

export const BACK = {
  'back-explorer': {
    box: [36, 100, 144, 104],
    render: ({ u }) => (
      <g>
        <defs>
          <Grad id={`${u}-leather`} a="#c98450" b="#9a5b2e" c="#6b3a1a" x2="0.4" />
        </defs>
        <rect x="50" y="120" width="116" height="80" rx="20" fill={`url(#${u}-leather)`} {...S} />
        <rect x="38" y="148" width="18" height="38" rx="7" fill="#8a4f26" {...S} />
        <rect x="160" y="148" width="18" height="38" rx="7" fill="#8a4f26" {...S} />
        <rect x="74" y="160" width="68" height="32" rx="10" fill="#b8703c" {...S} />
        <path d="M60 124Q108 110 156 124L152 152Q108 162 64 152Z" fill="#c98450" {...S} />
        <rect x="102" y="146" width="12" height="14" rx="3" fill="#ffc940" {...S} strokeWidth="1.8" />
        <rect x="40" y="104" width="136" height="22" rx="11" fill="#3f8f5a" {...S} />
        <path d="M70 105V125M146 105V125" stroke="#6b3a1a" strokeWidth="5" />
        <path d="M52 110H70M80 110H134" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" opacity="0.4" />
      </g>
    ),
    front: () => (
      <g>
        <path d="M78 130L84 182" stroke={OUTLINE} strokeWidth="9" strokeLinecap="round" />
        <path d="M78 130L84 182" stroke="#9a5b2e" strokeWidth="5.5" strokeLinecap="round" />
        <path d="M138 130L132 182" stroke={OUTLINE} strokeWidth="9" strokeLinecap="round" />
        <path d="M138 130L132 182" stroke="#9a5b2e" strokeWidth="5.5" strokeLinecap="round" />
      </g>
    )
  },
  'back-jetpack': {
    box: [30, 100, 156, 130],
    render: ({ u }) => (
      <g>
        <defs>
          <Grad id={`${u}-tank`} a="#ffffff" b="#c9d2e6" c="#7a86a8" x2="1" y2="0" />
          <Grad id={`${u}-flame`} a="#fff6a8" b="#ffb020" c="#ff4d2e" />
        </defs>
        <rect x="56" y="124" width="104" height="22" rx="8" fill="#5d6685" {...S} />
        {[36, 156].map((x) => (
          <g key={x}>
            <g className="qqb-flicker" style={{ transformBox: 'fill-box', transformOrigin: '50% 0%' }}>
              <path d={`M${x + 4} 196Q${x + 12} 234 ${x + 12} 234Q${x + 20} 226 ${x + 20} 196Z`} fill={`url(#${u}-flame)`} {...S} strokeWidth="1.6" />
              <path d={`M${x + 8} 198Q${x + 12} 218 ${x + 12} 218Q${x + 16} 212 ${x + 16} 198Z`} fill="#fffbe0" />
            </g>
            <path d={`M${x + 2} 186H${x + 22}L${x + 20} 198H${x + 4}Z`} fill="#3b3766" {...S} strokeWidth="1.8" />
            <rect x={x} y="104" width="24" height="86" rx="12" fill={`url(#${u}-tank)`} {...S} />
            <rect x={x} y="118" width="24" height="10" fill="#e5484d" stroke={OUTLINE} strokeWidth="1.6" />
            <rect x={x} y="162" width="24" height="10" fill="#e5484d" stroke={OUTLINE} strokeWidth="1.6" />
            <rect x={x + 5} y="110" width="4" height="70" rx="2" fill="#ffffff" opacity="0.7" />
          </g>
        ))}
      </g>
    )
  },
  'back-reactor': {
    box: [36, 86, 144, 144],
    render: ({ u }) => (
      <g>
        <defs>
          <radialGradient id={`${u}-glow`} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0.55" stopColor="#7dff9a" stopOpacity="0" />
            <stop offset="0.8" stopColor="#7dff9a" stopOpacity="0.55" />
            <stop offset="1" stopColor="#7dff9a" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`${u}-core`} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.5" stopColor="#7dff9a" />
            <stop offset="1" stopColor="#139a4a" />
          </radialGradient>
        </defs>
        <circle cx="108" cy="158" r="72" fill={`url(#${u}-glow)`} className="qqb-pulse" />
        <circle cx="108" cy="158" r="58" fill="none" stroke={OUTLINE} strokeWidth="18" />
        <circle cx="108" cy="158" r="58" fill="none" stroke="#4a5275" strokeWidth="13" />
        <circle cx="108" cy="158" r="58" fill="none" stroke="#7dff9a" strokeWidth="5" strokeDasharray="16 14.4" className="qqb-spin-slow" style={{ transformBox: 'view-box', transformOrigin: '108px 158px' }} />
        <circle cx="108" cy="158" r="24" fill={`url(#${u}-core)`} {...S} />
        {[0, 90, 180, 270].map((a) => (
          <circle key={a} cx={108 + 58 * Math.cos((a * Math.PI) / 180 - 0.78)} cy={158 + 58 * Math.sin((a * Math.PI) / 180 - 0.78)} r="7" fill="#d4ffe0" {...S} strokeWidth="1.8" />
        ))}
      </g>
    )
  },
  'back-lightning': {
    box: [22, 118, 172, 132],
    render: ({ u }) => (
      <Cape
        u={u}
        main="#28337f"
        lining="#ffd23f"
        hem="#ffd23f"
        emblem={<path d="M112 142L94 176H108L100 206L126 166H112L120 142Z" fill="#ffd23f" {...S} strokeWidth="2" />}
      />
    ),
    icon: ({ u }) => (
      <Cape
        u={u}
        main="#28337f"
        lining="#ffd23f"
        hem="#ffd23f"
        icon
        emblem={<path d="M114 146L92 188H108L98 224L130 176H114L124 146Z" fill="#ffd23f" {...S} strokeWidth="2" />}
      />
    )
  },
  'back-books': {
    box: [0, 0, 224, 130],
    render: () => (
      <g>
        <g className="qqb-float" style={{ animationDelay: '0s' }}>
          <Book x={24} y={112} rot={-14} color="#e5484d" />
        </g>
        <g className="qqb-float" style={{ animationDelay: '-1.2s' }}>
          <Book x={206} y={60} rot={12} color="#3d9df5" />
        </g>
        <g className="qqb-float" style={{ animationDelay: '-2.1s' }}>
          <Book x={40} y={26} rot={-8} color="#12a58f" open />
        </g>
        <path d={twinklePath(186, 30, 5)} fill="#ffe066" />
        <path d={twinklePath(14, 80, 4)} fill="#ffe066" />
      </g>
    ),
    icon: () => (
      <g transform="translate(-58 -24) scale(1.9)">
        <Book x={40} y={38} rot={-12} color="#e5484d" />
        <Book x={64} y={52} rot={10} color="#3d9df5" />
        <Book x={52} y={22} rot={0} color="#12a58f" open />
        <path d={twinklePath(74, 26, 4)} fill="#ffe066" />
      </g>
    ),
    iconBox: [0, 0, 100, 100]
  },
  'back-dragon': {
    box: [0, 52, 184, 112],
    icon: ({ u }) => (
      <g>
        <defs>
          <Grad id={`${u}-wing`} a="#ff7ad9" b="#b44cf0" c="#5b2296" x2="0.5" />
        </defs>
        <WingPath u={u} side={1} />
        <g transform="translate(184 0) scale(-1 1)">
          <WingPath u={u} side={1} />
        </g>
        <circle cx="92" cy="150" r="9" fill="#ffc940" {...S} />
        <path d="M92 144L96 150L92 156L88 150Z" fill="#e5484d" />
      </g>
    ),
    render: ({ u }) => (
      <g>
        <defs>
          <Grad id={`${u}-wing`} a="#ff7ad9" b="#b44cf0" c="#5b2296" x2="0.5" />
        </defs>
        <g className="qqb-flap-l" style={{ transformBox: 'view-box', transformOrigin: '92px 146px' }}>
          <WingPath u={u} side={1} />
        </g>
        <g className="qqb-flap-r" style={{ transformBox: 'view-box', transformOrigin: '124px 146px' }}>
          <WingPath u={u} side={-1} />
        </g>
      </g>
    )
  },
  'back-banner': {
    box: [120, 0, 120, 200],
    render: ({ u }) => (
      <g>
        <defs>
          <Grad id={`${u}-flag`} a="#5b86ff" b="#2f5bd8" c="#1c3a9a" x2="1" y2="0.3" />
        </defs>
        <path d="M130 196L184 10" stroke={OUTLINE} strokeWidth="8" strokeLinecap="round" />
        <path d="M130 196L184 10" stroke="#9a5b2e" strokeWidth="4.5" strokeLinecap="round" />
        <path d="M180 12H236" stroke={OUTLINE} strokeWidth="7" strokeLinecap="round" />
        <path d="M180 12H236" stroke="#d9a441" strokeWidth="3.5" strokeLinecap="round" />
        <g className="qqb-sway" style={{ transformBox: 'view-box', transformOrigin: '208px 12px' }}>
          <path d="M184 14H232V92L208 78L184 92Z" fill={`url(#${u}-flag)`} {...S} />
          <path d="M188 18H228" stroke="#ffc940" strokeWidth="3" />
          <path d="M196 60V44H200V48H204V44H208V48H212V44H216V48H220V44H220V60Z" fill="#ffc940" stroke={OUTLINE} strokeWidth="1.4" />
          <path d="M205 60V54A3 3 0 0 1 211 54V60Z" fill="#1c3a9a" />
        </g>
        <circle cx="184" cy="9" r="5" fill="#ffc940" {...S} strokeWidth="1.6" />
      </g>
    ),
    iconBox: [0, 0, 100, 100],
    icon: ({ u }) => (
      <g>
        <defs>
          <Grad id={`${u}-flag`} a="#5b86ff" b="#2f5bd8" c="#1c3a9a" x2="1" y2="0.3" />
        </defs>
        <path d="M24 12V96" stroke={OUTLINE} strokeWidth="8" strokeLinecap="round" />
        <path d="M24 12V96" stroke="#9a5b2e" strokeWidth="4.5" strokeLinecap="round" />
        <path d="M22 14H86" stroke={OUTLINE} strokeWidth="7" strokeLinecap="round" />
        <path d="M22 14H86" stroke="#d9a441" strokeWidth="3.5" strokeLinecap="round" />
        <path d="M30 16H80V84L55 70L30 84Z" fill={`url(#${u}-flag)`} {...S} />
        <path d="M34 22H76" stroke="#ffc940" strokeWidth="3" />
        <path d="M40 60V38H45V43H50V38H55V43H60V38H65V43H70V38V60Z" fill="#ffc940" stroke={OUTLINE} strokeWidth="1.6" />
        <path d="M52 60V53A3 3 0 0 1 58 53V60Z" fill="#1c3a9a" />
        <circle cx="24" cy="10" r="6" fill="#ffc940" {...S} strokeWidth="1.8" />
      </g>
    )
  },
  'back-school': {
    box: [22, 118, 172, 132],
    render: ({ u, theme }) => (
      <Cape u={u} main={theme.primaryColor} lining={theme.secondaryColor} hem={theme.secondaryColor} emblem={<CrestShape theme={theme} u={`${u}-ce`} x={116} y={150} w={24} />} />
    ),
    icon: ({ u, theme }) => (
      <Cape u={u} main={theme.primaryColor} lining={theme.secondaryColor} hem={theme.secondaryColor} icon emblem={<CrestShape theme={theme} u={`${u}-ce`} x={86} y={150} w={44} />} />
    )
  }
};

// ======================= HELD (grip at 0,0) =======================
const HELD_BOX = [-34, -36, 68, 60];
export const HELD = {};
['buzzer-classic', 'buzzer-dna', 'buzzer-galaxy', 'buzzer-crystal', 'buzzer-scroll', 'buzzer-note', 'buzzer-champion', 'buzzer-school'].forEach((id) => {
  HELD[id] = { box: HELD_BOX, render: ({ u, theme }) => <HeldBuzzer u={u} s={buzzerSkin(id, theme)} theme={theme} /> };
});
HELD['shield-school'] = {
  box: [-26, -40, 52, 58],
  render: ({ u, theme }) => <CrestShape theme={theme} u={`${u}-sh`} x={-20} y={-36} w={40} />
};

// ======================= COMPANIONS (centre 0,0, ~ +/-24) =======================
const Eyes = ({ x = 6, y = 0, r = 3.2 }) => (
  <g>
    {[-x, x].map((dx) => (
      <g key={dx}>
        <circle cx={dx} cy={y} r={r} fill={OUTLINE} />
        <circle cx={dx - r * 0.35} cy={y - r * 0.4} r={r * 0.38} fill="#ffffff" />
      </g>
    ))}
  </g>
);
const S2 = { ...S, strokeWidth: 2 };

export const COMPANION = {
  'pet-robot': {
    render: ({ u }) => (
      <g>
        <defs>
          <Grad id={`${u}-pr`} a="#ffffff" b="#dfe5f5" c="#9aa6c6" />
        </defs>
        <ellipse cx="0" cy="22" rx="8" ry="3" fill="#5ef2ff" opacity="0.5" />
        <path d="M-5 12L-3 20H3L5 12Z" fill="#5d6685" {...S2} />
        <rect x="-10" y="2" width="20" height="13" rx="5" fill={`url(#${u}-pr)`} {...S2} />
        <circle cx="0" cy="8.5" r="2.6" fill="#ffc940" />
        <rect x="-16" y="-20" width="32" height="24" rx="10" fill={`url(#${u}-pr)`} {...S2} />
        <rect x="-11" y="-15" width="22" height="14" rx="6" fill="#161a44" />
        <ellipse cx="-5" cy="-8.5" rx="2.4" ry="3.2" fill="#5ef2ff" />
        <ellipse cx="5" cy="-8.5" rx="2.4" ry="3.2" fill="#5ef2ff" />
        <path d="M0 -20V-26" stroke={OUTLINE} strokeWidth="2" />
        <circle cx="0" cy="-27" r="3" fill="#e5484d" {...S2} strokeWidth="1.5" />
        <circle cx="-17" cy="-8" r="3.5" fill="#3d9df5" {...S2} strokeWidth="1.5" />
        <circle cx="17" cy="-8" r="3.5" fill="#3d9df5" {...S2} strokeWidth="1.5" />
      </g>
    )
  },
  'pet-questy': {
    render: ({ u }) => (
      <g>
        <defs>
          <Grad id={`${u}-owl`} a="#3fd6c4" b="#14a39a" c="#0b6f72" />
        </defs>
        <path d="M-20 4Q-26 14 -16 18Z M20 4Q26 14 16 18Z" fill="#0f8580" {...S2} />
        <ellipse cx="0" cy="4" rx="19" ry="20" fill={`url(#${u}-owl)`} {...S2} />
        <path d="M-14 -12L-18 -24L-6 -16Z M14 -12L18 -24L6 -16Z" fill="#14a39a" {...S2} />
        <ellipse cx="0" cy="12" rx="10" ry="9" fill="#ffe7b0" />
        <circle cx="-7" cy="-3" r="7.5" fill="#fff6dc" {...S2} strokeWidth="1.5" />
        <circle cx="7" cy="-3" r="7.5" fill="#fff6dc" {...S2} strokeWidth="1.5" />
        <Eyes x={7} y={-3} r={4} />
        <path d="M-3 3L3 3L0 8Z" fill="#ff9a2e" stroke={OUTLINE} strokeWidth="1.2" strokeLinejoin="round" />
        <path d="M-15 -13Q0 -19 15 -13" fill="none" stroke="#7a4a24" strokeWidth="3" />
        <circle cx="-6" cy="-15" r="3.6" fill="#a855f7" stroke="#d9a441" strokeWidth="1.6" />
        <circle cx="6" cy="-15" r="3.6" fill="#a855f7" stroke="#d9a441" strokeWidth="1.6" />
        <path d="M-6 23V26M6 23V26" stroke="#ff9a2e" strokeWidth="3" strokeLinecap="round" />
      </g>
    )
  },
  'pet-planet': {
    render: ({ u }) => (
      <g>
        <defs>
          <radialGradient id={`${u}-pl`} cx="0.35" cy="0.3" r="0.8">
            <stop offset="0" stopColor="#9fe6ff" />
            <stop offset="0.6" stopColor="#2f86e8" />
            <stop offset="1" stopColor="#1c3a9a" />
          </radialGradient>
        </defs>
        <path d="M-26 6A26 8 0 0 1 26 -6" fill="none" stroke={OUTLINE} strokeWidth="6" transform="rotate(-14)" />
        <path d="M-26 6A26 8 0 0 1 26 -6" fill="none" stroke="#ffc940" strokeWidth="3" transform="rotate(-14)" />
        <circle cx="0" cy="0" r="17" fill={`url(#${u}-pl)`} {...S2} />
        <path d="M-12 -8Q-6 -12 -2 -7Q-6 -3 -12 -4Z M4 8Q10 4 13 9Q9 13 4 12Z" fill="#35d46b" />
        <Eyes x={6} y={-1} r={2.8} />
        <path d="M-3 5Q0 8 3 5" fill="none" stroke={OUTLINE} strokeWidth="1.8" strokeLinecap="round" />
        <path d="M-26 6A26 8 0 0 0 26 -6" fill="none" stroke={OUTLINE} strokeWidth="6" transform="rotate(-14)" />
        <path d="M-26 6A26 8 0 0 0 26 -6" fill="none" stroke="#ffc940" strokeWidth="3" transform="rotate(-14)" />
        <path d={twinklePath(20, -18, 4)} fill="#ffe066" />
      </g>
    )
  },
  'pet-fox': {
    render: ({ u }) => (
      <g>
        <defs>
          <Grad id={`${u}-fox`} a="#ffb05c" b="#f07a1f" c="#b8520e" />
        </defs>
        <path d="M8 18Q30 16 26 -2Q22 10 10 10Z" fill={`url(#${u}-fox)`} {...S2} />
        <path d="M24 2Q27 -1 26 -2Q22 4 20 6Z" fill="#ffffff" />
        <ellipse cx="0" cy="14" rx="11" ry="10" fill={`url(#${u}-fox)`} {...S2} />
        <ellipse cx="0" cy="16" rx="6" ry="6" fill="#fff3e0" />
        <path d="M-16 -8L-14 -26L-4 -14Z M16 -8L14 -26L4 -14Z" fill="#f07a1f" {...S2} />
        <path d="M-13 -12L-13 -21L-7 -14Z M13 -12L13 -21L7 -14Z" fill="#3b2a3a" />
        <path d="M-17 -6Q-16 -18 0 -18Q16 -18 17 -6Q14 8 0 8Q-14 8 -17 -6Z" fill={`url(#${u}-fox)`} {...S2} />
        <path d="M-14 -2Q-8 8 0 8Q8 8 14 -2Q8 0 0 -4Q-8 0 -14 -2Z" fill="#fff3e0" />
        <Eyes x={6.5} y={-6} r={2.8} />
        <ellipse cx="0" cy="1" rx="2.4" ry="1.8" fill={OUTLINE} />
      </g>
    )
  },
  'pet-atom': {
    render: () => (
      <g>
        {[0, 60, -60].map((a) => (
          <g key={a} transform={`rotate(${a})`}>
            <ellipse cx="0" cy="0" rx="24" ry="9" fill="none" stroke={OUTLINE} strokeWidth="4.2" />
            <ellipse cx="0" cy="0" rx="24" ry="9" fill="none" stroke="#5ef2ff" strokeWidth="2.2" />
            <circle cx="24" cy="0" r="3.2" fill="#ffe066" stroke={OUTLINE} strokeWidth="1.3" />
          </g>
        ))}
        <circle cx="0" cy="0" r="11" fill="#ff6fb5" {...S2} />
        <circle cx="-4" cy="-4" r="3" fill="#ffc0df" />
        <Eyes x={4} y={-1} r={2.2} />
        <path d="M-2.5 4Q0 6 2.5 4" fill="none" stroke={OUTLINE} strokeWidth="1.5" strokeLinecap="round" />
      </g>
    )
  },
  'pet-compass': {
    render: ({ u }) => (
      <g>
        <defs>
          <Grad id={`${u}-brass`} a="#ffe39a" b="#d9a441" c="#8a5a1c" />
        </defs>
        <path d="M-8 16L-10 24H-4M8 16L10 24H4" fill="none" stroke={OUTLINE} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="0" cy="0" r="18" fill={`url(#${u}-brass)`} {...S2} />
        <circle cx="0" cy="-19" r="3.5" fill="#d9a441" {...S2} strokeWidth="1.5" />
        <circle cx="0" cy="0" r="13" fill="#fffaf0" stroke={OUTLINE} strokeWidth="1.5" />
        <path d="M0 -11L3 0H-3Z" fill="#e5484d" />
        <path d="M0 11L3 0H-3Z" fill="#3d9df5" />
        <circle cx="0" cy="0" r="1.8" fill={OUTLINE} />
        <Eyes x={6} y={-3} r={2.2} />
        <text x="0" y="-5" fontSize="4" textAnchor="middle" fill={OUTLINE} fontWeight="800" fontFamily="system-ui, sans-serif">N</text>
      </g>
    )
  },
  'pet-dragon': {
    render: ({ u }) => (
      <g>
        <defs>
          <Grad id={`${u}-dr`} a="#b98bff" b="#8250e8" c="#5129a8" />
        </defs>
        <path d="M10 16Q28 18 26 4L30 0L24 0Q20 10 8 10Z" fill="#8250e8" {...S2} />
        <path d="M-8 -2Q-24 -14 -22 4Q-16 0 -10 6Z M8 -2Q24 -14 22 4Q16 0 10 6Z" fill="#ff7ad9" {...S2} />
        <ellipse cx="0" cy="12" rx="12" ry="11" fill={`url(#${u}-dr)`} {...S2} />
        <ellipse cx="0" cy="15" rx="6.5" ry="7" fill="#ffe7b0" />
        <path d="M-9 -14L-12 -24L-4 -17Z M9 -14L12 -24L4 -17Z" fill="#ffe7b0" {...S2} strokeWidth="1.5" />
        <ellipse cx="0" cy="-6" rx="15" ry="12" fill={`url(#${u}-dr)`} {...S2} />
        <Eyes x={6} y={-7} r={3.4} />
        <ellipse cx="0" cy="0" rx="5" ry="3" fill="#b98bff" />
        <circle cx="-2" cy="-0.5" r="0.9" fill={OUTLINE} />
        <circle cx="2" cy="-0.5" r="0.9" fill={OUTLINE} />
      </g>
    )
  },
  'pet-phoenix': {
    render: ({ u }) => (
      <g>
        <defs>
          <Grad id={`${u}-ph`} a="#fff3a0" b="#ff9a2e" c="#e0321f" />
        </defs>
        <path d="M-2 12Q-12 30 -2 30Q0 22 4 30Q14 30 6 12Z" fill="#ff6a2e" {...S2} />
        <path d="M-8 0Q-30 -18 -26 8Q-22 2 -16 10Q-14 4 -8 8Z" fill={`url(#${u}-ph)`} {...S2} />
        <path d="M8 0Q30 -18 26 8Q22 2 16 10Q14 4 8 8Z" fill={`url(#${u}-ph)`} {...S2} />
        <ellipse cx="0" cy="4" rx="11" ry="12" fill={`url(#${u}-ph)`} {...S2} />
        <path d="M-3 -10Q-6 -22 0 -26Q0 -18 3 -22Q6 -16 3 -10Z" fill="#ffcf40" {...S2} strokeWidth="1.5" />
        <Eyes x={4.5} y={0} r={2.4} />
        <path d="M-2 4L2 4L0 8Z" fill="#ffcf40" stroke={OUTLINE} strokeWidth="1" />
      </g>
    )
  }
};

// ======================= EFFECTS =======================
const SPARK_PTS = [[26, 60, 7], [196, 38, 8], [214, 118, 6], [30, 176, 6], [168, 22, 5], [12, 120, 5], [220, 190, 5]];
const HEART_PTS = [[24, 150, 7], [206, 100, 8], [36, 74, 6], [196, 40, 6], [12, 206, 5]];

function Bolt({ x, y, s = 1, delay = 0 }) {
  return (
    <g className="qqb-flash" style={{ animationDelay: `${delay}s` }}>
      <path transform={`translate(${x} ${y}) scale(${s})`} d="M6 0L-6 22H3L-3 42L14 14H4L12 0Z" fill="#ffe14a" stroke={OUTLINE} strokeWidth={SW / s} strokeLinejoin="round" />
    </g>
  );
}
function Drop({ x, y, r = 6, rot = 0, color = '#3b2aa8' }) {
  return (
    <path
      transform={`translate(${x} ${y}) rotate(${rot})`}
      d={`M0 ${-r * 1.7}C${r * 0.6} ${-r * 0.6} ${r} ${-r * 0.2} ${r} ${r * 0.3}A${r} ${r} 0 0 1 ${-r} ${r * 0.3}C${-r} ${-r * 0.2} ${-r * 0.6} ${-r * 0.6} 0 ${-r * 1.7}Z`}
      fill={color}
      stroke={OUTLINE}
      strokeWidth="1.6"
    />
  );
}
function Flame({ x, y, s = 1, u, delay = 0 }) {
  return (
    <g className="qqb-flicker" style={{ animationDelay: `${delay}s`, transformBox: 'fill-box', transformOrigin: '50% 100%' }}>
      <g transform={`translate(${x} ${y}) scale(${s})`}>
        <path d="M0 0C-12 0 -14 -12 -8 -22C-6 -14 -2 -14 -2 -18C-2 -26 4 -32 6 -38C8 -28 16 -22 14 -10C13 -3 8 0 0 0Z" fill={`url(#${u}-fire)`} stroke={OUTLINE} strokeWidth={SW / s} strokeLinejoin="round" />
        <path d="M1 -2C-5 -2 -6 -8 -2 -14C0 -10 3 -12 4 -16C7 -10 8 -3 1 -2Z" fill="#fff6c0" />
      </g>
    </g>
  );
}
const CONST_PTS = [[30, 96], [52, 30], [104, 6], [164, 16], [208, 58], [222, 130], [16, 170]];

export const EFFECT = {
  'fx-sparkles': {
    front: () => (
      <g>
        {SPARK_PTS.map(([x, y, r], i) => (
          <g key={i} className="qqb-twinkle" style={{ animationDelay: `${-i * 0.37}s` }}>
            <path d={twinklePath(x, y, r)} fill={i % 2 ? '#ffffff' : '#ffe066'} stroke="#f5b400" strokeWidth="1" />
          </g>
        ))}
      </g>
    ),
    icon: () => (
      <g>
        <path d={twinklePath(46, 50, 30)} fill="#ffe066" stroke={OUTLINE} strokeWidth="2.4" />
        <path d={twinklePath(78, 22, 13)} fill="#ffffff" stroke={OUTLINE} strokeWidth="2" />
        <path d={twinklePath(80, 78, 10)} fill="#ffe066" stroke={OUTLINE} strokeWidth="2" />
        <path d={twinklePath(40, 44, 8)} fill="#ffffff" opacity="0.8" />
      </g>
    )
  },
  'fx-hearts': {
    front: () => (
      <g>
        {HEART_PTS.map(([x, y, s], i) => (
          <g key={i} className="qqb-rise" style={{ animationDelay: `${-i * 0.7}s` }}>
            <path d={heartPath(x, y, s)} fill={i % 2 ? '#ff8fc0' : '#ff4d8d'} stroke={OUTLINE} strokeWidth="1.6" />
          </g>
        ))}
      </g>
    ),
    icon: () => (
      <g>
        <path d={heartPath(42, 56, 24)} fill="#ff4d8d" stroke={OUTLINE} strokeWidth="2.6" />
        <path d={heartPath(78, 26, 12)} fill="#ff8fc0" stroke={OUTLINE} strokeWidth="2" />
        <path d={heartPath(80, 76, 8)} fill="#ff8fc0" stroke={OUTLINE} strokeWidth="1.8" />
        <ellipse cx="30" cy="44" rx="6" ry="4" fill="#ffffff" opacity="0.6" transform="rotate(-30 30 44)" />
      </g>
    )
  },
  'fx-lightning': {
    front: () => (
      <g>
        <Bolt x={14} y={56} s={1} delay={0} />
        <Bolt x={206} y={26} s={0.9} delay={-0.6} />
        <Bolt x={18} y={160} s={0.75} delay={-1.1} />
      </g>
    ),
    icon: () => (
      <g>
        <circle cx="50" cy="50" r="40" fill="#ffe14a" opacity="0.18" />
        <path d="M58 6L26 56H48L36 96L78 40H56L70 6Z" fill="#ffe14a" stroke={OUTLINE} strokeWidth="3" strokeLinejoin="round" />
        <path d="M58 12L50 26" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" opacity="0.7" />
      </g>
    )
  },
  'fx-ink': {
    back: () => (
      <g className="qqb-spin-slow" style={{ transformBox: 'view-box', transformOrigin: '108px 130px' }}>
        <path d="M24 130C24 60 100 30 160 50" fill="none" stroke="#6d4df2" strokeWidth="6" strokeLinecap="round" opacity="0.35" />
        <path d="M196 130C196 200 120 236 60 214" fill="none" stroke="#8b5cf6" strokeWidth="6" strokeLinecap="round" opacity="0.45" />
      </g>
    ),
    front: () => (
      <g>
        {[[22, 70, 6, -30, '#5b3fe0'], [200, 44, 5, 20, '#8b5cf6'], [216, 150, 6, 40, '#5b3fe0'], [26, 190, 5, -50, '#8b5cf6'], [178, 16, 4, 10, '#b18cff']].map(([x, y, r, rot, c], i) => (
          <g key={i} className="qqb-float" style={{ animationDelay: `${-i * 0.6}s` }}>
            <Drop x={x} y={y} r={r} rot={rot} color={c} />
          </g>
        ))}
      </g>
    ),
    icon: () => (
      <g>
        <path d="M14 60C14 26 50 10 80 22" fill="none" stroke="#6d4df2" strokeWidth="7" strokeLinecap="round" opacity="0.5" />
        <path d="M86 44C86 76 56 92 28 84" fill="none" stroke="#8b5cf6" strokeWidth="7" strokeLinecap="round" opacity="0.6" />
        <Drop x={50} y={56} r={16} color="#5b3fe0" />
        <ellipse cx="44" cy="54" rx="4" ry="6" fill="#ffffff" opacity="0.5" />
        <Drop x={80} y={24} r={7} rot={30} color="#8b5cf6" />
        <Drop x={20} y={84} r={6} rot={-30} color="#6d4df2" />
      </g>
    )
  },
  'fx-constellation': {
    back: () => (
      <g>
        <polyline points={CONST_PTS.map((p) => p.join(',')).join(' ')} fill="none" stroke="#9fb4ff" strokeWidth="1.6" strokeDasharray="4 4" opacity="0.85" />
        {CONST_PTS.map(([x, y], i) => (
          <g key={i} className="qqb-twinkle" style={{ animationDelay: `${-i * 0.45}s` }}>
            <circle cx={x} cy={y} r="7" fill="#9fdcff" opacity="0.3" />
            <path d={starPath(x, y, i % 3 === 0 ? 6 : 4.5, 0.45)} fill="#ffffff" stroke="#6d8cff" strokeWidth="1" />
          </g>
        ))}
      </g>
    ),
    icon: () => {
      const pts = [[14, 70], [32, 34], [58, 50], [80, 18], [88, 70]];
      return (
        <g>
          <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke="#6d8cff" strokeWidth="2.4" strokeDasharray="5 4" />
          {pts.map(([x, y], i) => (
            <g key={i}>
              <circle cx={x} cy={y} r="11" fill="#9fdcff" opacity="0.35" />
              <path d={starPath(x, y, i === 2 ? 11 : 8, 0.45)} fill="#ffffff" stroke={OUTLINE} strokeWidth="1.8" strokeLinejoin="round" />
            </g>
          ))}
        </g>
      );
    }
  },
  'fx-fire': {
    back: ({ u }) => (
      <g>
        <defs>
          <Grad id={`${u}-fire`} a="#fff3a0" b="#ff9a2e" c="#e0321f" />
        </defs>
        <Flame u={u} x={70} y={246} s={1.3} delay={0} />
        <Flame u={u} x={108} y={250} s={1.6} delay={-0.3} />
        <Flame u={u} x={148} y={246} s={1.3} delay={-0.55} />
      </g>
    ),
    front: ({ u }) => (
      <g>
        <Flame u={u} x={62} y={252} s={0.8} delay={-0.2} />
        <Flame u={u} x={156} y={252} s={0.8} delay={-0.45} />
      </g>
    ),
    icon: ({ u }) => (
      <g>
        <defs>
          <Grad id={`${u}-fire`} a="#fff3a0" b="#ff9a2e" c="#e0321f" />
        </defs>
        <Flame u={u} x={30} y={90} s={1.1} />
        <Flame u={u} x={72} y={90} s={1.1} />
        <Flame u={u} x={50} y={94} s={2} />
      </g>
    )
  },
  'fx-rainbow': {
    back: ({ u }) => (
      <g>
        <defs>
          <linearGradient id={`${u}-rb`} x1="0" y1="0" x2="1" y2="1">
            {['#ff4d4d', '#ffa62e', '#ffe14a', '#35d46b', '#3d9df5', '#a855f7', '#ff4d8d'].map((c, i) => (
              <stop key={c} offset={i / 6} stopColor={c} />
            ))}
          </linearGradient>
          <radialGradient id={`${u}-rbg`} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0.7" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="0.9" stopColor="#ffe6ff" stopOpacity="0.5" />
            <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
        </defs>
        <ellipse cx="108" cy="134" rx="112" ry="124" fill={`url(#${u}-rbg)`} />
        <g className="qqb-spin-slow" style={{ transformBox: 'view-box', transformOrigin: '108px 134px' }}>
          <circle cx="108" cy="134" r="104" fill="none" stroke={`url(#${u}-rb)`} strokeWidth="9" opacity="0.85" />
          <circle cx="108" cy="134" r="104" fill="none" stroke="#ffffff" strokeWidth="2" strokeDasharray="10 40" opacity="0.8" />
        </g>
      </g>
    ),
    icon: ({ u }) => (
      <g>
        <defs>
          <linearGradient id={`${u}-rb`} x1="0" y1="0" x2="1" y2="1">
            {['#ff4d4d', '#ffa62e', '#ffe14a', '#35d46b', '#3d9df5', '#a855f7', '#ff4d8d'].map((c, i) => (
              <stop key={c} offset={i / 6} stopColor={c} />
            ))}
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r="36" fill="none" stroke={OUTLINE} strokeWidth="16" />
        <circle cx="50" cy="50" r="36" fill="none" stroke={`url(#${u}-rb)`} strokeWidth="11" />
        <circle cx="50" cy="50" r="36" fill="none" stroke="#ffffff" strokeWidth="2" strokeDasharray="8 30" opacity="0.8" />
        <path d={twinklePath(50, 50, 12)} fill="#ffe066" stroke={OUTLINE} strokeWidth="1.8" />
      </g>
    )
  }
};
