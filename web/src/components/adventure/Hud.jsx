// Map overlay: player card (top-left) and quick links (top-right).
import { forwardRef } from 'react';
import { Link } from 'react-router-dom';
import { Bot, Flame, Gift, ScrollText, Shield, Sparkles, Star, Trophy } from 'lucide-react';
import { QuizBot } from '../bot/index.js';
import { botEvolution } from '../../lib/rewards.js';
import { levelProgress } from '../../lib/catalog.js';

export const PlayerCard = forwardRef(function PlayerCard({ student, loadout, theme, reducedMotion, showStreak, pendingCount, starBump }, starRef) {
  const lp = levelProgress(student.xp || 0);
  const evo = botEvolution(lp.level);
  const streak = student.streak?.current || 0;
  const pct = Math.max(0, Math.min(100, lp.pct || 0));
  return (
    <section className="adv-hud" aria-label="Your explorer">
      <span className="adv-hud-avatar" aria-hidden="true">
        <QuizBot loadout={loadout} theme={theme} size={104} pose="static" reducedMotion={reducedMotion} title="" />
      </span>
      <div className="adv-hud-id">
        <strong className="adv-hud-name">{student.displayName}</strong>
        <span className="adv-hud-level">
          Lv {lp.level} · {evo.title}
        </span>
        <div className="adv-xp" role="progressbar" aria-valuemin={0} aria-valuemax={lp.needed} aria-valuenow={lp.into} aria-label={`Level ${lp.level}. ${lp.needed - lp.into} XP to level ${lp.level + 1}`} title={`${lp.into} / ${lp.needed} XP`}>
          <span style={{ transform: `scaleX(${pct / 100})` }} />
        </div>
      </div>
      <div className="adv-hud-stats">
        <span className={`adv-stat adv-stat--quest ${starBump ? 'is-bump' : ''}`} ref={starRef} title="Quest Stars">
          <Star size={16} fill="currentColor" aria-hidden /> <b className="tabular">{student.questStars || 0}</b>
          <span className="sr-only"> Quest Stars</span>
        </span>
        <span className="adv-stat adv-stat--craft" title="Crafting Stars">
          <Sparkles size={16} aria-hidden /> <b className="tabular">{student.craftingStars || 0}</b>
          <span className="sr-only"> Crafting Stars</span>
        </span>
        {showStreak ? (
          <span className="adv-stat adv-stat--streak" title="Day streak">
            <Flame size={16} aria-hidden /> <b className="tabular">{streak}</b>
            <span className="sr-only"> day streak</span>
          </span>
        ) : null}
        <Link to="/play/vault" className={`adv-vault ${pendingCount ? 'has-items' : ''}`} aria-label={pendingCount ? `Vault, ${pendingCount} ${pendingCount === 1 ? 'reward' : 'rewards'} waiting` : 'Vault'}>
          <Gift size={17} aria-hidden />
          <span aria-hidden="true">
            {pendingCount ? (
              <>
                {pendingCount} {pendingCount === 1 ? 'reward' : 'rewards'}
                <span className="adv-vault-extra"> waiting</span>
              </>
            ) : (
              'Vault'
            )}
          </span>
        </Link>
      </div>
    </section>
  );
});

export function QuickLinks({ questsAlert, questsAlertLabel }) {
  const links = [
    { to: '/play/home', label: 'Quests', icon: ScrollText, alert: questsAlert, alertLabel: questsAlertLabel },
    { to: '/play/garage', label: 'Garage', icon: Bot },
    { to: '/play/hall', label: 'Quiz Hall', icon: Trophy },
    { to: '/play/team', label: 'Team HQ', icon: Shield }
  ];
  return (
    <nav className="adv-quick" aria-label="Adventure shortcuts">
      {links.map((l) => (
        <Link key={l.to} to={l.to} className="adv-quick-btn" aria-label={l.alert ? `${l.label}, ${l.alertLabel}` : l.label}>
          <l.icon size={20} aria-hidden />
          <span className="adv-quick-label">{l.label}</span>
          {l.alert ? <span className="adv-dot" aria-hidden="true" /> : null}
        </Link>
      ))}
    </nav>
  );
}
