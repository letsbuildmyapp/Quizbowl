// Worlds (/play/worlds): illustrated world map + a card per world.
// Firestore reads: students/{id} (live, via useAuth)
// Firestore writes: sessionRequests (via startSession) for Quest / Battle
import { useRef } from 'react';
import { WORLDS, categoryMeta } from '../../lib/catalog.js';
import { prefersReducedMotion } from '../../hooks/useAccessibility.js';
import { Button, ErrorNote, PageHeader, ProgressBar } from '../../components/ui.jsx';
import { Stars, StudentGate, useStartMatch, worldProgress } from '../../components/student/common.jsx';
import './student.css';

// Pin positions (% of the image) for the worlds painted on world-map.webp.
const PINS = {
  'space-station': { x: 21, y: 24 },
  'geography-galaxy': { x: 50, y: 17 },
  'history-kingdom': { x: 80, y: 22 },
  'science-lab': { x: 17, y: 72 },
  'literature-forest': { x: 76, y: 76 }
};

export default function Worlds() {
  return <StudentGate>{(student) => <WorldsBody student={student} />}</StudentGate>;
}

function WorldsBody({ student }) {
  const match = useStartMatch();
  const cardRefs = useRef({});
  const totalStars = student.totalStars || 0;

  const jumpTo = (id) => {
    const el = cardRefs.current[id];
    if (!el) return;
    el.scrollIntoView({ behavior: prefersReducedMotion(student.settings) ? 'auto' : 'smooth', block: 'center' });
    el.focus({ preventScroll: true });
  };

  return (
    <div className="page stack-lg">
      <PageHeader
        eyebrow="World map"
        title="Choose a world"
        subtitle="Complete quests. Unlock the next adventure."
        actions={
          <span className="chip chip-sun tabular" style={{ fontSize: '1rem', minHeight: 40 }}>
            <span aria-hidden>★</span> {totalStars} total stars
          </span>
        }
      />

      <div className="qq-map">
        <img src="/art/world-map.webp" alt="Illustrated map of the QuizQuest worlds" width="1536" height="1024" />
        {WORLDS.filter((w) => PINS[w.id]).map((w) => {
          const p = worldProgress(w, student);
          const meta = categoryMeta(w.category);
          return (
            <button
              key={w.id}
              type="button"
              className={`qq-pin ${p.unlocked ? '' : 'qq-pin-locked'}`}
              style={{ left: `${PINS[w.id].x}%`, top: `${PINS[w.id].y}%`, '--pin': meta.color }}
              onClick={() => jumpTo(w.id)}
              aria-label={`${w.name}: ${p.unlocked ? `${p.stars} of 3 stars` : 'locked'}`}
            >
              <span className="qq-pin-emoji" aria-hidden>
                {p.unlocked ? w.emoji : '🔒'}
              </span>
              <span className="qq-pin-text" aria-hidden>
                {w.name}
              </span>
            </button>
          );
        })}
      </div>

      <ErrorNote>{match.error?.message}</ErrorNote>

      <div className="grid-3">
        {WORLDS.map((w) => (
          <WorldCard key={w.id} world={w} student={student} match={match} totalStars={totalStars} refFn={(el) => (cardRefs.current[w.id] = el)} />
        ))}
      </div>
    </div>
  );
}

function WorldCard({ world, student, match, totalStars, refFn }) {
  const p = worldProgress(world, student);
  const meta = categoryMeta(world.category);
  const questKey = `${world.id}:quest`;
  const battleKey = `${world.id}:battle`;
  const starting = match.busy != null;
  const headingId = `world-${world.id}-name`;

  return (
    <section
      ref={refFn}
      tabIndex={-1}
      aria-labelledby={headingId}
      className={`card qq-world-card ${p.unlocked ? '' : 'qq-world-locked'}`}
      style={{ '--cat': meta.color }}
    >
      <div className="qq-world-head">
        <span className="qq-world-emoji" aria-hidden>
          {world.emoji}
        </span>
        <div className="stack" style={{ gap: 4, minWidth: 0 }}>
          <h2 id={headingId} style={{ fontSize: '1.25rem' }}>
            {world.name}
          </h2>
          <span className="caption">
            <span aria-hidden>{meta.emoji}</span> {world.category}
          </span>
        </div>
      </div>
      <p className="muted">{world.blurb}</p>

      {p.unlocked ? (
        <>
          <div className="stack" style={{ gap: 8 }}>
            <div className="row-between">
              <Stars count={p.stars} />
              <span className="caption tabular">
                {p.next ? `${p.correct} / ${p.next} correct` : `${p.correct} correct`}
              </span>
            </div>
            {p.next ? (
              <>
                <ProgressBar value={p.correct - p.prev} max={p.next - p.prev} color={meta.color} label={`${world.name} progress to the next star`} />
                <span className="caption">
                  {p.next - p.correct} more correct {p.next - p.correct === 1 ? 'answer earns' : 'answers earn'} star {p.stars + 1}.
                </span>
              </>
            ) : (
              <span className="chip chip-sun">All 3 stars earned</span>
            )}
          </div>
          <div className="qq-world-actions">
            <Button
              variant="primary"
              loading={match.busy === questKey}
              disabled={starting}
              onClick={() => match.start(questKey, 'practice', { category: world.category, count: 5 })}
            >
              {match.busy === questKey ? 'Building…' : 'Quest'}
            </Button>
            <Button
              variant="coral"
              loading={match.busy === battleKey}
              disabled={starting}
              onClick={() => match.start(battleKey, 'versus', { category: world.category, count: 5, personaId: 'adaptive-rival' })}
            >
              {match.busy === battleKey ? 'Building…' : 'Battle'}
            </Button>
          </div>
          {match.error && (match.error.key === questKey || match.error.key === battleKey) ? (
            <p className="caption" role="alert" style={{ color: 'var(--coral)', fontWeight: 700 }}>
              That match didn't start. Try again.
            </p>
          ) : null}
        </>
      ) : (
        <div className="stack" style={{ gap: 8, marginTop: 'auto' }}>
          <span className="chip chip-gray" style={{ alignSelf: 'flex-start' }}>
            <span aria-hidden>🔒</span> Locked
          </span>
          <span className="tabular" style={{ fontWeight: 700 }}>
            Unlocks at {world.unlockStars} total stars
          </span>
          <ProgressBar value={Math.min(totalStars, world.unlockStars)} max={world.unlockStars || 1} label={`Stars toward unlocking ${world.name}`} />
          <span className="caption tabular">
            You have {totalStars}. Earn stars in any open world.
          </span>
        </div>
      )}
    </section>
  );
}
