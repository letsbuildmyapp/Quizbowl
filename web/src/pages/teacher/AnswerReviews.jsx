// Answer Reviews: close answers the server flagged for a teacher decision.
// Firestore reads: classrooms (useClassroom), students where classroomId ==,
//   answerReviews where classroomId == X and status == 'pending',
//   answerReviews where classroomId == X orderBy createdAt desc limit 30.
// Firestore writes:
//   answerReviews/{id} update { decision: 'accept'|'reject', decidedBy, decidedAt: serverTimestamp() }
//   (the server applies points and sets status)
import { useState } from 'react';
import { collection, doc, limit, orderBy, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { db } from '../../firebase.js';
import { useAuth } from '../../hooks/useAuth.jsx';
import { useClassroom } from '../../hooks/useClassroom.js';
import { useQuery } from '../../hooks/useFirestore.js';
import { categoryMeta } from '../../lib/catalog.js';
import { fmtDateTime, timeAgo, toMillis } from '../../lib/format.js';
import { Avatar, Button, Card, Chip, EmptyState, ErrorNote, Loading, friendlyError, useToast } from '../../components/ui.jsx';
import { ClassGate, TeacherHeader, rosterMap, useRoster } from '../../components/teacher/TeacherPage.jsx';

const givenAnswer = (r) => r.answer ?? r.given ?? r.response ?? '';

export default function AnswerReviews() {
  const cls = useClassroom();
  return (
    <div className="page stack-lg">
      <TeacherHeader cls={cls} title="Answer Reviews" subtitle="Answers that were close to right. Your call decides the points." />
      <ClassGate cls={cls}>{cls.classroom ? <ReviewsBody classroom={cls.classroom} /> : null}</ClassGate>
    </div>
  );
}

function ReviewsBody({ classroom }) {
  const roster = useRoster(classroom.id);
  const names = rosterMap(roster.data);
  const pending = useQuery(
    () => query(collection(db, 'answerReviews'), where('classroomId', '==', classroom.id), where('status', '==', 'pending')),
    [classroom.id]
  );
  const recent = useQuery(
    () => query(collection(db, 'answerReviews'), where('classroomId', '==', classroom.id), orderBy('createdAt', 'desc'), limit(30)),
    [classroom.id]
  );
  const pendingSorted = pending.data.slice().sort((a, b) => (toMillis(a.createdAt) || 0) - (toMillis(b.createdAt) || 0));
  const decided = recent.data.filter((r) => r.status !== 'pending');

  return (
    <div className="stack-xl">
      <section className="stack" aria-labelledby="ar-pending">
        <h2 id="ar-pending">
          Waiting for you <span className="tabular muted">({pendingSorted.length})</span>
        </h2>
        {pending.loading ? (
          <Loading label="Loading reviews…" />
        ) : pending.error ? (
          <ErrorNote error={pending.error} />
        ) : !pendingSorted.length ? (
          <EmptyState emoji="✅" title="All caught up">
            Close answers show up here after students play.
          </EmptyState>
        ) : (
          <div className="stack">
            {pendingSorted.map((r) => (
              <PendingReview key={r.id} review={r} student={names[r.studentId]} />
            ))}
          </div>
        )}
      </section>

      <section className="stack" aria-labelledby="ar-recent">
        <h2 id="ar-recent">Recent decisions</h2>
        {recent.loading ? (
          <Loading label="Loading recent decisions…" />
        ) : recent.error ? (
          <ErrorNote error={recent.error} />
        ) : !decided.length ? (
          <p className="muted">No decisions yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Student</th>
                  <th scope="col">Answer given</th>
                  <th scope="col">Correct answer</th>
                  <th scope="col">Decision</th>
                  <th scope="col">When</th>
                </tr>
              </thead>
              <tbody>
                {decided.map((r) => {
                  const accepted = r.decision === 'accept' || r.status === 'accepted';
                  const hasDecision = r.decision || r.status === 'accepted' || r.status === 'rejected';
                  return (
                    <tr key={r.id}>
                      <td>{names[r.studentId]?.displayName || 'Former student'}</td>
                      <td>{givenAnswer(r) || '(blank)'}</td>
                      <td>{r.canonicalAnswer || ''}</td>
                      <td>
                        {hasDecision ? (
                          <Chip tone={accepted ? 'green' : 'coral'}>{accepted ? '✓ Accepted' : '✕ Kept incorrect'}</Chip>
                        ) : (
                          <Chip tone="gray">{r.status || 'Processing'}</Chip>
                        )}
                      </td>
                      <td className="tabular" style={{ whiteSpace: 'nowrap' }}>
                        {fmtDateTime(r.decidedAt || r.createdAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function PendingReview({ review, student }) {
  const { user } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const cat = review.category ? categoryMeta(review.category) : null;
  const accepted = Array.isArray(review.acceptedAnswers) ? review.acceptedAnswers.filter((a) => a && a !== review.canonicalAnswer) : [];
  const clue = review.clue || review.prompt || review.questionText || null;
  // Once decided, the server flips status; until then show the choice as sent.
  const sent = review.decision || null;

  const decide = async (decision) => {
    setBusy(decision);
    setError(null);
    try {
      await updateDoc(doc(db, 'answerReviews', review.id), { decision, decidedBy: user.uid, decidedAt: serverTimestamp() });
      toast(decision === 'accept' ? 'Marked correct. Points are on the way.' : 'Kept as incorrect');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <div className="stack">
        <div className="row-between">
          <div className="row">
            <Avatar emoji={student?.avatar} />
            <div className="stack" style={{ gap: 2 }}>
              <strong>{student?.displayName || 'Former student'}</strong>
              <span className="caption">{timeAgo(review.createdAt)}</span>
            </div>
          </div>
          {cat ? (
            <Chip tone="teal">
              {cat.emoji} {cat.id}
            </Chip>
          ) : null}
        </div>
        {clue ? <p className="prose muted">{clue}</p> : null}
        <div className="grid-2">
          <div className="stack" style={{ gap: 4 }}>
            <span className="label">Student answered</span>
            <span style={{ fontSize: '1.25rem', fontWeight: 800 }}>{givenAnswer(review) || '(blank)'}</span>
          </div>
          <div className="stack" style={{ gap: 4 }}>
            <span className="label">Correct answer</span>
            <span style={{ fontSize: '1.25rem', fontWeight: 800 }}>{review.canonicalAnswer || 'Not available'}</span>
            {accepted.length ? <span className="caption">Also accepted: {accepted.join(', ')}</span> : null}
          </div>
        </div>
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        {sent ? (
          <p className="muted" role="status">
            {sent === 'accept' ? 'Accepted. Updating points…' : 'Kept as incorrect. Finishing up…'}
          </p>
        ) : (
          <div className="row">
            <Button variant="teal" onClick={() => decide('accept')} loading={busy === 'accept'} disabled={!!busy}>
              ✓ Accept as correct
            </Button>
            <Button onClick={() => decide('reject')} loading={busy === 'reject'} disabled={!!busy}>
              ✕ Keep as incorrect
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
