// Student home: one obvious action (Play Today's Quest) plus streak, level,
// new unlocks, team status, assignments, live battle invites.
// Reads: students/{id} (via useAuth), assignments, assignments/{id}/progress/{sid},
//        sessions (mine, active), teamQuests, teams/{teamId}, notifications
// Writes: sessionRequests (start a match), notifications/{id}.read
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { collection, doc, limit, orderBy, query, updateDoc, where } from 'firebase/firestore';
import { db } from '../../firebase.js';
import { useAuth } from '../../hooks/useAuth.jsx';
import { useDoc, useQuery } from '../../hooks/useFirestore.js';
import { Avatar, Button, ButtonLink, Card, Chip, ErrorNote, ProgressBar } from '../../components/ui.jsx';
import { StudentLoading } from '../../components/student/common.jsx';
import { MODE_LABELS, startSession } from '../../lib/game.js';
import { BADGES, WORLDS, badgeById, categoryMeta, levelProgress } from '../../lib/catalog.js';
import { dayKey, fmtDate, toMillis } from '../../lib/format.js';
import '../../components/game/game.css';

const ACTIVE = ['READY', 'READING_CLUE', 'BUZZ_LOCKED', 'AWAITING_ANSWER', 'SCORED', 'BONUS', 'PAUSED'];

export default function Home() {
  const { student, claims } = useAuth();
  const navigate = useNavigate();
  const [starting, setStarting] = useState(null);
  const [err, setErr] = useState(null);
  const sid = claims.studentId;
  const cid = claims.classroomId;

  const { data: activeSessions } = useQuery(() => (sid ? query(collection(db, 'sessions'), where('participantIds', 'array-contains', sid), where('status', 'in', ACTIVE)) : null), [sid]);
  const { data: assignments } = useQuery(() => (cid ? query(collection(db, 'assignments'), where('classroomId', '==', cid)) : null), [cid]);
  const { data: quests } = useQuery(() => (cid ? query(collection(db, 'teamQuests'), where('classroomId', '==', cid)) : null), [cid]);
  const { data: notes } = useQuery(() => (sid ? query(collection(db, 'notifications'), where('toStudentId', '==', sid), orderBy('createdAt', 'desc'), limit(5)) : null), [sid]);
  const { data: team } = useDoc(student?.teamId ? `teams/${student.teamId}` : null);

  if (!student) return <StudentLoading />;

  const go = async (key, mode, options = {}) => {
    setStarting(key);
    setErr(null);
    try {
      const id = await startSession(mode, options);
      navigate(`/play/match/${id}`);
    } catch (e) {
      setErr(e);
      setStarting(null);
    }
  };

  const lp = levelProgress(student.xp || 0);
  const streak = student.streak?.current || 0;
  const doneToday = student.dailyQuestDay === dayKey();
  const latest = student.latestUnlock && Date.now() - (student.latestUnlock.at || 0) < 7 * 86400000 ? student.latestUnlock : null;
  const newWorld = latest?.worlds?.length ? WORLDS.find((w) => w.id === latest.worlds[latest.worlds.length - 1]) : null;
  const liveInvite = activeSessions.find((s) => s.mode === 'live_battle');
  const resumable = activeSessions.find((s) => s.mode !== 'live_battle' && s.ownerStudentId === sid && s.status !== 'READY');
  const myAssignments = assignments
    .filter((a) => !a.archived)
    .filter((a) => {
      const t = a.targets || { type: 'class' };
      return t.type === 'class' || (t.type === 'team' && t.ids?.includes(student.teamId)) || (t.type === 'students' && t.ids?.includes(sid));
    })
    .sort((a, b) => (toMillis(a.dueAt) || Infinity) - (toMillis(b.dueAt) || Infinity));
  const activeQuest = quests.find((q) => q.endsAt > Date.now() && (!q.teamId || q.teamId === student.teamId));
  const unread = notes.filter((n) => !n.read);

  return (
    <div className="page stack-xl">
      <div className="row-between">
        <div className="stack" style={{ gap: 2 }}>
          <span className="eyebrow">Quests</span>
          <span className="muted">Today's quest, teacher assignments, and team goals.</span>
        </div>
        <ButtonLink to="/play" variant="ghost">
          🗺️ Back to the map
        </ButtonLink>
      </div>
      {student.consent === 'pending' || student.consent === 'revoked' ? (
        <Card tone="sun">
          <strong>Almost ready!</strong> A grown-up in your family needs to say yes to QuizQuest before you can play. Your teacher can help.
        </Card>
      ) : null}

      {liveInvite ? (
        <Card tone="coral" className="row-between">
          <div className="stack" style={{ gap: 4 }}>
            <strong style={{ fontSize: '1.25rem' }}>⚔️ Live Team Battle!</strong>
            <span>
              {Object.values(liveInvite.sides)
                .map((s) => `${s.emoji} ${s.name}`)
                .join(' vs ')}
            </span>
          </div>
          <ButtonLink to={`/play/match/${liveInvite.id}`} variant="coral" size="lg">
            Join battle
          </ButtonLink>
        </Card>
      ) : null}

      <section className="grid-2" style={{ alignItems: 'stretch' }}>
        <Card className="stack-lg">
          <div className="row" style={{ gap: 16 }}>
            <Avatar emoji={student.avatar} size="lg" />
            <div className="stack" style={{ gap: 4 }}>
              <h1>Hi, {student.displayName}! 👋</h1>
              <span className="eyebrow" style={{ color: 'var(--purple)' }}>
                Level {lp.level} · {lp.title}
              </span>
            </div>
          </div>
          <div className="row">
            <Chip tone="coral">🔥 {streak} day streak</Chip>
            <Chip tone="sun">⭐ {(student.xp || 0).toLocaleString()} XP</Chip>
            <Chip tone="teal">🏅 {(student.badges || []).length} badges</Chip>
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <ProgressBar value={lp.into} max={lp.needed} label="Progress to next level" />
            <span className="caption tabular">
              {lp.needed - lp.into} XP to level {lp.level + 1}
            </span>
          </div>
          <Button variant="primary" size="xl" block loading={starting === 'daily'} onClick={() => go('daily', 'daily')}>
            {doneToday ? 'Play another quest' : "PLAY TODAY'S QUEST"}
          </Button>
          <p className="caption" style={{ textAlign: 'center' }}>
            {doneToday ? "Today's Quest is done. Your streak is safe!" : '5 questions against your best-fit rival. Keeps your streak going.'}
          </p>
          <ErrorNote error={err} />
        </Card>

        <div className="stack">
          {newWorld ? (
            <Card tone="sun" className="row card-link" as={Link} to="/play">
              <span style={{ fontSize: 40 }} aria-hidden>
                {newWorld.emoji}
              </span>
              <div className="stack" style={{ gap: 2 }}>
                <strong>New world unlocked!</strong>
                <span>{newWorld.name}</span>
              </div>
            </Card>
          ) : null}
          {latest?.badges?.length ? (
            <Card tone="teal" tight>
              🏅 New badge: <strong>{latest.badges.map((b) => badgeById(b)?.name).filter(Boolean).join(', ')}</strong>
            </Card>
          ) : null}
          {resumable ? (
            <Card className="row-between">
              <span>
                <strong>Unfinished match</strong>
                <br />
                <span className="muted">
                  {resumable.title || MODE_LABELS[resumable.mode]} · question {resumable.qIndex + 1} of {resumable.total}
                </span>
              </span>
              <ButtonLink to={`/play/match/${resumable.id}`} variant="teal">
                Resume
              </ButtonLink>
            </Card>
          ) : null}
          <Card className="stack">
            <h2>Quick play</h2>
            <div className="grid quick-play" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
              <Button size="lg" variant="coral" loading={starting === 'versus'} onClick={() => go('versus', 'versus', { personaId: 'adaptive-rival', count: 10 })}>
                ⚔️ Battle the Computer
              </Button>
              <Button size="lg" variant="teal" loading={starting === 'practice'} onClick={() => go('practice', 'practice', { count: 8 })}>
                📘 Practice
              </Button>
              <ButtonLink to="/play/modes" size="lg">
                🎮 All modes
              </ButtonLink>
              <ButtonLink to="/play" size="lg">
                🗺️ Map
              </ButtonLink>
            </div>
          </Card>
        </div>
      </section>

      {myAssignments.length ? (
        <section className="stack">
          <h2>From your teacher</h2>
          <div className="grid-2">
            {myAssignments.map((a) => (
              <AssignmentCard key={a.id} a={a} sid={sid} starting={starting} onStart={() => go(`a-${a.id}`, a.mode, { assignmentId: a.id })} />
            ))}
          </div>
        </section>
      ) : null}

      <section className="grid-2">
        <Card className="stack">
          <div className="row-between">
            <h2>{team ? `${team.emoji || '⭐'} Team ${team.name}` : 'Team quest'}</h2>
            <ButtonLink to="/play/team" variant="ghost">
              Details
            </ButtonLink>
          </div>
          {activeQuest ? (
            <>
              <strong>{activeQuest.title}</strong>
              <ProgressBar value={activeQuest.progress || 0} max={activeQuest.target} color="var(--teal)" label="Team quest progress" />
              <span className="caption tabular">
                {activeQuest.progress || 0} of {activeQuest.target} {activeQuest.metric === 'answered' ? 'questions' : 'correct answers'}
                {activeQuest.completedAt ? ' · Complete! 🎉' : ''}
              </span>
            </>
          ) : (
            <p className="muted">No team quest right now. Every question you answer still earns XP for your team.</p>
          )}
        </Card>
        <Card className="stack">
          <h2>News</h2>
          {notes.length ? (
            <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0, gap: 10 }}>
              {notes.map((n) => (
                <li key={n.id} className="row-between" style={{ opacity: n.read ? 0.7 : 1 }}>
                  <span>
                    <strong>{n.title}</strong>
                    {n.body ? <span className="muted"> · {n.body}</span> : null}
                  </span>
                  {!n.read ? (
                    <Button size="sm" variant="ghost" onClick={() => updateDoc(doc(db, 'notifications', n.id), { read: true })}>
                      Got it
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Nothing new yet. Badges and messages from your teacher show up here.</p>
          )}
          {unread.length ? <span className="sr-only">{unread.length} unread</span> : null}
        </Card>
      </section>

      <p className="caption" style={{ textAlign: 'center' }}>
        {(student.badges || []).length} of {BADGES.length} badges collected
      </p>
    </div>
  );
}

function AssignmentCard({ a, sid, starting, onStart }) {
  const { data: progress } = useDoc(`assignments/${a.id}/progress/${sid}`);
  const cat = a.category ? categoryMeta(a.category) : null;
  const due = toMillis(a.dueAt);
  const overdue = due && due < Date.now() && !progress?.completed;
  return (
    <Card className="stack">
      <div className="row-between">
        <strong>{a.title}</strong>
        {progress?.completed ? <Chip tone="green">✓ Done</Chip> : overdue ? <Chip tone="coral">Past due</Chip> : due ? <Chip tone="gray">Due {fmtDate(due)}</Chip> : null}
      </div>
      <span className="muted">
        {MODE_LABELS[a.mode]} · {a.count} questions{cat ? ` · ${cat.emoji} ${cat.id}` : ''}
      </span>
      <Button variant={progress?.completed ? 'default' : 'primary'} loading={starting === `a-${a.id}`} onClick={onStart}>
        {progress?.completed ? 'Play again' : 'Start'}
      </Button>
    </Card>
  );
}
