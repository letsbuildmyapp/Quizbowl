// The island map: a horizontally panning camera over /art/island-map.webp with
// gates, stars, chests, paths and the player's QuizBot. Only CSS transforms move.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Crown, Lock } from 'lucide-react';
import { ChestArt, FloatingIsland, QuizBot } from '../bot/index.js';
import { MAP, MAP_W, MAP_H, ASPECT, GATE_BY_WORLD, curvePoint, gateInfo, neighborInDirection, objectInfo, pathCurve, route, standPoint, starText } from './mapModel.js';

const DIRS = { ArrowLeft: { dx: -1, dy: 0 }, ArrowRight: { dx: 1, dy: 0 }, ArrowUp: { dx: 0, dy: -1 }, ArrowDown: { dx: 0, dy: 1 } };
const DRAG_THRESHOLD = 6;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

const Overworld = forwardRef(function Overworld(
  { student, theme, loadout, playerWorld, followWorld, selectedWorld, panelOffset = 0, reducedMotion, calm, entering, busyObject, openingChest, onSelectGate, onArrive, onClaim, onAnnounce },
  ref
) {
  const stageRef = useRef(null);
  const worldRef = useRef(null);
  const playerRef = useRef(null);
  const cam = useRef({ x: 0, ready: false });
  const drag = useRef(null);
  const suppressClick = useRef(false);
  const walk = useRef(null);
  const [size, setSize] = useState({ vw: 0, H: 0 });
  const [edges, setEdges] = useState({ left: false, right: true });
  const [walking, setWalking] = useState(false);
  const W = size.H * ASPECT;
  const u = size.H / MAP_H; // px per map unit
  const botSize = Math.round(clamp(size.H * 0.168, 76, 116));
  const botH = (botSize * 260) / 240;

  const isOpen = useCallback((w) => gateInfo(w, student).ws.state !== 'locked', [student]);

  // ---- camera ----
  const clampCam = useCallback(
    (x) => {
      if (W <= size.vw) return (W - size.vw) / 2;
      return clamp(x, 0, W - size.vw);
    },
    [W, size.vw]
  );

  const applyCam = useCallback(
    (x, ms = 0) => {
      const el = worldRef.current;
      if (!el) return;
      const nx = clampCam(x);
      cam.current.x = nx;
      el.style.transition = ms && !reducedMotion ? `transform ${ms}ms cubic-bezier(.33,.8,.3,1)` : 'none';
      el.style.transform = `translate3d(${-nx}px,0,0)`;
      const left = nx > 2;
      const right = nx < W - size.vw - 2;
      setEdges((e) => (e.left === left && e.right === right ? e : { left, right }));
    },
    [clampCam, reducedMotion, W, size.vw]
  );

  const centerOn = useCallback(
    (xPct, ms = 600) => {
      const visible = size.vw - panelOffset;
      applyCam((xPct / 100) * W - visible / 2, ms);
    },
    [applyCam, W, size.vw, panelOffset]
  );

  const ensureVisible = useCallback(
    (xPct) => {
      const px = (xPct / 100) * W;
      const margin = Math.min(160, size.vw * 0.2);
      const visible = size.vw - panelOffset;
      const x = cam.current.x;
      if (px < x + margin || px > x + visible - margin) centerOn(xPct, 450);
    },
    [W, size.vw, panelOffset, centerOn]
  );

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const measure = () => setSize({ vw: el.clientWidth, H: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Follow the player (or the selected gate). First placement jumps; later ones glide.
  const followX = GATE_BY_WORLD[followWorld]?.x ?? standPoint(playerWorld).x;
  useLayoutEffect(() => {
    if (!size.H || walk.current) return;
    centerOn(followX, cam.current.ready ? 600 : 0);
    cam.current.ready = true;
  }, [followX, size.H, size.vw, panelOffset, centerOn]);

  // ---- player placement + walking ----
  const placePlayer = useCallback(
    (xPct, yPct, lift = 0) => {
      const el = playerRef.current;
      if (!el || !size.H) return;
      el.style.transform = `translate3d(${(xPct / 100) * W - botSize / 2}px, ${(yPct / 100) * size.H - botH - lift}px, 0)`;
    },
    [W, size.H, botSize, botH]
  );

  useLayoutEffect(() => {
    if (walk.current) return;
    const p = standPoint(playerWorld);
    placePlayer(p.x, p.y);
  }, [playerWorld, placePlayer]);

  const finishWalk = useCallback(() => {
    const w = walk.current;
    if (!w) return;
    cancelAnimationFrame(w.raf);
    walk.current = null;
    setWalking(false);
    const p = standPoint(w.to);
    placePlayer(p.x, p.y);
    applyCam(cam.current.x);
    w.resolve(w.to);
  }, [placePlayer, applyCam]);

  const walkTo = useCallback(
    (to) =>
      new Promise((resolve) => {
        if (walk.current) finishWalk();
        const hops = route(playerWorld, to, isOpen) || [playerWorld, to];
        if (hops.length < 2) {
          resolve(to);
          return;
        }
        const legs = [];
        for (let i = 0; i < hops.length - 1; i++) {
          const curve = pathCurve(hops[i], hops[i + 1]);
          const s0 = standPoint(hops[i]);
          const s1 = standPoint(hops[i + 1]);
          const g0 = GATE_BY_WORLD[hops[i]];
          const g1 = GATE_BY_WORLD[hops[i + 1]];
          const pxLen = curve.len * u;
          const ms = hops.length > 2 ? 380 : clamp(pxLen * 0.9, 350, 650);
          legs.push({ curve, off0: s0.y - g0.y, off1: s1.y - g1.y, offx0: s0.x - g0.x, offx1: s1.x - g1.x, ms });
        }
        const total = legs.reduce((s, l) => s + l.ms, 0);
        walk.current = { to, resolve, raf: 0 };
        const dest = standPoint(to);
        if (reducedMotion) {
          finishWalk();
          centerOn(dest.x, 0);
          return;
        }
        setWalking(true);
        centerOn(dest.x, total);
        const t0 = performance.now();
        const step = (now) => {
          if (!walk.current) return;
          let el = now - t0;
          if (el >= total) {
            finishWalk();
            return;
          }
          let leg = legs[0];
          for (const l of legs) {
            leg = l;
            if (el < l.ms) break;
            el -= l.ms;
          }
          const t = ease(Math.min(1, el / leg.ms));
          const pt = curvePoint(leg.curve, t);
          const off = leg.off0 + (leg.off1 - leg.off0) * t;
          const offx = leg.offx0 + (leg.offx1 - leg.offx0) * t;
          const hop = Math.abs(Math.sin(t * Math.PI * Math.max(2, Math.round(leg.ms / 160)))) * botSize * 0.08;
          placePlayer((pt.x / MAP_W) * 100 + offx, (pt.y / MAP_H) * 100 + off, hop);
          walk.current.raf = requestAnimationFrame(step);
        };
        walk.current.raf = requestAnimationFrame(step);
      }).then((w) => {
        onArrive?.(w);
        return w;
      }),
    [playerWorld, isOpen, u, reducedMotion, finishWalk, centerOn, placePlayer, botSize, onArrive]
  );

  useEffect(() => () => walk.current && cancelAnimationFrame(walk.current.raf), []);

  const focusGate = useCallback((worldId) => {
    stageRef.current?.querySelector(`[data-gate="${worldId}"]`)?.focus({ preventScroll: true });
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      walkTo,
      focusGate,
      centerOn: (worldId, ms) => centerOn(GATE_BY_WORLD[worldId].x, ms),
      rectOf: (id) => stageRef.current?.querySelector(`[data-obj="${id}"]`)?.getBoundingClientRect() || null,
      playerRect: () => playerRef.current?.getBoundingClientRect() || null,
      skipWalk: finishWalk
    }),
    [walkTo, focusGate, centerOn, finishWalk]
  );

  // ---- input: drag, wheel, keys, focus ----
  const onPointerDown = (e) => {
    if (walk.current) finishWalk();
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    drag.current = { id: e.pointerId, x0: e.clientX, cam0: cam.current.x, moved: false };
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x0;
    if (!d.moved && Math.abs(dx) < DRAG_THRESHOLD) return;
    if (!d.moved) {
      d.moved = true;
      stageRef.current?.setPointerCapture?.(e.pointerId);
      stageRef.current?.classList.add('is-dragging');
    }
    applyCam(d.cam0 - dx);
  };
  const endDrag = (e) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    stageRef.current?.classList.remove('is-dragging');
    if (d.moved) {
      suppressClick.current = true;
      setTimeout(() => (suppressClick.current = false), 0);
    }
  };
  const onClickCapture = (e) => {
    if (suppressClick.current) {
      e.stopPropagation();
      e.preventDefault();
    }
  };

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      if (e.ctrlKey) return; // pinch zoom stays with the browser
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (!d) return;
      e.preventDefault();
      applyCam(cam.current.x + d * (e.deltaMode === 1 ? 32 : 1));
    };
    // Tabbing to an off-screen object makes the browser scroll the clipped stage: turn that into a pan.
    const onScroll = () => {
      if (!el.scrollLeft && !el.scrollTop) return;
      const sx = el.scrollLeft;
      el.scrollLeft = 0;
      el.scrollTop = 0;
      applyCam(cam.current.x + sx);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('scroll', onScroll);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('scroll', onScroll);
    };
  }, [applyCam]);

  const onKeyDown = (e) => {
    if (walk.current) {
      finishWalk();
      if (DIRS[e.key]) e.preventDefault();
      return;
    }
    const dir = DIRS[e.key];
    if (!dir || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    const next = neighborInDirection(playerWorld, dir, isOpen);
    if (!next) {
      onAnnounce?.('No open path that way.');
      return;
    }
    focusGate(next);
    onAnnounce?.(`Walking to ${gateInfo(next, student).name}.`);
    walkTo(next);
  };

  const onFocusCapture = (e) => {
    const x = Number(e.target?.dataset?.x);
    if (Number.isFinite(x) && !walk.current) ensureVisible(x);
  };

  const pan = (dir) => applyCam(cam.current.x + dir * size.vw * 0.6, 450);

  // ---- render model ----
  const gates = useMemo(() => MAP.entrances.map((e) => ({ e, info: gateInfo(e.world, student) })), [student]);
  const open = useMemo(() => Object.fromEntries(gates.map((g) => [g.e.world, g.info.ws.state !== 'locked'])), [gates]);
  const stars = useMemo(() => MAP.stars.map((s) => ({ s, info: objectInfo(s, 'star', student) })), [student]);
  const chests = useMemo(() => MAP.chests.map((c) => ({ c, info: objectInfo(c, 'chest', student) })), [student]);
  const paths = useMemo(() => MAP.paths.map((p) => ({ p, curve: pathCurve(p.from, p.to), lit: open[p.from] && open[p.to] })), [open]);

  // Tab order follows the map left to right.
  const objects = useMemo(
    () =>
      [
        ...gates.map((g) => ({ kind: 'gate', x: g.e.x, key: g.e.id, g })),
        ...stars.map((s) => ({ kind: 'star', x: s.s.x, key: s.s.id, s })),
        ...chests.map((c) => ({ kind: 'chest', x: c.c.x, key: c.c.id, c }))
      ].sort((a, b) => a.x - b.x),
    [gates, stars, chests]
  );

  const tipBelow = (y) => y < 34;

  return (
    <div className={`adv-stage ${walking ? 'is-walking' : ''}`} ref={stageRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag} onClickCapture={onClickCapture} onKeyDown={onKeyDown} onFocusCapture={onFocusCapture}>
      <div className="adv-world" ref={worldRef} style={{ width: W || '100%', height: size.H || '100%', '--u': `${u}px` }}>
        <img className="adv-map-img" src={MAP.image} alt="" width={MAP_W} height={MAP_H} draggable={false} decoding="async" fetchpriority="high" />

        <svg className="adv-paths" viewBox={`0 0 ${MAP_W} ${MAP_H}`} preserveAspectRatio="none" aria-hidden="true">
          {paths.map(({ p, curve, lit }) => {
            const d = `M${curve.a.x} ${curve.a.y}Q${curve.c.x} ${curve.c.y} ${curve.b.x} ${curve.b.y}`;
            return (
              <g key={p.id} className={lit ? 'adv-path is-lit' : 'adv-path is-locked'}>
                <path d={d} className="adv-path-under" />
                <path d={d} className="adv-path-dots" />
              </g>
            );
          })}
        </svg>
        {paths
          .filter((x) => !x.lit)
          .map(({ p, curve }) => {
            // Sit the padlock near the locked end so it never covers an open gate.
            const t = open[p.to] ? 0.28 : open[p.from] ? 0.72 : 0.5;
            const m = curvePoint(curve, t);
            return (
              <span key={p.id} className="adv-path-lock" style={{ left: `${(m.x / MAP_W) * 100}%`, top: `${(m.y / MAP_H) * 100}%` }} aria-hidden="true">
                <Lock size={Math.round(clamp(14 * u, 12, 18))} strokeWidth={2.6} />
              </span>
            );
          })}

        {/* Dim wash + plaque badges sit under the interactive layer. */}
        {gates.map(({ e, info }) =>
          info.ws.state === 'locked' && !e.floating ? <span key={`fog-${e.id}`} className="adv-fog" style={{ left: `${e.x}%`, top: `${e.y - 8}%` }} aria-hidden="true" /> : null
        )}
        {gates.map(({ e, info }) => {
          const at = e.plaque ? { x: e.plaque.x, y: e.plaque.y + 8.5 } : { x: e.x, y: e.y + 17 };
          return (
            <span key={`badge-${e.id}`} className={`adv-badge adv-badge--${info.ws.state}`} style={{ left: `${at.x}%`, top: `${at.y}%` }} aria-hidden="true">
              {info.ws.state === 'locked' ? (
                <>
                  <Lock size={13} strokeWidth={2.8} /> {e.floating ? info.name : `${info.ws.unlock.have}/${info.ws.unlock.need}`}
                </>
              ) : (
                <>
                  {info.ws.state === 'mastered' ? <Crown size={14} strokeWidth={2.6} /> : null}
                  {e.floating ? <span className="adv-badge-name">{info.name}</span> : null}
                  <span className="adv-badge-stars">{starText(info.stars)}</span>
                </>
              )}
            </span>
          );
        })}

        {objects.map((o) => {
          if (o.kind === 'gate') {
            const { e, info } = o.g;
            const st = info.ws.state;
            const sel = selectedWorld === e.world;
            return (
              <button
                key={o.key}
                type="button"
                className={`adv-obj adv-gate adv-gate--${st} ${e.floating ? 'is-floating' : ''} ${sel ? 'is-selected' : ''} ${entering === e.world ? 'is-entering' : ''} ${playerWorld === e.world ? 'is-here' : ''}`}
                style={{ left: `${e.x}%`, top: `${e.y}%` }}
                data-gate={e.world}
                data-obj={e.id}
                data-x={e.x}
                aria-label={info.label}
                aria-pressed={sel}
                onClick={() => onSelectGate(e.world)}
              >
                {st === 'mastered' ? <span className="adv-gate-glow" aria-hidden="true" /> : null}
                {e.floating ? <FloatingIsland world={e.world} locked={st === 'locked'} size={Math.round(130 * u)} title="" className="adv-island" /> : null}
                <span className="adv-gate-ring" aria-hidden="true" />
                {st === 'locked' ? (
                  <span className="adv-gate-lock" aria-hidden="true">
                    <Lock size={Math.round(clamp(20 * u, 16, 26))} strokeWidth={2.6} />
                  </span>
                ) : null}
                {st === 'mastered' ? (
                  <span className="adv-gate-crown" aria-hidden="true">
                    <Crown size={22} strokeWidth={2.4} />
                  </span>
                ) : null}
                <span className={`adv-tip ${tipBelow(e.y) ? 'is-below' : ''}`} aria-hidden="true">
                  <strong>
                    {info.world?.emoji} {info.name}
                  </strong>
                  <span className="adv-tip-stars">{starText(info.stars)}</span>
                  <span className="adv-tip-state">{info.stateText}</span>
                </span>
              </button>
            );
          }
          if (o.kind === 'star') {
            const { s, info } = o.s;
            const busy = busyObject === s.id;
            const cls = info.claimed ? 'is-claimed' : info.ready ? 'is-ready' : 'is-waiting';
            return (
              <button
                key={o.key}
                type="button"
                className={`adv-obj adv-star ${cls}`}
                style={{ left: `${s.x}%`, top: `${s.y}%` }}
                data-obj={s.id}
                data-x={s.x}
                aria-label={info.label}
                aria-busy={busy || undefined}
                aria-disabled={!info.ready || undefined}
                onClick={() => info.ready && !busy && onClaim(s, 'star')}
              >
                {info.ready ? (
                  <>
                    <span className="adv-star-glow" aria-hidden="true" />
                    <span className="adv-sparkle s1" aria-hidden="true" />
                    {!calm ? <span className="adv-sparkle s2" aria-hidden="true" /> : null}
                    <span className="adv-pill" aria-hidden="true">
                      {busy ? 'Collecting...' : 'Collect'}
                    </span>
                  </>
                ) : null}
                {info.claimed ? (
                  <span className="adv-check" aria-hidden="true">
                    <Check size={14} strokeWidth={3.4} />
                  </span>
                ) : null}
                <span className={`adv-tip ${tipBelow(s.y) ? 'is-below' : ''}`} aria-hidden="true">
                  <strong>Quest Star</strong>
                  <span className="adv-tip-state">{info.claimed ? 'Collected!' : info.ready ? 'Ready! Click to collect.' : info.req}</span>
                </span>
              </button>
            );
          }
          const { c, info } = o.c;
          const busy = busyObject === c.id;
          const opening = openingChest === c.id;
          const state = opening ? 'opening' : info.claimed ? 'open' : info.ready ? 'ready' : 'closed';
          const cls = info.claimed && !opening ? 'is-claimed' : info.ready || opening ? 'is-ready' : 'is-waiting';
          return (
            <button
              key={o.key}
              type="button"
              className={`adv-obj adv-chest ${cls}`}
              style={{ left: `${c.x}%`, top: `${c.y}%` }}
              data-obj={c.id}
              data-x={c.x}
              aria-label={info.label}
              aria-busy={busy || undefined}
              aria-disabled={!info.ready || undefined}
              onClick={() => info.ready && !busy && onClaim(c, 'chest')}
            >
              <span className="adv-chest-art" aria-hidden="true">
                <ChestArt rarity={info.rarity} state={state} theme={theme} size={Math.round(112 * u)} reducedMotion={reducedMotion} title="" />
              </span>
              {info.ready && !opening ? (
                <span className="adv-pill" aria-hidden="true">
                  {busy ? 'Opening...' : 'Open'}
                </span>
              ) : null}
              <span className={`adv-tip ${tipBelow(c.y) ? 'is-below' : ''}`} aria-hidden="true">
                <strong>{info.name}</strong>
                <span className="adv-tip-state">{info.claimed ? 'Opened. Your gear is in the Vault.' : info.ready ? 'Ready! Click to open.' : info.req}</span>
              </span>
            </button>
          );
        })}

        <div className={`adv-player ${entering ? 'is-entering' : ''}`} ref={playerRef} style={{ width: botSize }} aria-hidden="true">
          <span className="adv-player-shadow" />
          <span className="adv-player-bot">
            <QuizBot loadout={loadout} theme={theme} size={botSize} pose="idle" reducedMotion={reducedMotion} title="" />
          </span>
        </div>
      </div>

      <div className="adv-vignette" aria-hidden="true" />
      <button type="button" className="adv-edge adv-edge--left" onClick={() => pan(-1)} disabled={!edges.left} aria-label="Pan map left">
        <ChevronLeft size={28} strokeWidth={3} aria-hidden />
      </button>
      <button type="button" className="adv-edge adv-edge--right" onClick={() => pan(1)} disabled={!edges.right} aria-label="Pan map right">
        <ChevronRight size={28} strokeWidth={3} aria-hidden />
      </button>
    </div>
  );
});

export default Overworld;
