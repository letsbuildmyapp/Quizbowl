import { OUTLINE, useUid, shade, cls, resolveTheme, prefersReducedMotion } from './util.js';
import { CrestShape } from './Crest.jsx';
import './bot.css';

const RAR = {
  common: { body: '#3cb46a', metal: '#c3cadf', gem: '#35e07a' },
  rare: { body: '#3b82f6', metal: '#c3cadf', gem: '#6fc3ff' },
  epic: { body: '#9b4dea', metal: '#f5c04a', gem: '#e08bff' },
  legendary: { body: '#d7263d', metal: '#f5c04a', gem: '#ff5a5a', heavy: true },
  mythic: { body: '#ffc93a', metal: '#fff1a8', gem: '#ff6fb5', heavy: true, rainbow: true }
};
const RAINBOW = ['#ff4d4d', '#ffa62e', '#ffe14a', '#35d46b', '#3d9df5', '#a855f7'];

function Crystal({ x, y, s = 1, color, flip = false }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${flip ? -s : s} ${s})`}>
      <path d="M0 0L-4 -18L2 -26L6 -16L4 0Z" fill={shade(color, 0.2)} stroke={OUTLINE} strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M4 0L8 -12L14 -14L14 0Z" fill={shade(color, -0.1)} stroke={OUTLINE} strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M-4 0L-12 -10L-8 0Z" fill={color} stroke={OUTLINE} strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M0 -4L-2 -16L1 -20" fill="none" stroke="#ffffff" strokeWidth="1.2" opacity="0.7" />
    </g>
  );
}

export default function ChestArt({ rarity = 'common', state = 'closed', theme, size = 120, school = false, reducedMotion = false, title, className }) {
  const u = useUid('ch');
  const t = resolveTheme(theme);
  const c = RAR[rarity] || RAR.common;
  const rm = reducedMotion || prefersReducedMotion();
  const st = rm && state === 'opening' ? 'open' : state;
  const isOpen = st === 'open' || st === 'opening';
  const body = school ? t.primaryColor : c.body;
  const bandW = c.heavy ? 12 : 9;
  const label = title || `${school ? `${t.mascotName} ` : ''}${rarity} chest, ${st}`;

  const lidClosed = (
    <g className={st === 'opening' ? 'qqb-lid-closed' : undefined}>
      <path d="M31 78V62Q31 43 80 43Q129 43 129 62V78Z" fill={`url(#${u}-wood)`} stroke={OUTLINE} strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M40 52Q80 44 120 52" fill="none" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" opacity="0.4" />
      {[46, 114].map((x) => (
        <path key={x} d={`M${x - bandW / 2} 78V50Q${x} 46 ${x + bandW / 2} 50V78Z`} fill={`url(#${u}-metal)`} stroke={OUTLINE} strokeWidth="1.8" />
      ))}
      <rect x="29" y="72" width="102" height="8" rx="3" fill={`url(#${u}-metal)`} stroke={OUTLINE} strokeWidth="1.8" />
      {c.rainbow &&
        RAINBOW.map((col, i) => <circle key={col} cx={58 + i * 9} cy="60" r="3.2" fill={col} stroke={OUTLINE} strokeWidth="1.1" />)}
      {!c.rainbow && c.heavy && <path d="M80 50L86 58L80 66L74 58Z" fill={c.gem} stroke={OUTLINE} strokeWidth="1.5" />}
    </g>
  );

  const lidOpen = (
    <g className={st === 'opening' ? 'qqb-lid-open' : undefined}>
      <path d="M31 76L38 30Q80 22 122 30L129 76Z" fill={shade(body, -0.45)} stroke={OUTLINE} strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M38 30Q80 22 122 30L123 38Q80 30 37 38Z" fill={`url(#${u}-metal)`} stroke={OUTLINE} strokeWidth="1.8" />
      <path d="M44 70L48 40M116 70L112 40" stroke={shade(body, -0.6)} strokeWidth="3" />
    </g>
  );

  return (
    <svg
      viewBox="0 0 160 160"
      width={size}
      height={size}
      role="img"
      aria-label={label}
      className={cls('qqb-anim', `qqb-chest-${st}`, rm && 'qqb-rm', className)}
      style={{ overflow: 'visible', display: 'inline-block' }}
    >
      <defs>
        <linearGradient id={`${u}-wood`} x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0" stopColor={shade(body, 0.3)} />
          <stop offset="0.5" stopColor={body} />
          <stop offset="1" stopColor={shade(body, -0.35)} />
        </linearGradient>
        <linearGradient id={`${u}-metal`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={shade(c.metal, 0.5)} />
          <stop offset="0.5" stopColor={c.metal} />
          <stop offset="1" stopColor={shade(c.metal, -0.35)} />
        </linearGradient>
        <linearGradient id={`${u}-stone`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#b9b6cf" />
          <stop offset="1" stopColor="#6e6a8e" />
        </linearGradient>
        <radialGradient id={`${u}-glow`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor={c.gem} stopOpacity="0.75" />
          <stop offset="1" stopColor={c.gem} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${u}-ray`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#ffc21a" stopOpacity="1" />
          <stop offset="0.55" stopColor="#ffd84a" stopOpacity="0.75" />
          <stop offset="1" stopColor="#fff6c0" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${u}-rbw`} x1="0" y1="0" x2="1" y2="1">
          {RAINBOW.map((col, i) => <stop key={col} offset={i / 5} stopColor={col} />)}
        </linearGradient>
      </defs>

      {st === 'ready' && <ellipse className="qqb-chest-glow" cx="80" cy="90" rx="74" ry="62" fill={`url(#${u}-glow)`} />}

      {/* pedestal */}
      <path d="M22 128V140Q22 152 80 152Q138 152 138 140V128Z" fill={`url(#${u}-stone)`} stroke={OUTLINE} strokeWidth="2.4" strokeLinejoin="round" />
      <ellipse cx="80" cy="128" rx="58" ry="12" fill="#d3d0e6" stroke={OUTLINE} strokeWidth="2.4" />
      <path d="M50 138V150M110 138V150" stroke="#5a5679" strokeWidth="1.5" />
      <path d="M80 133L88 142L80 151L72 142Z" fill={c.gem} stroke={OUTLINE} strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M80 136L84 141L80 142Z" fill="#ffffff" opacity="0.7" />
      <Crystal x={22} y={134} s={1.3} color={c.gem} />
      <Crystal x={138} y={134} s={1.3} color={c.gem} flip />

      <g className="qqb-chest-bounce">
        {isOpen && lidOpen}
        {isOpen && (
          <g className={st === 'opening' ? 'qqb-rays' : undefined}>
            <path d="M80 76L30 0H56ZM80 76L66 -6H94ZM80 76L104 0H130Z" fill={`url(#${u}-ray)`} />
            <path d="M80 76L8 20L22 8ZM80 76L138 8L152 20Z" fill={`url(#${u}-ray)`} opacity="0.7" />
            {[[28, 30, 5], [132, 26, 6], [112, 6, 4], [46, 8, 4]].map(([x, y, r]) => (
              <path key={x} d={`M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}Z`} fill="#ffe066" stroke="#c7851c" strokeWidth="0.8" />
            ))}
          </g>
        )}

        {/* body */}
        <path d="M33 76H127V118Q127 126 119 126H41Q33 126 33 118Z" fill={`url(#${u}-wood)`} stroke={OUTLINE} strokeWidth="2.4" strokeLinejoin="round" />
        <path d="M34 92H126M34 108H126" stroke={shade(body, -0.4)} strokeWidth="1.6" opacity="0.7" />
        {isOpen && (
          <g>
            <ellipse cx="80" cy="77" rx="46" ry="6" fill="#fff3a0" stroke={OUTLINE} strokeWidth="1.8" />
            <circle cx="62" cy="75" r="4" fill="#ffc940" stroke={OUTLINE} strokeWidth="1.2" />
            <circle cx="96" cy="74" r="4.5" fill="#ffc940" stroke={OUTLINE} strokeWidth="1.2" />
            <path d="M76 76L80 68L84 76Z" fill={c.gem} stroke={OUTLINE} strokeWidth="1.2" />
          </g>
        )}
        {[46, 114].map((x) => (
          <rect key={x} x={x - bandW / 2} y="76" width={bandW} height="50" fill={`url(#${u}-metal)`} stroke={OUTLINE} strokeWidth="1.8" />
        ))}
        {c.heavy && (
          <g>
            <rect x="31" y="112" width="98" height="8" fill={`url(#${u}-metal)`} stroke={OUTLINE} strokeWidth="1.8" />
            {[38, 122].map((x) => [84, 102].map((y) => <circle key={`${x}${y}`} cx={x} cy={y} r="2.2" fill={shade(c.metal, -0.3)} stroke={OUTLINE} strokeWidth="1" />))}
          </g>
        )}
        <path d="M40 84V110" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" opacity="0.3" />

        {/* lock / crest */}
        {school ? (
          <CrestShape theme={t} u={`${u}-crest`} x={66} y={78} w={28} />
        ) : c.heavy && !c.rainbow ? (
          <g>
            <circle cx="80" cy="97" r="13" fill={`url(#${u}-metal)`} stroke={OUTLINE} strokeWidth="2" />
            <circle cx="80" cy="97" r="7" fill={shade(body, -0.3)} stroke={OUTLINE} strokeWidth="1.5" />
            {[0, 60, 120, 180, 240, 300].map((a) => (
              <line key={a} x1={80 + 9.5 * Math.cos((a * Math.PI) / 180)} y1={97 + 9.5 * Math.sin((a * Math.PI) / 180)} x2={80 + 12 * Math.cos((a * Math.PI) / 180)} y2={97 + 12 * Math.sin((a * Math.PI) / 180)} stroke={OUTLINE} strokeWidth="1.4" />
            ))}
            <circle cx="80" cy="97" r="3" fill={c.gem} />
          </g>
        ) : (
          <g>
            <path d="M69 78H91V96Q91 104 80 108Q69 104 69 96Z" fill={`url(#${u}-metal)`} stroke={OUTLINE} strokeWidth="2" strokeLinejoin="round" />
            {c.rainbow ? (
              <path d="M80 83L87 92L80 101L73 92Z" fill={`url(#${u}-rbw)`} stroke={OUTLINE} strokeWidth="1.4" />
            ) : (
              <g>
                <circle cx="80" cy="89" r="3.5" fill={OUTLINE} />
                <path d="M78.5 90L77 99H83L81.5 90Z" fill={OUTLINE} />
              </g>
            )}
          </g>
        )}
        {!isOpen && lidClosed}
        {st === 'opening' && lidClosed}
      </g>
    </svg>
  );
}
