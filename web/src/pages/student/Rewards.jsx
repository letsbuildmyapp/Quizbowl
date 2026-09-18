// Rewards (/play/rewards): level + XP, badges, knowledge cards, world stars, latest unlock.
// Firestore reads: students/{id} (live, via useAuth)
// Firestore writes: none
import { Link } from 'react-router-dom';
import { BADGES, WORLDS, badgeById, categoryMeta, levelProgress } from '../../lib/catalog.js';
import { fmtDate, fmtNum } from '../../lib/format.js';
import { Card, EmptyState, ButtonLink, PageHeader, ProgressBar } from '../../components/ui.jsx';
import { DAY_MS, Stars, StudentGate, worldProgress } from '../../components/student/common.jsx';
import './student.css';

export default function Rewards() {
  return <StudentGate>{(student) => <RewardsBody student={student} />}</StudentGate>;
}

function RewardsBody({ student }) {
  const lp = levelProgress(student.xp || 0);
  const earned = new Set(student.badges || []);
  const earnedCount = BADGES.filter((b) => earned.has(b.id)).length;
  const cards = Object.entries(student.cards || {}).sort((a, b) => (b[1].firstAt || 0) - (a[1].firstAt || 0));
  const latest = student.latestUnlock && Date.now() - (student.latestUnlock.at || 0) < 3 * DAY_MS ? student.latestUnlock : null;
  const newCards = new Set(latest?.cards || []);

  return (
    <div className="page stack-xl">
      <PageHeader eyebrow="Rewards" title="Your trophy room" subtitle="Badges, cards, and stars you've earned on your quests." />

      <Card tone="hero">
        <div className="stack">
          <div className="qq-level">
            <span className="qq-level-num" aria-hidden>
              {lp.level}
            </span>
            <div className="stack" style={{ gap: 4 }}>
              <span className="eyebrow" style={{ color: 'rgb(255 255 255 / 0.85)' }}>
                Level {lp.level}
              </span>
              <h2 style={{ fontSize: '1.75rem' }}>{student.title || lp.title}</h2>
              <span className="tabular" style={{ fontWeight: 800 }}>
                {fmtNum(student.xp || 0)} XP total
              </span>
            </div>
          </div>
          <ProgressBar value={lp.into} max={lp.needed} label={`Progress to level ${lp.level + 1}`} height={16} />
          <span className="caption tabular">
            {fmtNum(lp.needed - lp.into)} XP to level {lp.level + 1}
          </span>
        </div>
      </Card>

      {latest && (latest.worlds?.length || latest.badges?.length || latest.cards?.length) ? <LatestUnlock latest={latest} /> : null}

      <section className="stack" aria-labelledby="badges-h">
        <div className="qq-section-title">
          <h2 id="badges-h">Badges</h2>
          <span className="chip tabular">
            {earnedCount} of {BADGES.length} earned
          </span>
        </div>
        <ul className="qq-badges" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {BADGES.map((b) => {
            const has = earned.has(b.id);
            return (
              <li key={b.id} className={`qq-badge ${has ? '' : 'qq-badge-locked'}`}>
                <span className="qq-badge-emoji" aria-hidden>
                  {b.emoji}
                </span>
                <strong>{b.name}</strong>
                {has ? (
                  <>
                    <span className="caption" style={{ color: 'var(--ink-2)' }}>
                      {b.description}
                    </span>
                    <span className="chip chip-green">
                      <span aria-hidden>✓</span> Earned
                    </span>
                  </>
                ) : (
                  <>
                    <span className="caption">Goal: {b.description}</span>
                    <span className="chip chip-gray">
                      <span aria-hidden>🔒</span> Locked
                    </span>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="stack" aria-labelledby="cards-h">
        <div className="qq-section-title">
          <h2 id="cards-h">Knowledge cards</h2>
          <span className="chip tabular">{cards.length} collected</span>
        </div>
        {cards.length ? (
          <ul className="qq-cards" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {cards.map(([topic, c]) => {
              const m = categoryMeta(c.category);
              const isNew = newCards.has(topic);
              return (
                <li key={topic} className={`qq-kcard ${isNew ? 'qq-kcard-new' : ''}`} style={{ '--cat': m.color }}>
                  <span className="qq-kcard-count" aria-label={`Collected ${c.count} times`}>
                    x{c.count}
                  </span>
                  <span className="qq-kcard-emoji" aria-hidden>
                    {m.emoji}
                  </span>
                  <div className="stack" style={{ gap: 4 }}>
                    <span className="qq-kcard-topic">{topic}</span>
                    <span className="caption">
                      {c.category}
                      {isNew ? ' · New!' : ` · ${fmtDate(c.firstAt)}`}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState emoji="🃏" title="No cards yet" action={<ButtonLink to="/play/worlds" variant="primary" size="lg">Start a quest</ButtonLink>}>
            Answer a question right to collect a card for its topic.
          </EmptyState>
        )}
      </section>

      <section className="stack" aria-labelledby="worlds-h">
        <div className="qq-section-title">
          <h2 id="worlds-h">World stars</h2>
          <span className="chip chip-sun tabular">
            <span aria-hidden>★</span> {student.totalStars || 0} total
          </span>
        </div>
        <div className="grid-3">
          {WORLDS.map((w) => {
            const p = worldProgress(w, student);
            return (
              <Card key={w.id} tight className="row-between">
                <span className="row" style={{ fontWeight: 800, gap: 8 }}>
                  <span aria-hidden>{w.emoji}</span>
                  {w.name}
                </span>
                {p.unlocked ? (
                  <Stars count={p.stars} />
                ) : (
                  <span className="chip chip-gray">
                    <span aria-hidden>🔒</span> Locked
                  </span>
                )}
              </Card>
            );
          })}
        </div>
        <Link to="/play/worlds" style={{ fontWeight: 800 }}>
          Go to the world map
        </Link>
      </section>
    </div>
  );
}

function LatestUnlock({ latest }) {
  const worlds = (latest.worlds || []).map((id) => WORLDS.find((w) => w.id === id)).filter(Boolean);
  const badges = (latest.badges || []).map(badgeById).filter(Boolean);
  const cards = latest.cards || [];
  return (
    <Card tone="sun" aria-labelledby="latest-h">
      <div className="stack">
        <h2 id="latest-h">
          <span aria-hidden className="qq-ico">🎉</span>Just unlocked
        </h2>
        <div className="row" style={{ gap: 8 }}>
          {worlds.map((w) => (
            <span key={w.id} className="chip chip-teal">
              <span aria-hidden>{w.emoji}</span> New world: {w.name}
            </span>
          ))}
          {badges.map((b) => (
            <span key={b.id} className="chip chip-sun">
              <span aria-hidden>{b.emoji}</span> Badge: {b.name}
            </span>
          ))}
          {cards.map((t) => (
            <span key={t} className="chip">
              <span aria-hidden>🃏</span> Card: {t}
            </span>
          ))}
        </div>
      </div>
    </Card>
  );
}
