// Full-screen reward reveal. API (final, imported by battle, map, and Vault):
//   <RewardReveal grants={[grantDoc]} studentId onDone theme reducedMotion calm />
// Reveals each grant in order with a rarity-specific treatment, then acknowledges it:
//   updateDoc(students/{sid}/grants/{id}, { acknowledgedAt: serverTimestamp(), skipped, revealType })
// The item is already in the inventory (server-side); this is presentation only.
// Reads: useAuth().student (loadout, hall, sound setting), schoolThemes via useSchoolTheme when no theme prop.
// Writes: grant acknowledgement, loadoutRequests (Equip now), students/{id}.hall.featuredItems (Showcase).
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase.js';
import { useAuth } from '../../hooks/useAuth.jsx';
import { useSchoolTheme } from '../../hooks/useSchoolTheme.js';
import { CHESTS, ITEMS, RARITY, currentLoadout } from '../../lib/rewards.js';
import { request } from '../../lib/requests.js';
import { ChestArt, ItemArt, itemDisplayName } from '../bot/index.js';
import { friendlyError } from '../ui.jsx';
import { RarityChip, SLOT_LABEL, StarBurstArt, chestName, lessMotion, grantSourceLabel } from '../collection/parts.jsx';
import { rewardSfx } from './sfx.js';
import { SOUND_ENABLED } from '../../lib/sound.js';
import './reveal.css';

// Reveal timing per rarity (ms). Chest phase runs first for chest grants and for
// epic/legendary item grants (item rises out of the chest).
const REVEAL_MS = { common: 300, rare: 600, epic: 420, legendary: 620, mythic: 1500, stars: 500 };

function planFor(grant, quiet) {
  const chestRarity = grant.chestRarity || CHESTS[grant.chestId]?.rarity || 'common';
  const isChest = grant.type === 'chest';
  const item = grant.itemId ? ITEMS[grant.itemId] : null;
  const starsOnly = !item || !!grant.duplicate;
  const tier = item ? item.rarity : grant.rarity || chestRarity;
  const withChest = isChest || tier === 'epic' || tier === 'legendary';
  const chestArtRarity = isChest ? chestRarity : tier;
  const chestMs = quiet || !withChest ? 0 : chestArtRarity === 'legendary' ? 1000 : isChest ? 900 : 560;
  const revealMs = quiet ? 0 : REVEAL_MS[starsOnly ? 'stars' : tier] || 300;
  const revealType = `${isChest ? 'chest' : 'item'}-${starsOnly ? 'stars' : tier}${quiet ? '-calm' : ''}`;
  return { isChest, item, starsOnly, tier, withChest, chestRarity: chestArtRarity, chestMs, revealMs, revealType, school: grant.chestId === 'chest-school' || !!item?.school };
}

const PARTICLES = Array.from({ length: 10 }, (_, i) => {
  const a = (i / 10) * Math.PI * 2 + (i % 2 ? 0.2 : 0);
  const d = 90 + (i % 3) * 22;
  return { x: Math.round(Math.cos(a) * d), y: Math.round(Math.sin(a) * d * 0.8), s: i % 3 === 0 ? 12 : 8, delay: (i % 4) * 30 };
});

export default function RewardReveal({ grants, studentId, onDone, theme: themeProp, reducedMotion = false, calm = false }) {
  const { student, claims } = useAuth();
  const { theme: schoolTheme } = useSchoolTheme();
  const theme = themeProp || schoolTheme;
  const sid = studentId || claims?.studentId || student?.id;
  const quiet = !!(reducedMotion || calm || lessMotion(student));
  const soundOn = SOUND_ENABLED && student?.settings?.sound !== false;

  // Snapshot the grants so a live list (acknowledged grants leave the Vault query)
  // never shrinks mid-sequence; new grants that arrive later are appended.
  const [list, setList] = useState(() => (grants || []).filter(Boolean));
  useEffect(() => {
    setList((prev) => {
      const ids = new Set(prev.map((g) => g.id));
      const add = (grants || []).filter((g) => g && !ids.has(g.id));
      return add.length ? [...prev, ...add] : prev;
    });
  }, [grants]);

  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState('chest'); // chest -> reveal -> done
  const [summary, setSummary] = useState(false);
  const acked = useRef(new Set());
  const finished = useRef(false);
  const grant = list[index];
  const plan = useMemo(() => (grant ? planFor(grant, quiet) : null), [grant, quiet]);

  const ack = useCallback(
    (g, skipped) => {
      if (!g?.id || !sid || acked.current.has(g.id) || g.acknowledgedAt) return;
      acked.current.add(g.id);
      const revealType = planFor(g, quiet).revealType;
      updateDoc(doc(db, `students/${sid}/grants/${g.id}`), { acknowledgedAt: serverTimestamp(), skipped: !!skipped, revealType }).catch((e) => {
        acked.current.delete(g.id);
        console.warn('Reward acknowledgement failed', e);
      });
    },
    [sid, quiet]
  );

  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    onDone?.();
  }, [onDone]);

  // Phase timeline for the current grant.
  const doneFor = useRef(null);
  useEffect(() => {
    if (!plan || summary) return undefined;
    // Never replay a grant that already finished (e.g. a parent re-render).
    if (doneFor.current === grant.id) return undefined;
    const timers = [];
    setPhase(plan.chestMs ? 'chest' : 'reveal');
    if (plan.chestMs && soundOn) {
      rewardSfx.chestShake();
      timers.push(setTimeout(() => rewardSfx.chestOpen(), Math.max(0, plan.chestMs - 380)));
    }
    timers.push(
      setTimeout(() => {
        setPhase('reveal');
        if (soundOn) (plan.starsOnly ? rewardSfx.stars : rewardSfx[plan.tier] || rewardSfx.common)();
      }, plan.chestMs)
    );
    timers.push(
      setTimeout(() => {
        setPhase('done');
        doneFor.current = grant.id;
        ack(grant, false);
      }, plan.chestMs + plan.revealMs)
    );
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grant?.id, quiet, summary]);

  const next = useCallback(() => {
    if (grant && phase === 'done') ack(grant, false);
    if (index + 1 < list.length) {
      setPhase('chest');
      setIndex(index + 1);
    } else finish();
  }, [grant, phase, index, list.length, ack, finish]);

  const skip = useCallback(() => {
    // Everything not yet fully shown counts as skipped; the summary still shows it all.
    list.forEach((g, i) => {
      if (i > index || (i === index && phase !== 'done')) ack(g, true);
      else ack(g, false);
    });
    setSummary(true);
  }, [list, index, phase, ack]);

  // Focus trap, Escape = skip (or close the summary), body scroll lock.
  const dialogRef = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const prev = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
      prev?.focus?.();
    };
  }, []);
  useEffect(() => {
    const el = dialogRef.current;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (summary) finish();
        else skip();
      }
      if (e.key === 'Tab' && el) {
        const items = [...el.querySelectorAll('button, [href], [tabindex]:not([tabindex="-1"])')].filter((n) => !n.disabled);
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        } else if (!el.contains(document.activeElement)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [skip, finish, summary]);

  if (!list.length || !sid) return null;

  const body = (
    <div className={`qr-overlay ${quiet ? 'qr-quiet' : ''}`} style={{ '--rar': RARITY[plan?.tier]?.color || '#8a94a6' }}>
      <div className="qr-panel" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialogRef} tabIndex={-1}>
        {summary ? (
          <Summary list={list} theme={theme} titleId={titleId} onDone={finish} />
        ) : (
          <GrantView
            key={grant.id || index}
            grant={grant}
            plan={plan}
            phase={phase}
            index={index}
            total={list.length}
            theme={theme}
            student={student}
            titleId={titleId}
            quiet={quiet}
            soundOn={soundOn}
            onNext={next}
            onSkip={skip}
          />
        )}
      </div>
    </div>
  );
  return createPortal(body, document.body);
}

function GrantView({ grant, plan, phase, index, total, theme, student, titleId, quiet, soundOn, onNext, onSkip }) {
  const { item, starsOnly, tier, isChest, withChest } = plan;
  const done = phase === 'done';
  const revealed = phase !== 'chest';
  const name = item ? itemDisplayName(item, theme) : '';
  const last = index + 1 >= total;
  const continueRef = useRef(null);
  const skipRef = useRef(null);
  const [equip, setEquip] = useState({ busy: false, done: false, error: null });
  const [show, setShow] = useState({ busy: false, done: false, error: null });

  useEffect(() => {
    skipRef.current?.focus();
  }, []);
  useEffect(() => {
    if (done && (!document.activeElement || document.activeElement === document.body || document.activeElement === skipRef.current)) continueRef.current?.focus();
  }, [done]);

  const loadout = currentLoadout(student);
  const alreadyEquipped = item && loadout[item.slot] === item.id;
  const featured = student?.hall?.featuredItems || [];
  const alreadyShown = item && featured.includes(item.id);

  const onEquip = async () => {
    setEquip({ busy: true, done: false, error: null });
    try {
      await request('loadoutRequests', { action: 'equip', loadout: { ...currentLoadout(student), [item.slot]: item.id } });
      if (soundOn) rewardSfx.equip();
      setEquip({ busy: false, done: true, error: null });
    } catch (e) {
      setEquip({ busy: false, done: false, error: friendlyError(e) });
    }
  };
  const onShowcase = async () => {
    setShow({ busy: true, done: false, error: null });
    try {
      const hall = student?.hall || {};
      const items = [...(hall.featuredItems || []).filter((x) => x !== item.id), item.id].slice(-6);
      await updateDoc(doc(db, 'students', student.id), { hall: { ...hall, featuredItems: items } });
      setShow({ busy: false, done: true, error: null });
    } catch (e) {
      setShow({ busy: false, done: false, error: friendlyError(e) });
    }
  };

  const heading = !revealed
    ? isChest
      ? `Opening your ${chestName(grant.chestId, theme)}…`
      : 'Something is coming…'
    : starsOnly
      ? `+${grant.craftingStars || 0} Crafting Stars`
      : tier === 'mythic'
        ? 'Mythic find!'
        : tier === 'legendary'
          ? 'Legendary find!'
          : `New ${SLOT_LABEL[item.slot] || 'item'}!`;

  const legendaryPlus = tier === 'legendary' || tier === 'mythic';

  return (
    <div className={`qr-view qr-tier-${starsOnly ? 'stars' : tier} qr-phase-${phase}`} data-grant={grant.id}>
      <div className="qr-top">
        <span className="qr-count tabular" aria-hidden={total < 2}>
          {total > 1 ? `Reward ${index + 1} of ${total}` : isChest ? chestName(grant.chestId, theme) : 'New reward'}
        </span>
        <button type="button" ref={skipRef} className="btn btn-sm qr-skip" onClick={onSkip}>
          Skip <span className="kbd qr-kbd" aria-hidden>Esc</span>
        </button>
      </div>

      <div className="qr-stage" aria-hidden="true">
        <div className="qr-glow" />
        {(tier === 'legendary' || tier === 'mythic') && !starsOnly ? <Rays mythic={tier === 'mythic'} /> : null}
        {tier === 'mythic' && !starsOnly ? <div className="qr-mythic-ring" /> : null}
        {withChest ? (
          <div className="qr-chest">
            <ChestArt
              rarity={plan.chestRarity}
              state={phase === 'chest' ? 'opening' : 'open'}
              school={plan.school && isChest}
              theme={theme}
              size={170}
              reducedMotion={quiet}
            />
          </div>
        ) : null}
        {revealed ? (
          <div className={`qr-item ${withChest ? 'qr-item-from-chest' : ''}`}>
            {starsOnly && !item ? (
              <div className="qr-art qr-art-stars">
                <StarBurstArt size={150} />
              </div>
            ) : (
              <div className={`qr-card ${starsOnly ? 'qr-card-dup' : ''}`}>
                <ItemArt itemId={item.id} theme={theme} size={140} />
                {starsOnly ? <span className="qr-dup-stars">+{grant.craftingStars || 0} ✦</span> : null}
              </div>
            )}
          </div>
        ) : null}
        {revealed && !quiet && (tier === 'rare' || tier === 'epic' || legendaryPlus || starsOnly) ? (
          <div className="qr-particles">
            {PARTICLES.map((p, i) => (
              <span key={i} style={{ '--x': `${p.x}px`, '--y': `${p.y}px`, '--s': `${p.s}px`, animationDelay: `${p.delay}ms` }} />
            ))}
          </div>
        ) : null}
      </div>

      <div className="qr-info" aria-live="polite">
        <h2 id={titleId} className="qr-title">
          {heading}
        </h2>
        {revealed ? (
          starsOnly ? (
            <div className="stack qr-center" style={{ gap: 8 }}>
              {item ? <p className="qr-name">{name}</p> : null}
              <p className="qr-explain">
                {item
                  ? `You already had ${name}, so it turned into Crafting Stars.`
                  : 'You already had everything in this chest, so it turned into Crafting Stars.'}{' '}
                Spend them in My QuizBot to craft the exact item you want.
              </p>
            </div>
          ) : (
            <div className="stack qr-center" style={{ gap: 10 }}>
              <p className="qr-name">{name}</p>
              <div className="row" style={{ justifyContent: 'center', gap: 8 }}>
                <RarityChip rarity={tier} />
                <span className="chip chip-gray">{SLOT_LABEL[item.slot]}</span>
                <span className="chip chip-gray">{grantSourceLabel(grant)}</span>
              </div>
            </div>
          )
        ) : (
          <p className="qr-explain qr-center">Get ready…</p>
        )}
      </div>

      <div className="qr-actions">
        {done && !starsOnly && item ? (
          <>
            <button type="button" className="btn btn-primary" onClick={onEquip} disabled={equip.busy || equip.done || alreadyEquipped} aria-busy={equip.busy || undefined}>
              {equip.busy ? <span className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} aria-hidden /> : null}
              {equip.done || alreadyEquipped ? '✓ Equipped' : 'Equip now'}
            </button>
            <button
              type="button"
              className={`btn ${legendaryPlus ? 'btn-sun' : ''}`}
              onClick={onShowcase}
              disabled={show.busy || show.done || alreadyShown}
              aria-busy={show.busy || undefined}
            >
              {show.busy ? <span className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} aria-hidden /> : null}
              {show.done || alreadyShown ? '✓ In your Quiz Hall' : legendaryPlus ? 'Show it in your Quiz Hall' : 'Showcase'}
            </button>
          </>
        ) : null}
        {done ? (
          <button type="button" ref={continueRef} className={`btn ${starsOnly || !item ? 'btn-primary' : ''}`} onClick={onNext}>
            {last ? 'Continue' : 'Next reward'}
          </button>
        ) : null}
      </div>
      {equip.error || show.error ? (
        <p className="qr-error" role="alert">
          {equip.error || show.error}
        </p>
      ) : null}
      {equip.done ? (
        <p className="qr-ok" role="status">
          Your QuizBot is wearing it now.
        </p>
      ) : null}
    </div>
  );
}

function Rays({ mythic }) {
  return (
    <svg className={`qr-rays ${mythic ? 'qr-rays-mythic' : ''}`} viewBox="-100 -100 200 200" aria-hidden>
      {Array.from({ length: 12 }, (_, i) => (
        <path key={i} d="M0 0L-9 -100L9 -100Z" transform={`rotate(${i * 30})`} fill={mythic ? ['#ff4d4d', '#ffa62e', '#ffe14a', '#35d46b', '#3d9df5', '#a855f7'][i % 6] : '#ffd166'} opacity="0.55" />
      ))}
    </svg>
  );
}

function Summary({ list, theme, titleId, onDone }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  const stars = list.reduce((s, g) => s + (!g.itemId || g.duplicate ? g.craftingStars || 0 : 0), 0);
  return (
    <div className="qr-view qr-summary">
      <h2 id={titleId} className="qr-title">
        {list.length > 1 ? 'Your rewards' : 'Your reward'}
      </h2>
      <ul className="qr-summary-list">
        {list.map((g) => {
          const item = g.itemId ? ITEMS[g.itemId] : null;
          const dup = !item || g.duplicate;
          return (
            <li key={g.id} className="qr-summary-item" style={{ '--rar': RARITY[item?.rarity || g.chestRarity || 'common']?.color }}>
              {item ? <ItemArt itemId={item.id} theme={theme} size={64} /> : <StarBurstArt size={64} />}
              <div className="stack" style={{ gap: 4, minWidth: 0 }}>
                <strong>{item ? itemDisplayName(item, theme) : `${chestName(g.chestId, theme)}`}</strong>
                {dup ? (
                  <span className="caption">
                    {item ? 'Already had it: ' : 'All owned: '}+{g.craftingStars || 0} Crafting Stars
                  </span>
                ) : (
                  <span className="row" style={{ gap: 6 }}>
                    <RarityChip rarity={item.rarity} small />
                    <span className="caption">{SLOT_LABEL[item.slot]}</span>
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {stars ? <p className="qr-explain qr-center">Extras turn into Crafting Stars. Spend them in My QuizBot.</p> : null}
      <p className="caption qr-center">Everything is already in your collection.</p>
      <div className="qr-actions">
        <button type="button" ref={ref} className="btn btn-primary btn-lg" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}
