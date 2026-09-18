// Family view of a child's Quiz Hall: their QuizBot, level, featured badge, adventure progress,
// and items earned this week. Only this child's own student doc; no classmates or rankings.
// Reads: nothing extra (the student doc is passed in). School gear uses the default theme colors
// because parents can't read schoolThemes/{schoolId}.
import { badgeById } from '../../lib/catalog.js';
import { ITEMS, RARITY, botEvolution, rewards, worldName } from '../../lib/rewards.js';
import { toMillis } from '../../lib/format.js';
import { ItemArt, QuizBot, itemDisplayName } from '../bot/index.js';
import { Card, Chip } from '../ui.jsx';
import { startOfWeek } from './family.js';

// Parents can't read schoolThemes, so school gear gets neutral names ("School Helmet") here.
const NAME_THEME = { mascotName: 'School', crestLetter: 'School' };

export default function HallHighlights({ child }) {
  const name = child.displayName || 'Your child';
  const level = child.level || 1;
  const evo = botEvolution(level);
  const badge = child.hall?.featuredBadge && (child.badges || []).includes(child.hall.featuredBadge) ? badgeById(child.hall.featuredBadge) : null;
  const mastered = child.masteredWorlds || [];
  const bosses = child.bossesDefeated || [];
  const dex = Object.keys(child.dex || {}).length;
  const weekStart = startOfWeek();
  const newItems = Object.entries(child.inventory || {})
    .filter(([id, v]) => ITEMS[id] && (toMillis(v?.earnedAt) || 0) >= weekStart)
    .sort((a, b) => (toMillis(b[1].earnedAt) || 0) - (toMillis(a[1].earnedAt) || 0))
    .map(([id]) => ITEMS[id]);

  return (
    <Card className="stack-lg" aria-labelledby="hall-title">
      <div className="stack" style={{ gap: 6 }}>
        <h2 id="hall-title">
          <span aria-hidden>🏛️ </span>Quiz Hall highlights
        </h2>
        <p className="muted prose">{name}'s QuizBot and what they've unlocked on their adventure.</p>
      </div>
      <div className="fam-hall">
        <div className="fam-hall-bot">
          <QuizBot loadout={{ ...rewards.starterLoadout, ...(child.loadout || {}) }} size={150} title={`${name}'s QuizBot`} />
          <strong className="fam-hall-title">{evo.title}</strong>
          <span className="caption">Level {level}</span>
        </div>
        <div className="stack fam-hall-body">
          {badge ? (
            <div className="fam-badge-box">
              <span className="fam-badge-kicker">
                <span aria-hidden>{badge.emoji || '🏅'} </span>Favorite badge
              </span>
              <span className="fam-badge-name">{badge.name}</span>
            </div>
          ) : null}
          <div className="fam-hall-stats">
            <div>
              <div className="fam-hall-num">{mastered.length}</div>
              <div className="fam-bignum-label">Worlds mastered</div>
            </div>
            <div>
              <div className="fam-hall-num">{bosses.length}</div>
              <div className="fam-bignum-label">Bosses defeated</div>
            </div>
            <div>
              <div className="fam-hall-num">{dex}</div>
              <div className="fam-bignum-label">QuizDex</div>
            </div>
          </div>
          {mastered.length ? (
            <div className="row" style={{ gap: 8 }}>
              {mastered.map((w) => (
                <Chip key={w} tone="sun">
                  ★ {worldName(w)}
                </Chip>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <div className="stack" style={{ gap: 12 }}>
        <h3>New gear this week</h3>
        {newItems.length ? (
          <ul className="fam-items">
            {newItems.map((it) => (
              <li key={it.id}>
                <ItemArt itemId={it.id} size={56} title={itemDisplayName(it, NAME_THEME)} />
                <span className="stack" style={{ gap: 2, minWidth: 0 }}>
                  <strong>{itemDisplayName(it, NAME_THEME)}</strong>
                  <span className="caption">{RARITY[it.rarity]?.name}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No new gear yet this week. Finishing quests and opening chests earns new pieces.</p>
        )}
      </div>
    </Card>
  );
}
