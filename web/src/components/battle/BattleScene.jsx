// Pokémon-style battle scene: painted arena, the player's QuizBot and the rival
// on their platforms, name plates with HP, and one-shot battle effects.
// Presentation only: every effect is derived from server state changes (or the
// local "buzzing"/"charging" flags) and never blocks input or changes results.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { QuizBot } from '../bot/index.js';
import { buzzerSkin } from '../bot/palettes.js';
import { arenaFor, hpFor, hpTone, isReducedMotion } from './battleModel.js';
import { sfx } from './sfx.js';
import './battle.css';

const ART_ASPECT = 1600 / 905;
const FLY_MS = 380;
let fxSeq = 0;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function play(el, frames, opts) {
  if (!el || isReducedMotion() || !el.animate) return null;
  try {
    return el.animate(frames, { duration: 360, easing: 'ease-out', ...opts });
  } catch {
    return null;
  }
}

const SHAKE = [
  { transform: 'translate(0, 0)' },
  { transform: 'translate(-6px, 0) rotate(-2deg)' },
  { transform: 'translate(6px, 0) rotate(2deg)' },
  { transform: 'translate(-4px, 0)' },
  { transform: 'translate(3px, 0)' },
  { transform: 'translate(0, 0)' }
];

export default function BattleScene({ session, mySide, foe, worldId, loadout, theme, player, buzzing, charging, soundOn, calm, children }) {
  const sceneRef = useRef(null);
  const shakeRef = useRef(null);
  const playerMotion = useRef(null);
  const playerBlink = useRef(null);
  const foeMotion = useRef(null);
  const foeFlash = useRef(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [fx, setFx] = useState([]);
  const [intro, setIntro] = useState(false);
  const [finale, setFinale] = useState(null); // 'win' | 'lose' | 'tie' | 'solo'
  const [emoteKey, setEmoteKey] = useState(0);
  const timers = useRef([]);

  useLayoutEffect(() => {
    const el = sceneRef.current;
    if (!el) return undefined;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // ---- geometry: cover the scene with the arena, keep both platforms in view
  const arena = arenaFor(worldId);
  const { w, h } = box;
  const stageW = Math.max(w, h * ART_ASPECT);
  const stageH = stageW / ART_ASPECT;
  const focusX = (arena.player.x + arena.rival.x) / 200;
  const botH = Math.max(90, Math.min(h * 0.6, w * 0.34, 400));
  const botW = (botH * 240) / 260;
  const foeS = Math.max(80, Math.min(h * (foe.boss ? 0.62 : 0.5), w * 0.32, foe.boss ? 420 : 340));
  // Centre the two platforms, then nudge so neither actor is cut off (narrow screens).
  let left = w / 2 - focusX * stageW;
  left = Math.max(left, 8 + botW * 0.45 - (arena.player.x / 100) * stageW);
  left = Math.min(left, w - 8 - foeS / 2 - (arena.rival.x / 100) * stageW);
  left = clamp(left, w - stageW, 0);
  const top = clamp(h * 0.86 - (arena.player.y / 100) * stageH, h - stageH, 0);
  const P = { x: left + (arena.player.x / 100) * stageW, y: top + (arena.player.y / 100) * stageH };
  const R = { x: left + (arena.rival.x / 100) * stageW, y: top + (arena.rival.y / 100) * stageH };
  const teamS = Math.max(64, Math.min(h * 0.26, w * 0.22, 170));
  const isTeam = foe.type === 'team';
  const playerBox = isTeam ? { x: P.x - teamS / 2, y: P.y - teamS * 0.92, w: teamS, h: teamS } : { x: P.x - botW * 0.45, y: P.y - botH * 0.93, w: botW, h: botH };
  const foeSize = isTeam ? teamS * 0.85 : foeS;
  const foeBox = { x: R.x - foeSize / 2, y: R.y - foeSize * 0.94, w: foeSize, h: foeSize };
  const geo = {
    playerHand: { x: playerBox.x + playerBox.w * 0.78, y: playerBox.y + playerBox.h * 0.5 },
    playerCenter: { x: playerBox.x + playerBox.w * 0.5, y: playerBox.y + playerBox.h * 0.5 },
    playerHead: { x: playerBox.x + playerBox.w * 0.5, y: playerBox.y + playerBox.h * 0.12 },
    foeCenter: { x: foeBox.x + foeBox.w * 0.5, y: foeBox.y + foeBox.h * 0.55 },
    foeHead: { x: foeBox.x + foeBox.w * 0.5, y: foeBox.y + foeBox.h * 0.1 },
    foeMouth: { x: foeBox.x + foeBox.w * 0.25, y: foeBox.y + foeBox.h * 0.5 },
    w,
    h
  };
  const geoRef = useRef(geo);
  geoRef.current = geo;

  const buzzColor = buzzerSkin(loadout?.held || 'buzzer-classic', theme).dome;
  const foeColor = foe.color || '#e5484d';
  const soloDummy = foe.type === 'dummy';
  const live = session.mode === 'live_battle';

  // ---- effects plumbing
  const later = useCallback((ms, fn) => {
    const t = setTimeout(fn, ms);
    timers.current.push(t);
  }, []);
  const addFx = useCallback(
    (f, life) => {
      const id = ++fxSeq;
      setFx((l) => [...l, { ...f, id }]);
      later(life, () => setFx((l) => l.filter((x) => x.id !== id)));
    },
    [later]
  );

  // Keep the latest values for the event handlers below.
  const live$ = useRef({});
  live$.current = { soundOn, calm, buzzColor, foeColor, soloDummy, live, foe };

  const impact = useCallback(
    (onFoe, { points, powered }) => {
      const g = geoRef.current;
      const s = live$.current;
      const color = onFoe ? s.buzzColor : s.foeColor;
      if (s.soundOn) (powered ? sfx.power : sfx.hit)();
      play(onFoe ? foeMotion.current : playerMotion.current, SHAKE, { duration: 380 });
      if (onFoe) play(foeFlash.current, [{ opacity: 0 }, { opacity: 0.95 }, { opacity: 0 }, { opacity: 0.7 }, { opacity: 0 }], { duration: 420, easing: 'linear' });
      else play(playerBlink.current, [{ opacity: 1 }, { opacity: 0.2 }, { opacity: 1 }, { opacity: 0.2 }, { opacity: 1 }], { duration: 420, easing: 'linear' });
      const at = onFoe ? g.foeCenter : g.playerCenter;
      const head = onFoe ? g.foeHead : g.playerHead;
      if (!isReducedMotion()) addFx({ kind: 'burst', x: at.x, y: at.y, color, n: s.calm ? 4 : 8 }, 720);
      const text = onFoe && s.soloDummy ? `+${points}` : `-${points}`;
      addFx({ kind: 'dmg', x: head.x, y: head.y, text, foe: !onFoe }, 1100);
      if (powered) {
        addFx({ kind: 'banner', text: 'POWER!' }, 1200);
        if (!s.calm) play(shakeRef.current, [{ transform: 'translate(0,0)' }, { transform: 'translate(5px,-3px)' }, { transform: 'translate(-5px,3px)' }, { transform: 'translate(0,0)' }], { duration: 150, easing: 'linear' });
      }
      if (onFoe && !s.live) addFx({ kind: 'xp' }, 1300);
    },
    [addFx]
  );

  const attack = useCallback(
    (fromPlayer, info) => {
      const g = geoRef.current;
      const s = live$.current;
      const dir = fromPlayer ? 1 : -1;
      play(fromPlayer ? playerMotion.current : foeMotion.current, [{ transform: 'translate(0,0)' }, { transform: `translate(${dir * -6}px, ${dir * 4}px) scale(0.97)`, offset: 0.2 }, { transform: `translate(${dir * 26}px, ${dir * -10}px) scale(1.05)`, offset: 0.5 }, { transform: 'translate(0,0)' }], { duration: 460 });
      if (s.soundOn) sfx.whoosh();
      if (isReducedMotion()) {
        impact(!!fromPlayer, info);
        return;
      }
      const from = fromPlayer ? g.playerHand : g.foeMouth;
      const to = fromPlayer ? g.foeCenter : g.playerCenter;
      addFx({ kind: 'proj', x: from.x, y: from.y, dx: to.x - from.x, dy: to.y - from.y, color: fromPlayer ? s.buzzColor : s.foeColor, big: !!info.powered }, FLY_MS + 60);
      later(FLY_MS, () => impact(!!fromPlayer, info));
    },
    [addFx, impact, later]
  );

  const miss = useCallback(
    (byPlayer) => {
      const g = geoRef.current;
      const s = live$.current;
      if (byPlayer) {
        if (s.soundOn) sfx.miss();
        play(playerMotion.current, [{ transform: 'none' }, { transform: 'translate(-4px, 6px) rotate(-5deg)', offset: 0.25 }, { transform: 'translate(3px, 6px) rotate(-3deg)', offset: 0.5 }, { transform: 'none' }], { duration: 700 });
        if (!s.soloDummy) play(foeMotion.current, [{ transform: 'none' }, { transform: 'translateY(-14px)', offset: 0.25 }, { transform: 'none', offset: 0.5 }, { transform: 'translateY(-8px)', offset: 0.75 }, { transform: 'none' }], { duration: 640, delay: 140 });
        addFx({ kind: 'fizzle', x: g.playerHand.x, y: g.playerHand.y, color: s.buzzColor }, 600);
        addFx({ kind: 'note', x: g.playerHead.x, y: g.playerHead.y, text: 'So close!' }, 1000);
      } else {
        if (s.soundOn) sfx.boing();
        play(foeMotion.current, [{ transform: 'none' }, { transform: 'translate(10px, 4px) rotate(10deg)', offset: 0.3 }, { transform: 'translate(-4px, 2px) rotate(-6deg)', offset: 0.6 }, { transform: 'none' }], { duration: 700 });
        addFx({ kind: 'note', x: g.foeHead.x, y: g.foeHead.y, text: '?!' }, 1000);
      }
    },
    [addFx]
  );

  const foeBuzz = useCallback(() => {
    const g = geoRef.current;
    play(foeMotion.current, [{ transform: 'none' }, { transform: 'translateY(-16px) scale(1.05)', offset: 0.4 }, { transform: 'none' }], { duration: 360 });
    addFx({ kind: 'note', x: g.foeHead.x, y: g.foeHead.y, text: '!', alert: true }, 1100);
  }, [addFx]);

  const runFinale = useCallback(
    (kind) => {
      const s = live$.current;
      setFinale(kind);
      if (kind === 'win' || kind === 'solo') {
        setEmoteKey((k) => k + 1);
        if (s.soundOn) sfx.victory();
        if (!isReducedMotion()) addFx({ kind: 'confetti', n: s.calm ? 10 : 26 }, 2600);
        if (kind === 'win') later(250, () => play(foeMotion.current, [{ transform: 'none', opacity: 1 }, { transform: 'translateY(-10px)', opacity: 1, offset: 0.2 }, { transform: 'translateY(40px) scale(0.9)', opacity: 0 }], { duration: 750, fill: 'forwards', easing: 'ease-in' }));
        if (kind === 'win' && s.soundOn) later(300, () => sfx.flee());
      } else if (kind === 'lose') {
        if (s.soundOn) sfx.soft();
        play(playerMotion.current, [{ transform: 'none', opacity: 1 }, { transform: 'translateY(14px) rotate(-4deg)', opacity: 0.45 }], { duration: 700, fill: 'forwards' });
        play(foeMotion.current, [{ transform: 'none' }, { transform: 'translateY(-18px)', offset: 0.25 }, { transform: 'none', offset: 0.5 }, { transform: 'translateY(-12px)', offset: 0.75 }, { transform: 'none' }], { duration: 800, delay: 200 });
      }
    },
    [addFx, later]
  );

  // ---- derive one-shot effects from server state transitions
  const snapRef = useRef(null);
  useEffect(() => {
    const c = session.current;
    const b = session.bonus;
    const snap = {
      status: session.status,
      qid: c?.questionId || null,
      n: c?.attempts?.length || 0,
      bq: b ? `${session.qIndex}:${b.questionId}` : null,
      bn: b?.results?.length || 0
    };
    const prev = snapRef.current;
    snapRef.current = snap;
    if (!prev) {
      if (snap.status === 'READY') {
        setIntro(true);
      }
      return;
    }
    const mine = (side) => (mySide ? side === mySide : true);
    if (snap.qid && snap.qid === prev.qid && snap.n > prev.n) {
      c.attempts.slice(prev.n).forEach((a, i) => {
        const run = () => {
          if (a.result === 'correct') attack(mine(a.side), { points: a.points, powered: a.powered });
          else miss(mine(a.side));
        };
        if (i === 0) run();
        else later(i * 700, run);
      });
    }
    if (snap.bq) {
      const from = snap.bq === prev.bq ? prev.bn : 0;
      if (snap.bn > from) {
        b.results.slice(from).forEach((r) => {
          if (r.result === 'correct') attack(mine(b.side), { points: r.points, powered: false });
          else miss(mine(b.side));
        });
      }
    }
    const foeAnswering = (snap.status === 'BUZZ_LOCKED' || (snap.status === 'AWAITING_ANSWER' && c?.buzz && !mine(c.buzz.side))) && !(prev.status === 'BUZZ_LOCKED' || prev.status === 'AWAITING_ANSWER');
    if (foeAnswering) foeBuzz();
    if (snap.status === 'COMPLETE' && prev.status !== 'COMPLETE') {
      const winner = session.result?.winnerSide;
      runFinale(!winner ? 'solo' : winner === 'tie' ? 'tie' : winner === mySide ? 'win' : 'lose');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // Player hop the moment they press BUZZ (before the server answers).
  const wasBuzzing = useRef(false);
  useEffect(() => {
    if (buzzing && !wasBuzzing.current) {
      play(playerMotion.current, [{ transform: 'none' }, { transform: 'translateY(-12px) scale(1.04)', offset: 0.4 }, { transform: 'none' }], { duration: 300 });
    }
    wasBuzzing.current = buzzing;
  }, [buzzing]);

  // ---- persistent poses
  const st = session.status;
  const c = session.current;
  const foeLeaning = st === 'BUZZ_LOCKED' || (st === 'AWAITING_ANSWER' && c?.buzz && mySide && c.buzz.side !== mySide);
  const hpShown = foe.hp;
  const playerSide = mySide || 'A';
  const playerHp = hpShown ? hpFor(session, playerSide) : 100;
  const foeHp = hpShown && foe.side ? hpFor(session, foe.side) : 100;
  const playerScore = session.sides?.[playerSide]?.score ?? 0;
  const foeScore = foe.side ? session.sides?.[foe.side]?.score ?? 0 : null;
  const ready = w > 0 && h > 0;
  const mySideInfo = session.sides?.[playerSide] || {};

  return (
    <div className="bt-scene" ref={sceneRef}>
      <div className="bt-shake" ref={shakeRef}>
        <div className="bt-stage" style={{ left, top, width: stageW, height: stageH }} aria-hidden="true">
          <img key={arena.image} className="bt-arena" src={arena.image} alt="" draggable="false" />
        </div>
        <div className="bt-vignette" aria-hidden="true" />

        {ready ? (
          <div className="bt-actors" aria-hidden="true">
            {/* Foe (far platform) */}
            <div className={`bt-actor bt-foe ${intro ? 'bt-enter-foe' : ''}`} style={{ left: foeBox.x, top: foeBox.y, width: foeBox.w, height: foeBox.h }}>
              <div className="bt-shadow" />
              <div className={`bt-pose ${foeLeaning ? 'is-lunge' : ''}`}>
                <div className="bt-motion" ref={foeMotion}>
                  <div className={`bt-bob ${finale === 'win' ? '' : 'bt-idle-foe'}`}>
                    {isTeam ? (
                      <TeamToken emoji={foe.emoji} color={foeColor} />
                    ) : foe.image ? (
                      <>
                        <img className="bt-foe-img" src={foe.image} alt="" draggable="false" />
                        <img className="bt-foe-flash" ref={foeFlash} src={foe.image} alt="" draggable="false" />
                      </>
                    ) : (
                      <TeamToken emoji={foe.emoji} color={foeColor} />
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Player (near platform) */}
            <div
              className={`bt-actor bt-player ${intro ? 'bt-enter-player' : ''}`}
              onAnimationEnd={(e) => {
                if (e.target === e.currentTarget) setIntro(false);
              }}
              style={{ left: playerBox.x, top: playerBox.y, width: playerBox.w, height: playerBox.h }}>
              <div className="bt-shadow" />
              <div className="bt-aura" style={{ '--c': buzzColor, opacity: buzzing || charging ? 1 : 0 }} />
              <div className={`bt-pose ${buzzing || charging ? 'is-ready' : ''}`}>
                <div className="bt-motion" ref={playerMotion}>
                  <div ref={playerBlink}>
                    {isTeam ? (
                      <TeamToken emoji={mySideInfo.emoji} color={theme?.primaryColor || '#6d4df2'} />
                    ) : (
                      <QuizBot
                        key={`bot-${emoteKey}`}
                        loadout={loadout}
                        theme={theme}
                        pose={finale === 'win' || finale === 'solo' ? 'emote' : 'idle'}
                        size={botW}
                        title="Your QuizBot"
                      />
                    )}
                  </div>
                </div>
              </div>
              {charging ? <div className="bt-charge" style={{ '--c': buzzColor, left: playerBox.w * 0.78, top: playerBox.h * 0.5 }} /> : null}
            </div>
          </div>
        ) : null}

        {/* Effects */}
        <div className="bt-fx" aria-hidden="true">
          {fx.map((f) => (
            <Fx key={f.id} f={f} h={h} />
          ))}
          {intro ? <div className="bt-flash" /> : null}
        </div>

        {/* Name plates */}
        <div className="bt-plates">
          <Plate
            where="foe"
            name={foe.name}
            tag={foe.tag}
            level={foe.level}
            hp={foeHp}
            showHp={hpShown}
            score={foeScore}
            tone={foe.boss ? 'boss' : foe.wild ? 'wild' : 'plain'}
          />
          <Plate
            where="player"
            name={live ? mySideInfo.name || 'Your team' : player.name}
            sub={live ? 'Your team' : null}
            level={live ? null : { lv: player.level }}
            hp={playerHp}
            showHp={hpShown}
            score={playerScore}
            xpPct={live ? null : player.xpPct}
          />
        </div>

        {children}
      </div>
    </div>
  );
}

function TeamToken({ emoji, color }) {
  return (
    <div className="bt-team" style={{ '--c': color }}>
      <span>{emoji || '🛡️'}</span>
    </div>
  );
}

function Plate({ where, name, tag, sub, level, hp, showHp, score, xpPct, tone }) {
  const t = hpTone(hp);
  return (
    <div className={`bt-plate bt-plate-${where}`}>
      <div className="bt-plate-top">
        <span className="bt-plate-name">{name}</span>
        {tag ? <span className={`bt-tag bt-tag-${tone}`}>{tag}</span> : null}
        {level?.lv ? <span className="bt-plate-lv">Lv {level.lv}</span> : null}
      </div>
      {sub ? <span className="bt-plate-sub">{sub}</span> : null}
      {showHp ? (
        <div className="bt-hp">
          <span className="bt-hp-label" aria-hidden="true">
            HP
          </span>
          <div className="bt-hp-track" aria-hidden="true">
            <span className="bt-hp-lag" style={{ transform: `scaleX(${hp / 100})` }} />
            <span className={`bt-hp-fill tone-${t}`} style={{ transform: `scaleX(${hp / 100})` }} />
          </div>
          <span className="bt-hp-num tabular">
            <span className="sr-only">{name} health </span>
            {hp}/100
            {t === 'low' ? <span className="sr-only"> (low)</span> : null}
          </span>
        </div>
      ) : null}
      <div className="bt-plate-bottom">
        {score != null ? (
          <span className="bt-plate-score">
            Score <strong className="tabular">{score}</strong>
          </span>
        ) : null}
        {level?.word ? <span className="bt-plate-word">{level.word}</span> : null}
      </div>
      {xpPct != null ? (
        <div className="bt-xpbar" aria-hidden="true">
          <span style={{ transform: `scaleX(${Math.max(0, Math.min(100, xpPct)) / 100})` }} />
        </div>
      ) : null}
    </div>
  );
}

const CONFETTI_COLORS = ['#ffc940', '#6d4df2', '#2dd4bf', '#ff6fb5', '#46e3ff', '#35d46b'];

function Fx({ f, h }) {
  switch (f.kind) {
    case 'proj':
      return (
        <div className={`bt-proj ${f.big ? 'big' : ''}`} style={{ left: f.x, top: f.y, '--dx': `${f.dx}px`, '--dy': `${f.dy}px`, '--c': f.color }}>
          <span className="core" />
          <span className="trail t1" />
          <span className="trail t2" />
        </div>
      );
    case 'burst':
      return (
        <div className="bt-burst" style={{ left: f.x, top: f.y, '--c': f.color }}>
          <span className="ring" />
          {Array.from({ length: f.n }, (_, i) => (
            <span key={i} className="star" style={{ '--a': `${(360 / f.n) * i + 12}deg` }} />
          ))}
        </div>
      );
    case 'dmg':
      return (
        <div className={`bt-dmg ${f.foe ? 'on-player' : ''}`} style={{ left: f.x, top: f.y }}>
          {f.text}
        </div>
      );
    case 'note':
      return (
        <div className={`bt-note ${f.alert ? 'alert' : ''}`} style={{ left: f.x, top: f.y }}>
          {f.text}
        </div>
      );
    case 'fizzle':
      return <div className="bt-fizzle" style={{ left: f.x, top: f.y, '--c': f.color }} />;
    case 'banner':
      return (
        <div className="bt-banner">
          <span>{f.text}</span>
        </div>
      );
    case 'xp':
      return <div className="bt-xp">+XP</div>;
    case 'confetti':
      return (
        <div className="bt-confetti" style={{ '--fall': `${h + 40}px` }}>
          {Array.from({ length: f.n }, (_, i) => (
            <span
              key={i}
              style={{
                left: `${(i * 97) % 100}%`,
                background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
                animationDelay: `${(i % 7) * 60}ms`,
                animationDuration: `${1500 + ((i * 53) % 700)}ms`,
                '--r': `${((i * 137) % 720) - 360}deg`
              }}
            />
          ))}
        </div>
      );
    default:
      return null;
  }
}
