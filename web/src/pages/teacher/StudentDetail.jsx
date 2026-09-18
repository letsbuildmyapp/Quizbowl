// Student detail: progress, QuizBot + adventure, strengths, badges, reward activity, recent sessions,
// live session control, and teacher awards.
// Firestore reads:
//   students/{studentId}
//   schoolThemes/{schoolId}, students/{studentId}/events orderBy at desc limit 15 (components/teacher/rewards-parts.jsx)
//   sessionSummaries where studentId == X and classroomId == C orderBy completedAt desc limit 20
//   sessions where participantIds array-contains X and status in [active statuses]
// Firestore writes:
//   awardRequests/{auto} via request(): { studentId, itemId, note }
//   sessions/{sid}/commands/{randomId} set { type: 'terminate', payload: { reason }, at: ts, uid, actorId }
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { collection, doc, limit, orderBy, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { db } from '../../firebase.js';
import { useAuth } from '../../hooks/useAuth.jsx';
import { useDoc, useQuery } from '../../hooks/useFirestore.js';
import { badgeById, categoryMeta, levelProgress } from '../../lib/catalog.js';
import { fmtDateTime, fmtNum, timeAgo } from '../../lib/format.js';
import { randomId } from '../../lib/requests.js';
import { Avatar, Button, ButtonLink, Card, Chip, EmptyState, ErrorNote, Field, Loading, Modal, ProgressBar, Stat, StrengthRow, friendlyError, useToast } from '../../components/ui.jsx';
import { ACTIVE_SESSION_STATUSES, MODE_LABELS, orderedCategories, pctText } from '../../components/teacher/stats.js';
import { AwardModal, RewardActivityCard, StudentAdventureCard } from '../../components/teacher/rewards-parts.jsx';
import '../../pages/teacher/teacher.css';

export default function StudentDetail() {
  const { studentId } = useParams();
  const { data: student, loading, error } = useDoc(studentId ? `students/${studentId}` : null);
  const [awarding, setAwarding] = useState(false);

  if (loading) return <div className="page"><Loading label="Loading student…" /></div>;
  if (error) return <div className="page stack"><ErrorNote error={error} /><BackLink /></div>;
  if (!student) {
    return (
      <div className="page stack">
        <EmptyState emoji="🔍" title="Student not found" action={<BackLink />}>
          This student may have been removed.
        </EmptyState>
      </div>
    );
  }

  const stats = student.stats || {};
  const lp = levelProgress(student.xp || 0);
  const clueAvg = stats.correct ? Math.round(((stats.clueFractionSum || 0) / stats.correct) * 100) : null;

  return (
    <div className="page stack-lg">
      <BackLink />
      <header className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
        <Avatar emoji={student.avatar} size="lg" />
        <div className="stack" style={{ gap: 6 }}>
          <h1>{student.displayName}</h1>
          <div className="row" style={{ gap: 8 }}>
            <Chip>Level {student.level || lp.level} · {student.title || lp.title}</Chip>
            {student.active === false ? <Chip tone="gray">Deactivated</Chip> : null}
            <span className="muted">Last played {timeAgo(student.lastPlayedAt)}</span>
          </div>
        </div>
      </header>

      <LiveSession studentId={studentId} />

      <div className="t-tiles">
        <div className="t-tile">
          <Stat value={fmtNum(student.xp || 0)} label="XP" color="var(--purple)" />
          <ProgressBar value={lp.into} max={lp.needed} label="Progress to next level" />
          <span className="caption tabular">
            {fmtNum(lp.needed - lp.into)} XP to level {lp.level + 1}
          </span>
        </div>
        <div className="t-tile">
          <Stat value={fmtNum(student.streak?.current || 0)} label="Day streak" color="var(--coral)" hint={`Best ${fmtNum(student.streak?.best || 0)}`} />
        </div>
        <div className="t-tile">
          <Stat value={pctText(stats.correct || 0, stats.answered || 0)} label="Accuracy" color="var(--teal)" hint={`${fmtNum(stats.correct || 0)} of ${fmtNum(stats.answered || 0)} answered`} />
        </div>
        <div className="t-tile">
          <Stat value={fmtNum(stats.sessions || 0)} label="Sessions" color="var(--sun-strong)" hint={`${fmtNum(stats.seen || 0)} questions seen`} />
        </div>
      </div>

      <StudentAdventureCard student={student} onAward={() => setAwarding(true)} />
      {awarding ? <AwardModal open students={[student]} onClose={() => setAwarding(false)} /> : null}

      <div className="grid-2">
        <Card className="stack">
          <h2>Buzzing</h2>
          <div className="stack" style={{ gap: 12 }}>
            <div className="stack" style={{ gap: 4 }}>
              <span className="label">Earliest correct clue</span>
              <span className="prose">
                {clueAvg == null ? 'No correct answers yet.' : `Buzzes at clue ${clueAvg}% of the way in, on average.`}
              </span>
              {clueAvg != null ? <ProgressBar value={clueAvg} max={100} color="var(--purple)" label="Average point in the question when buzzing correctly" /> : null}
              <span className="caption">Lower means they know it from harder, earlier clues.</span>
            </div>
            <div className="stack" style={{ gap: 4 }}>
              <span className="label">Early-buzz rate</span>
              <span className="tabular">
                {pctText(stats.early || 0, stats.correct || 0)} of correct answers came on early clues
              </span>
            </div>
            <div className="stack" style={{ gap: 4 }}>
              <span className="label">Computer matches</span>
              <span className="tabular">
                {stats.versusPlayed ? `Won ${fmtNum(stats.versusWon || 0)} of ${fmtNum(stats.versusPlayed)}` : 'None played yet'}
              </span>
            </div>
          </div>
        </Card>

        <Card className="stack">
          <h2>Category strengths</h2>
          <CategoryBars categories={stats.categories || {}} />
        </Card>
      </div>

      <Card className="stack">
        <h2>Badges</h2>
        {student.badges?.length ? (
          <div className="grid-3">
            {student.badges.map((id) => {
              const b = badgeById(id);
              return (
                <div key={id} className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                  <span className="avatar" aria-hidden>
                    {b?.emoji || '🏅'}
                  </span>
                  <div className="stack" style={{ gap: 2 }}>
                    <strong>{b?.name || id}</strong>
                    {b?.description ? <span className="caption">{b.description}</span> : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="muted">No badges yet.</p>
        )}
      </Card>

      <RewardActivityCard studentId={studentId} />

      <RecentSessions studentId={studentId} classroomId={student.classroomId} />
    </div>
  );
}

function BackLink() {
  return (
    <div>
      <ButtonLink to="/teach/students" variant="ghost">
        ← All students
      </ButtonLink>
    </div>
  );
}

function CategoryBars({ categories }) {
  const cats = orderedCategories(categories).filter((c) => categories[c]?.answered);
  if (!cats.length) return <p className="muted">Strengths show up after a few answered questions.</p>;
  return (
    <div className="stack">
      {cats.map((c) => {
        const v = categories[c];
        const meta = categoryMeta(c);
        return (
          <StrengthRow
            key={c}
            label={c}
            emoji={meta.emoji}
            color={meta.color}
            value={Math.round(((v.correct || 0) / v.answered) * 100)}
            detail={`${fmtNum(v.correct || 0)}/${fmtNum(v.answered)}`}
          />
        );
      })}
    </div>
  );
}

/**
 * The classroomId filter lets the rules prove teaches(classroomId) for a list query.
 * Composite index: sessionSummaries (studentId ASC, classroomId ASC, completedAt DESC).
 */
function RecentSessions({ studentId, classroomId }) {
  const { data, loading, error } = useQuery(
    () =>
      classroomId
        ? query(collection(db, 'sessionSummaries'), where('studentId', '==', studentId), where('classroomId', '==', classroomId), orderBy('completedAt', 'desc'), limit(20))
        : null,
    [studentId, classroomId]
  );
  return (
    <Card className="stack">
      <h2>Recent sessions</h2>
      {loading ? (
        <Loading label="Loading sessions…" />
      ) : error ? (
        <ErrorNote error={error} />
      ) : !data.length ? (
        <EmptyState emoji="🎮" title="No sessions yet">
          Finished games show up here.
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Mode</th>
                <th scope="col" className="num">Points</th>
                <th scope="col" className="num">Correct</th>
                <th scope="col" className="num">Accuracy</th>
                <th scope="col">Result</th>
              </tr>
            </thead>
            <tbody>
              {data.map((s) => (
                <tr key={s.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(s.completedAt)}</td>
                  <td>
                    {MODE_LABELS[s.mode] || s.mode}
                    {s.opponent?.name ? <span className="caption"> vs {s.opponent.name}</span> : null}
                  </td>
                  <td className="num">{fmtNum(s.points || 0)}</td>
                  <td className="num">
                    {fmtNum(s.correct || 0)}/{fmtNum(s.seen || 0)}
                  </td>
                  <td className="num">{pctText(s.correct || 0, s.answered || 0)}</td>
                  <td>
                    {s.mode === 'versus' || s.mode === 'live_battle' ? (
                      s.tie ? <Chip tone="gray">Tie</Chip> : s.won ? <Chip tone="green">Won</Chip> : <Chip tone="coral">Lost</Chip>
                    ) : (
                      <span className="muted">Done</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/** Composite index: sessions (participantIds CONTAINS, status ASC). */
function LiveSession({ studentId }) {
  const { user } = useAuth();
  const toast = useToast();
  const { data, error } = useQuery(
    () =>
      user?.uid
        ? query(collection(db, 'sessions'), where('teacherUid', '==', user.uid), where('participantIds', 'array-contains', studentId), where('status', 'in', ACTIVE_SESSION_STATUSES))
        : null,
    [studentId, user?.uid]
  );
  const [target, setTarget] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [stopError, setStopError] = useState(null);

  if (error) return <ErrorNote error={error} />;
  if (!data.length) return null;

  const stop = async () => {
    if (!reason.trim()) return setStopError('Add a short reason.');
    setBusy(true);
    setStopError(null);
    try {
      await setDoc(doc(db, 'sessions', target.id, 'commands', randomId()), {
        type: 'terminate',
        payload: { reason: reason.trim().slice(0, 300) },
        at: serverTimestamp(),
        uid: user.uid,
        actorId: user.uid
      });
      toast('Session stopped');
      setTarget(null);
      setReason('');
    } catch (err) {
      setStopError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card tone="teal" className="stack">
      <h2>Playing now</h2>
      <ul className="t-list">
        {data.map((s) => (
          <li key={s.id} className="row-between">
            <div className="stack" style={{ gap: 2 }}>
              <strong>{MODE_LABELS[s.mode] || s.mode}</strong>
              <span className="caption tabular">
                Question {Math.max(0, (s.qIndex ?? -1) + 1)} of {s.total || '?'}
                {s.status === 'PAUSED' ? ' · Paused' : ''}
              </span>
            </div>
            <div className="row" style={{ gap: 8 }}>
              {s.mode === 'live_battle' ? (
                <Link to={`/teach/live/${s.id}`} className="btn">
                  Open host screen
                </Link>
              ) : null}
              <Button variant="danger" onClick={() => setTarget(s)}>
                Stop session
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <Modal
        open={!!target}
        onClose={() => setTarget(null)}
        title="Stop this session?"
        footer={
          <>
            <Button onClick={() => setTarget(null)}>Cancel</Button>
            <Button variant="coral" onClick={stop} loading={busy}>
              Stop session
            </Button>
          </>
        }
      >
        <div className="stack">
          <p className="prose">The game ends for everyone in it. Points already earned are kept.</p>
          <Field label="Reason" hint="Saved with the session record.">
            {(id) => <textarea id={id} className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />}
          </Field>
          {stopError ? <ErrorNote>{stopError}</ErrorNote> : null}
        </div>
      </Modal>
    </Card>
  );
}
