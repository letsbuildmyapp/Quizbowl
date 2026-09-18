// Side sheet (desktop) / bottom sheet (phone) for one world: creatures + battle actions.
import { useEffect, useRef } from 'react';
import { Award, BookOpen, Check, Crown, Lock, Swords, X, Zap } from 'lucide-react';
import { BuzzerArt } from '../bot/index.js';
import { ProgressBar, friendlyError } from '../ui.jsx';
import { rewards, rivalsForWorld } from '../../lib/rewards.js';
import { WORLD_BY_ID, gateInfo, starText } from './mapModel.js';

const MASTERY_QUESTS = rewards.worldRules.masteryQuests;
const MASTERY_PCT = Math.round(rewards.worldRules.masteryAccuracy * 100);

export default function WorldPanel({ worldId, student, theme, busy, error, reducedMotion, autoFocus = true, onStart, onClose, onGoTo }) {
  const headingRef = useRef(null);
  const info = gateInfo(worldId, student);
  const { world, ws } = info;
  const locked = ws.state === 'locked';
  const req = rewards.worldUnlocks[worldId];

  useEffect(() => {
    if (autoFocus) headingRef.current?.focus({ preventScroll: true });
  }, [worldId, autoFocus]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !busy && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const rivals = rivalsForWorld(worldId);
  const wild = rivals.filter((r) => r.kind === 'wild');
  const boss = rivals.find((r) => r.kind === 'boss');
  const dex = student?.dex || {};

  return (
    <aside className="adv-panel" role="dialog" aria-modal="false" aria-labelledby="adv-panel-title" style={{ '--world': rivals[0]?.color || 'var(--purple)' }}>
      <div className="adv-panel-grip" aria-hidden="true" />
      <header className="adv-panel-head">
        <span className="adv-panel-emoji" aria-hidden="true">
          {world?.emoji}
        </span>
        <div className="adv-panel-titles">
          <h2 id="adv-panel-title" ref={headingRef} tabIndex={-1}>
            {info.name}
          </h2>
          <span className={`adv-state adv-state--${ws.state}`}>
            {locked ? <Lock size={14} aria-hidden /> : ws.state === 'mastered' ? <Crown size={14} aria-hidden /> : null}
            {locked ? 'Locked' : info.stateText}
          </span>
        </div>
        <button type="button" className="btn btn-ghost btn-icon adv-panel-close" onClick={onClose} aria-label="Close world panel" disabled={busy}>
          <X size={22} aria-hidden />
        </button>
      </header>

      <div className="adv-panel-body">
        <p className="adv-blurb">{world?.blurb}</p>

        <div className="adv-facts">
          <div className="adv-fact">
            <span className="adv-fact-value adv-gold" aria-label={`${info.stars} of 3 stars`}>
              {starText(info.stars)}
            </span>
            <span className="adv-fact-label">Stars</span>
          </div>
          <div className="adv-fact">
            <span className="adv-fact-value tabular">{ws.quests}</span>
            <span className="adv-fact-label">{ws.quests === 1 ? 'Quest done' : 'Quests done'}</span>
          </div>
          <div className="adv-fact">
            <span className="adv-fact-value">{ws.state === 'mastered' ? <Crown size={24} aria-label="Mastered" /> : `${Math.min(ws.quests, MASTERY_QUESTS)}/${MASTERY_QUESTS}`}</span>
            <span className="adv-fact-label">{ws.state === 'mastered' ? 'Mastered' : 'To master'}</span>
          </div>
        </div>
        {ws.state !== 'mastered' && !locked ? (
          <p className="caption">
            Master it: finish {MASTERY_QUESTS} quests here and get {MASTERY_PCT}% right.
          </p>
        ) : null}

        {locked ? (
          <section className="adv-locked" aria-label="How to unlock">
            <strong className="adv-locked-title">
              <Lock size={18} aria-hidden /> {ws.unlock.label} to open this world
            </strong>
            <ProgressBar value={ws.unlock.have} max={ws.unlock.need} label={`${ws.unlock.have} of ${ws.unlock.need} done`} />
            <span className="caption tabular">
              {ws.unlock.have} of {ws.unlock.need} done
            </span>
            {req?.world ? (
              <button type="button" className="btn btn-primary btn-lg btn-block" onClick={() => onGoTo(req.world)}>
                Go to {WORLD_BY_ID[req.world]?.emoji} {WORLD_BY_ID[req.world]?.name}
              </button>
            ) : null}
          </section>
        ) : null}

        <section aria-labelledby="adv-creatures">
          <h3 id="adv-creatures" className="adv-h3">
            Creatures here
          </h3>
          <ul className="adv-creatures">
            {wild.map((r) => (
              <Creature key={r.id} rival={r} beaten={!!dex[r.id]} locked={locked} />
            ))}
            {boss ? <Creature rival={boss} beaten={ws.bossDefeated || !!dex[boss.id]} locked={locked} boss /> : null}
          </ul>
        </section>

        {!locked ? (
          <section className="adv-actions" aria-label="Battles">
            {busy ? (
              <div className="adv-loading" role="status" aria-live="polite">
                <span className={`adv-loading-buzzer ${reducedMotion ? '' : 'is-spinning'}`}>
                  <BuzzerArt state="ready" theme={theme} size={84} reducedMotion={reducedMotion} />
                </span>
                <strong>{busy === 'practice' ? 'Setting up practice...' : busy === 'boss' ? 'The boss is getting ready...' : 'A wild creature appears...'}</strong>
                <span className="caption">Picking your questions</span>
              </div>
            ) : (
              <>
                <button type="button" className="adv-action adv-action--wild" onClick={() => onStart('wild')}>
                  <Swords size={24} aria-hidden />
                  <span>
                    <strong>Wild encounter</strong>
                    <small>{rewards.battles.wild.count} questions</small>
                  </span>
                </button>
                <button type="button" className="adv-action adv-action--boss" onClick={() => ws.bossReady && onStart('boss')} aria-disabled={!ws.bossReady} aria-describedby={!ws.bossReady ? 'adv-boss-need' : undefined}>
                  {ws.bossDefeated ? <Award size={24} aria-hidden /> : <Zap size={24} aria-hidden />}
                  <span>
                    <strong>{ws.bossDefeated ? 'Boss rematch' : 'Boss battle'}</strong>
                    <small>{ws.bossReady ? `${rewards.battles.boss.count} questions` : `${Math.min(ws.quests, rewards.battles.boss.requiresQuests)} of ${rewards.battles.boss.requiresQuests} quests`}</small>
                  </span>
                  {!ws.bossReady ? <Lock size={18} className="adv-action-lock" aria-hidden /> : null}
                </button>
                {!ws.bossReady ? (
                  <p id="adv-boss-need" className="caption adv-boss-need">
                    {ws.bossLabel}.
                  </p>
                ) : null}
                <button type="button" className="adv-action adv-action--practice" onClick={() => onStart('practice')}>
                  <BookOpen size={24} aria-hidden />
                  <span>
                    <strong>Practice</strong>
                    <small>5 questions, no timer</small>
                  </span>
                </button>
              </>
            )}
            {error ? (
              <p className="adv-error" role="alert">
                {friendlyError(error)}
              </p>
            ) : null}
          </section>
        ) : null}
      </div>
    </aside>
  );
}

function Creature({ rival, beaten, locked, boss }) {
  return (
    <li className={`adv-creature ${boss ? 'is-boss' : ''} ${beaten ? 'is-beaten' : ''} ${locked ? 'is-locked' : ''}`} style={{ '--c': rival.color }}>
      <span className="adv-creature-img">
        <img src={rival.image} alt="" width="72" height="72" loading="lazy" decoding="async" />
        {beaten ? (
          <span className="adv-creature-check" title="Beaten">
            <Check size={14} strokeWidth={3.4} aria-hidden />
          </span>
        ) : null}
      </span>
      <span className="adv-creature-name">{rival.name}</span>
      <span className="adv-creature-kind">{boss ? (beaten ? 'Champion!' : 'Boss') : beaten ? 'Beaten' : 'Wild'}</span>
      <span className="sr-only">{beaten ? ', beaten' : ', not beaten yet'}</span>
    </li>
  );
}
