// Weekly summary for one linked child. Only this child's own data: no classmates, ranks, or leaderboards.
// Reads:  students/{studentId} (also feeds Quiz Hall highlights), sessionSummaries (studentId == id, completedAt in selected week)
// Writes: none
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Avatar, ButtonLink, Card, EmptyState, ErrorNote, Field, Loading, PageHeader, Stat, StrengthRow } from '../../components/ui.jsx';
import { summarize, useWeekSummaries, weekLabel, weekRange } from '../../components/parent/family.js';
import HallHighlights from '../../components/parent/HallHighlights.jsx';
import { useAuth } from '../../hooks/useAuth.jsx';
import { useDoc } from '../../hooks/useFirestore.js';
import { badgeById, categoryMeta, titleForLevel } from '../../lib/catalog.js';
import './parent.css';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEK_OPTIONS = [0, 1, 2, 3, 4];

function encouragement(activeDays, current, name) {
  if (activeDays === 0) {
    return current ? `No practice yet this week. Even a 10 minute round with ${name} counts.` : 'No practice that week. A fresh week is a fine place to start again.';
  }
  const days = `${activeDays} ${activeDays === 1 ? 'day' : 'days'}`;
  if (activeDays === 1) return `${name} played on 1 day ${current ? 'this' : 'that'} week. Every session adds up.`;
  if (activeDays <= 3) return `${name} played on ${days} ${current ? 'this' : 'that'} week. A steady rhythm helps facts stick.`;
  return `${name} played on ${days} ${current ? 'this' : 'that'} week. That is a strong habit to be proud of.`;
}

function strengthsAndGrowth(categories = {}) {
  const rows = Object.entries(categories)
    .filter(([, c]) => (c?.answered || 0) >= 5)
    .map(([id, c]) => ({ id, acc: Math.round(((c.correct || 0) / c.answered) * 100), answered: c.answered }))
    .sort((a, b) => b.acc - a.acc);
  const strengths = rows.slice(0, 2);
  const growth = rows.slice(2).slice(-2).reverse();
  return { strengths, growth };
}

function DayStrip({ days, start, current }) {
  const todayIdx = current ? (new Date().getDay() + 6) % 7 : -1;
  return (
    <ol className="fam-days" aria-label="Practice by day" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {days.map((d, i) => {
        const date = new Date(start);
        date.setDate(date.getDate() + i);
        const label = date.toLocaleDateString('en-US', { weekday: 'long' });
        return (
          <li
            key={i}
            className="fam-day"
            data-active={d.sessions > 0}
            data-today={i === todayIdx}
            aria-label={`${label}: ${d.sessions ? `${d.questions} questions` : 'no practice'}`}
          >
            <span className="fam-day-name">{DAY_NAMES[i]}</span>
            <span className="fam-day-mark" aria-hidden>
              {d.sessions ? '⭐' : '·'}
            </span>
            <span className="fam-day-count" aria-hidden>
              {d.sessions ? d.questions : ''}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export default function ChildSummary() {
  const { studentId } = useParams();
  const { claims } = useAuth();
  const linked = (claims.students || []).includes(studentId);
  const [offset, setOffset] = useState(0);
  const { start, end } = weekRange(offset);
  const student = useDoc(linked ? `students/${studentId}` : null);
  const week = useWeekSummaries(linked ? studentId : null, start, end);

  if (!linked) {
    return (
      <div className="page page-narrow">
        <EmptyState emoji="🔒" title="This child isn't linked to your account" action={<ButtonLink to="/family">Back to my family</ButtonLink>}>
          Link a child with the family code from their teacher.
        </EmptyState>
      </div>
    );
  }
  if (student.loading) return <Loading full label="Loading summary…" />;
  if (student.error) {
    return (
      <div className="page page-narrow">
        <ErrorNote error={student.error} />
      </div>
    );
  }
  if (!student.data) {
    return (
      <div className="page page-narrow">
        <EmptyState emoji="🗂️" title="Profile not found" action={<ButtonLink to="/family">Back to my family</ButtonLink>}>
          This profile may have been removed by the school.
        </EmptyState>
      </div>
    );
  }

  const child = student.data;
  const name = child.displayName || 'Your child';
  const s = summarize(week.data, start);
  const current = offset === 0;
  const level = child.level || 1;
  const { strengths, growth } = strengthsAndGrowth(child.stats?.categories);
  const cardsMeta = child.cards || {};
  const topicEmoji = (t) => categoryMeta(cardsMeta[t]?.category || s.topicCategory[t]).emoji;
  const streak = child.streak || {};

  return (
    <div className="page page-narrow stack-xl">
      <PageHeader
        eyebrow="Weekly summary"
        title={
          <span className="row" style={{ gap: 14 }}>
            <Avatar emoji={child.avatar} size="lg" />
            <span>
              {name}'s week <span aria-hidden>🌟</span>
            </span>
          </span>
        }
        subtitle={`Level ${level} ${child.title || titleForLevel(level)}`}
        actions={
          <Field label="Week">
            {(id) => (
              <select id={id} className="select" value={offset} onChange={(e) => setOffset(Number(e.target.value))}>
                {WEEK_OPTIONS.map((o) => (
                  <option key={o} value={o}>
                    {weekLabel(o)}
                  </option>
                ))}
              </select>
            )}
          </Field>
        }
      />

      {week.error ? <ErrorNote error={week.error} /> : null}
      {week.loading ? (
        <Loading label="Loading the week…" />
      ) : (
        <>
          <Card className="fam-week-card" aria-label={`${weekLabel(offset)} at a glance`}>
            <div className="fam-bignums">
              <div>
                <div className="fam-bignum" style={{ color: 'var(--purple)' }}>
                  {s.seen}
                </div>
                <div className="fam-bignum-label">Questions</div>
              </div>
              <div>
                <div className="fam-bignum" style={{ color: 'var(--teal)' }}>
                  {s.accuracy == null ? '0%' : `${s.accuracy}%`}
                </div>
                <div className="fam-bignum-label">Accuracy</div>
              </div>
            </div>
            <p className="prose" style={{ fontWeight: 700, textAlign: 'center', alignSelf: 'center' }}>
              {encouragement(s.activeDays, current, name)}
            </p>
            {s.badges.map((id) => {
              const b = badgeById(id);
              return (
                <div key={id} className="fam-badge-box">
                  <span className="fam-badge-kicker">
                    <span aria-hidden>{b?.emoji || '🏅'} </span>New badge
                  </span>
                  <span className="fam-badge-name">{b?.name || id}</span>
                  {b?.description ? <span className="muted">{b.description}</span> : null}
                </div>
              );
            })}
            <div className="stack" style={{ gap: 12 }}>
              <h2 style={{ fontSize: '1.125rem' }}>Learning {current ? 'this' : 'that'} week</h2>
              {s.topics.length ? (
                <div className="fam-topics">
                  {s.topics.map((t) => (
                    <span key={t} className="fam-topic">
                      <span aria-hidden>{topicEmoji(t)}</span>
                      {t}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="muted">Topics show up here after the first practice round.</p>
              )}
            </div>
          </Card>

          <Card className="stack-lg" aria-labelledby="days-title">
            <div className="row-between">
              <h2 id="days-title">Practice by day</h2>
              <span className="muted tabular">
                {s.sessions} {s.sessions === 1 ? 'session' : 'sessions'}
              </span>
            </div>
            <DayStrip days={s.days} start={start} current={current} />
          </Card>

          <div className="grid-2">
            <Card className="stack" aria-labelledby="streak-title">
              <h2 id="streak-title">
                <span aria-hidden>🔥 </span>Streak
              </h2>
              <div className="row" style={{ gap: 32 }}>
                <Stat value={streak.current || 0} label="Days now" color="var(--coral)" />
                <Stat value={streak.best || 0} label="Best ever" />
              </div>
            </Card>
            <Card className="stack" aria-labelledby="cards-title">
              <h2 id="cards-title">
                <span aria-hidden>🃏 </span>Knowledge cards
              </h2>
              {s.cards.length ? (
                <ul className="fam-list">
                  {s.cards.map((t) => (
                    <li key={t}>
                      <span aria-hidden>{topicEmoji(t)}</span>
                      <span style={{ fontWeight: 700 }}>{t}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">No new cards {current ? 'yet this week' : 'that week'}. Cards come from answering topic questions correctly.</p>
              )}
            </Card>
          </div>
        </>
      )}

      <HallHighlights child={child} />

      <Card className="stack-lg" aria-labelledby="strengths-title">
        <div className="stack" style={{ gap: 6 }}>
          <h2 id="strengths-title">Strengths and growing areas</h2>
          <p className="muted prose">Based on all of {name}'s practice so far.</p>
        </div>
        {strengths.length ? (
          <div className="grid-2">
            <div className="stack">
              <h3>Strong in</h3>
              {strengths.map((r) => (
                <StrengthRow key={r.id} label={r.id} emoji={categoryMeta(r.id).emoji} value={r.acc} color="var(--teal)" detail={`${r.answered} answered`} />
              ))}
            </div>
            <div className="stack">
              <h3>Growing in</h3>
              {growth.length ? (
                growth.map((r) => (
                  <StrengthRow key={r.id} label={r.id} emoji={categoryMeta(r.id).emoji} value={r.acc} color="var(--sun)" detail={`${r.answered} answered`} />
                ))
              ) : (
                <p className="muted">Try a few more categories to see where to grow next.</p>
              )}
            </div>
          </div>
        ) : (
          <p className="muted">After about 5 answers in a category, strengths show up here.</p>
        )}
      </Card>

      <div>
        <ButtonLink to="/family">Back to my family</ButtonLink>
      </div>
    </div>
  );
}
