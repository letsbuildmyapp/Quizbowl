// Larger shared widgets for the collection screens.
import { rewards, RARITY, unlockLabel, botEvolution } from '../../lib/rewards.js';
import { ItemArt, QuizBot, itemDisplayName } from '../bot/index.js';
import { Button } from '../ui.jsx';
import { CheckIcon, LockIcon, RarityChip, craftCost, lockProgress, rarityColor } from './parts.jsx';

/** QuizBot on a glowing themed platform. `tint` colors the stage (defaults to purple). */
export function BotStage({ loadout, theme, size = 250, pose = 'idle', reducedMotion, title, tint, className = '', children, botKey }) {
  return (
    <div className={`qc-stage ${className}`} style={tint ? { '--stage': tint } : undefined}>
      <div className="qc-platform" aria-hidden />
      <div className="qc-bot">
        <QuizBot key={botKey} loadout={loadout} theme={theme} size={size} pose={pose} reducedMotion={reducedMotion} title={title} />
      </div>
      {children}
    </div>
  );
}

/**
 * One locker tile. The main button previews; the craft button (locked chest items) is separate.
 * status: { owned, equipped, isNew }
 */
export function ItemTile({ item, theme, status, previewing, student, craftingStars, onPreview, onCraft }) {
  const name = itemDisplayName(item, theme);
  const locked = !status.owned;
  const prog = locked ? lockProgress(item, student) : null;
  const cost = locked ? craftCost(item) : null;
  const short = cost ? Math.max(0, cost - (craftingStars || 0)) : 0;
  const stateText = status.equipped ? 'Equipped' : status.owned ? 'Owned' : 'Locked';
  return (
    <li
      className={`qc-tile ${locked ? 'qc-tile-locked' : ''} ${previewing ? 'qc-tile-previewing' : ''}`}
      style={{ '--rar': rarityColor(item.rarity) }}
    >
      {status.isNew ? (
        <span className="qc-ribbon-new" aria-hidden>
          New!
        </span>
      ) : null}
      <span className={`qc-badge-state qc-state-${stateText.toLowerCase()}`} aria-hidden>
        {status.equipped ? <CheckIcon size={12} /> : locked ? <LockIcon size={11} /> : null}
        {stateText}
      </span>
      <button
        type="button"
        className="qc-tile-main"
        aria-pressed={!!previewing}
        aria-label={`${name}, ${RARITY[item.rarity]?.name || ''} ${status.isNew ? ', new' : ''}, ${stateText}${locked ? `. ${unlockLabel(item)}` : ''}. Preview on your QuizBot`}
        onClick={() => onPreview(item)}
      >
        <span className="qc-tile-art">
          <ItemArt itemId={item.id} theme={theme} size={84} />
        </span>
        <span className="qc-tile-name">{name}</span>
        <RarityChip rarity={item.rarity} small />
      </button>
      {locked ? (
        <div className="qc-tile-foot">
          <span className="qc-lockline">
            <LockIcon size={13} />
            <span>{unlockLabel(item)}</span>
          </span>
          {prog && prog.have >= prog.need ? (
            <span className="caption" style={{ color: 'var(--green)', fontWeight: 800 }}>
              You did it! It unlocks after your next quest.
            </span>
          ) : prog ? (
            <>
              <div className="qc-mini-bar" role="progressbar" aria-valuemin={0} aria-valuemax={prog.need} aria-valuenow={prog.have} aria-label={`${name} unlock progress`}>
                <span style={{ width: `${Math.round((prog.have / prog.need) * 100)}%` }} />
              </div>
              <span className="caption tabular">
                {prog.unit === 'level' ? `Level ${prog.have} of ${prog.need}` : `${prog.have} of ${prog.need} ${prog.unit}`}
              </span>
            </>
          ) : null}
          {cost ? (
            <>
              <Button size="sm" variant={short ? 'default' : 'sun'} className="qc-craft" disabled={short > 0} onClick={() => onCraft(item)}>
                Craft for {cost} ✦
              </Button>
              {short > 0 ? <span className="caption">Need {short} more Crafting Stars</span> : null}
            </>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/** Rookie Bot → Explorer Bot → … with the student's own bot at each reached stage. */
export function EvolutionTrack({ level = 1, loadout, theme }) {
  const evos = rewards.botEvolutions;
  const current = botEvolution(level);
  const idx = evos.findIndex((e) => e.title === current.title);
  const next = evos[idx + 1];
  // Fill between node centers: nodes sit at 10%, 30%, ..., 90%.
  const seg = idx + (next ? Math.min(1, (level - current.minLevel) / (next.minLevel - current.minLevel)) : 0);
  const fillPct = (seg / (evos.length - 1)) * 80;
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="qc-evo-wrap">
      <span className="qc-evo-fill" style={{ width: `${fillPct}%` }} aria-hidden />
      <ol className="qc-evo" aria-label="QuizBot evolution">
        {evos.map((e, i) => {
          const state = i < idx ? 'reached' : i === idx ? 'current' : 'future';
          return (
            <li key={e.title} className={`qc-evo-${state}`} aria-current={state === 'current' ? 'step' : undefined}>
              <span className="qc-evo-node">
                <QuizBot loadout={loadout} theme={theme} size={i === idx ? 52 : 44} pose="static" title={e.title} />
              </span>
              <span className="qc-evo-title">{e.title}</span>
              <span className="qc-evo-level">
                {state === 'current' ? 'You are here' : state === 'reached' ? 'Reached' : `Level ${e.minLevel}`}
              </span>
            </li>
          );
        })}
      </ol>
      </div>
      <p className="caption" style={{ textAlign: 'center', fontWeight: 700 }}>
        {next ? `Level ${level}. Reach level ${next.minLevel} to become ${/^[AEIOU]/.test(next.title) ? 'an' : 'a'} ${next.title}.` : `Level ${level}. Your QuizBot is fully evolved!`}
      </p>
    </div>
  );
}
