// Review Deck (/play/review): saved questions as flashcards.
// Firestore reads: students/{id}/reviewDeck orderBy savedAt desc
// Firestore writes: students/{id}/reviewDeck/{questionId} delete + students/{id} { reviewDeckCount } (removeFromReviewDeck)
//   sessionRequests (via startSession('review')) for "Practice my deck"
import { useId, useState } from 'react';
import { collection, orderBy, query } from 'firebase/firestore';
import { db } from '../../firebase.js';
import { useQuery } from '../../hooks/useFirestore.js';
import { categoryMeta } from '../../lib/catalog.js';
import { removeFromReviewDeck } from '../../lib/game.js';
import { fmtDate } from '../../lib/format.js';
import { Button, ButtonLink, Card, EmptyState, ErrorNote, Loading, PageHeader, friendlyError, useToast } from '../../components/ui.jsx';
import { CategoryChip, StudentGate, useStartMatch } from '../../components/student/common.jsx';
import './student.css';

export default function ReviewDeck() {
  return <StudentGate>{(student) => <ReviewDeckBody student={student} />}</StudentGate>;
}

function ReviewDeckBody({ student }) {
  const deck = useQuery(() => query(collection(db, `students/${student.id}/reviewDeck`), orderBy('savedAt', 'desc')), [student.id]);
  const [filter, setFilter] = useState('all');
  const match = useStartMatch();
  const cards = deck.data;
  const counts = cards.reduce((m, c) => ({ ...m, [c.category]: (m[c.category] || 0) + 1 }), {});
  const cats = Object.keys(counts).sort();
  const active = filter !== 'all' && !counts[filter] ? 'all' : filter;
  const shown = active === 'all' ? cards : cards.filter((c) => c.category === active);

  return (
    <div className="page page-narrow stack-xl">
      <PageHeader
        eyebrow="Review Deck"
        title="Your saved questions"
        subtitle="Flip each card to check yourself, then practice the whole deck."
        actions={
          cards.length ? (
            <Button variant="primary" size="lg" loading={match.busy === 'review'} disabled={match.busy != null} onClick={() => match.start('review', 'review', {})}>
              {match.busy === 'review' ? 'Building…' : 'Practice my deck'}
            </Button>
          ) : null
        }
      />
      <ErrorNote>{match.error?.message}</ErrorNote>

      {deck.loading ? (
        <Loading label="Loading your deck…" />
      ) : deck.error ? (
        <ErrorNote error={deck.error} />
      ) : !cards.length ? (
        <EmptyState emoji="🔁" title="Your deck is empty" action={<ButtonLink to="/play/worlds" variant="primary" size="lg">Start a quest</ButtonLink>}>
          After each answer in a match, you can save the question here to study later.
        </EmptyState>
      ) : (
        <>
          <div className="qq-filter" role="group" aria-label="Filter by subject">
            <button type="button" aria-pressed={active === 'all'} onClick={() => setFilter('all')}>
              All <span className="tabular">({cards.length})</span>
            </button>
            {cats.map((c) => (
              <button key={c} type="button" aria-pressed={active === c} onClick={() => setFilter(c)}>
                <span aria-hidden>{categoryMeta(c).emoji}</span> {c} <span className="tabular">({counts[c]})</span>
              </button>
            ))}
          </div>
          <ul className="stack-lg" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {shown.map((c) => (
              <li key={c.id}>
                <FlashCard card={c} studentId={student.id} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function FlashCard({ card, studentId }) {
  const [flipped, setFlipped] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState(null);
  const toast = useToast();
  const answerId = useId();
  const clues = (card.clues || []).map((c) => (typeof c === 'string' ? c : c?.text)).filter(Boolean);
  const accepted = (card.acceptedAnswers || []).filter((a) => a && a !== card.canonicalAnswer);

  const remove = async () => {
    setRemoving(true);
    setError(null);
    try {
      await removeFromReviewDeck(studentId, card.questionId || card.id);
      toast('Removed from your deck', { emoji: '🗑️' });
    } catch (e) {
      setError(friendlyError(e));
      setRemoving(false);
    }
  };

  return (
    <Card className="qq-flash" style={{ borderTop: `6px solid ${categoryMeta(card.category).color}` }}>
      <div className="row-between">
        <div className="row" style={{ gap: 8 }}>
          <CategoryChip category={card.category} />
          {card.subcategory ? <span className="chip chip-gray">{card.subcategory}</span> : null}
        </div>
        <span className="caption">Saved {fmtDate(card.savedAt)}</span>
      </div>

      {clues.length ? (
        <ol className="qq-clues">
          {clues.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ol>
      ) : (
        <p className="muted">This card has no clues saved.</p>
      )}

      {flipped ? (
        <div className="qq-flash-answer stack" id={answerId} style={{ gap: 8 }}>
          <span className="eyebrow" style={{ color: 'var(--green)' }}>
            Answer
          </span>
          <p style={{ font: '600 1.375rem/1.25 var(--font-display)' }}>{card.canonicalAnswer}</p>
          {accepted.length ? <p className="caption">Also accepted: {accepted.join(', ')}</p> : null}
          {card.explanation ? <p className="prose">{card.explanation}</p> : null}
        </div>
      ) : null}

      <div className="row" style={{ gap: 12 }}>
        <Button variant={flipped ? 'default' : 'primary'} size="lg" aria-expanded={flipped} aria-controls={flipped ? answerId : undefined} onClick={() => setFlipped((f) => !f)}>
          {flipped ? 'Hide answer' : 'Show answer'}
        </Button>
        <Button variant="ghost" loading={removing} onClick={remove} aria-label="Remove this card from your deck">
          Remove
        </Button>
      </div>
      <ErrorNote>{error}</ErrorNote>
    </Card>
  );
}
