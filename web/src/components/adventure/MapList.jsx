// List view of the overworld: every world, star and chest with the same info and actions.
import { Check, Crown, Lock } from 'lucide-react';
import { ChestArt } from '../bot/index.js';
import { MAP, gateInfo, objectInfo, starText } from './mapModel.js';

export default function MapList({ student, theme, selectedWorld, playerWorld, busyObject, reducedMotion, onSelectGate, onClaim }) {
  const worlds = MAP.entrances.map((e) => ({ e, info: gateInfo(e.world, student) }));
  const stars = MAP.stars.map((s) => ({ s, info: objectInfo(s, 'star', student) }));
  const chests = MAP.chests.map((c) => ({ c, info: objectInfo(c, 'chest', student) }));

  return (
    <div className="adv-list">
      <section aria-labelledby="adv-list-worlds">
        <h2 id="adv-list-worlds" className="adv-list-h">
          Worlds
        </h2>
        <ul className="adv-list-grid">
          {worlds.map(({ e, info }) => {
            const st = info.ws.state;
            return (
              <li key={e.id} className={`adv-row adv-row--${st} ${selectedWorld === e.world ? 'is-selected' : ''}`}>
                <span className="adv-row-emoji" aria-hidden="true">
                  {info.world?.emoji}
                </span>
                <span className="adv-row-main">
                  <strong>
                    {info.name} {playerWorld === e.world ? <span className="adv-here">You are here</span> : null}
                  </strong>
                  <span className="adv-row-sub">
                    {st === 'locked' ? (
                      <>
                        <Lock size={14} aria-hidden /> {info.ws.unlock.label} ({info.ws.unlock.have} of {info.ws.unlock.need})
                      </>
                    ) : (
                      <>
                        {st === 'mastered' ? <Crown size={14} aria-hidden /> : null}
                        <span className="adv-gold" aria-label={`${info.stars} of 3 stars`}>
                          {starText(info.stars)}
                        </span>{' '}
                        {info.stateText} · {info.ws.quests} {info.ws.quests === 1 ? 'quest' : 'quests'}
                      </>
                    )}
                  </span>
                </span>
                <button type="button" className={`btn ${st === 'locked' ? '' : 'btn-primary'}`} onClick={() => onSelectGate(e.world)} aria-label={`Open ${info.name}`}>
                  {st === 'locked' ? 'Details' : 'Open'}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="adv-list-stars">
        <h2 id="adv-list-stars" className="adv-list-h">
          Quest Stars
        </h2>
        <ul className="adv-list-grid">
          {stars.map(({ s, info }) => (
            <li key={s.id} className={`adv-row ${info.claimed ? 'is-done' : ''}`}>
              <span className="adv-row-emoji adv-gold" aria-hidden="true">
                ★
              </span>
              <span className="adv-row-main">
                <strong>{info.name}</strong>
                <span className="adv-row-sub">{info.claimed ? 'Collected' : info.ready ? 'Ready to collect' : info.req}</span>
              </span>
              {info.claimed ? (
                <span className="adv-done" aria-hidden="true">
                  <Check size={18} strokeWidth={3} />
                </span>
              ) : (
                <button type="button" className="btn btn-sun" disabled={!info.ready || busyObject === s.id} aria-busy={busyObject === s.id || undefined} onClick={() => onClaim(s, 'star')} aria-label={`Collect ${info.name}`}>
                  {busyObject === s.id ? 'Collecting...' : 'Collect'}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="adv-list-chests">
        <h2 id="adv-list-chests" className="adv-list-h">
          Chests
        </h2>
        <ul className="adv-list-grid">
          {chests.map(({ c, info }) => (
            <li key={c.id} className={`adv-row ${info.claimed ? 'is-done' : ''}`}>
              <span className="adv-row-chest" aria-hidden="true">
                <ChestArt rarity={info.rarity} state={info.claimed ? 'open' : info.ready ? 'ready' : 'closed'} theme={theme} size={52} reducedMotion={reducedMotion} title="" />
              </span>
              <span className="adv-row-main">
                <strong>{info.name}</strong>
                <span className="adv-row-sub">
                  <span className={`adv-rarity adv-rarity--${info.rarity}`}>{info.rarity}</span> {info.claimed ? 'Opened' : info.ready ? 'Ready to open' : info.req}
                </span>
              </span>
              {info.claimed ? (
                <span className="adv-done" aria-hidden="true">
                  <Check size={18} strokeWidth={3} />
                </span>
              ) : (
                <button type="button" className="btn btn-sun" disabled={!info.ready || busyObject === c.id} aria-busy={busyObject === c.id || undefined} onClick={() => onClaim(c, 'chest')} aria-label={`Open ${info.name}`}>
                  {busyObject === c.id ? 'Opening...' : 'Open'}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
