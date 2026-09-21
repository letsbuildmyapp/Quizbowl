// Live Team Battle host screen (projector friendly). The host's browser keeps
// the heartbeat so clue reveals and answer timeouts stay on schedule.
// Reads: sessions/{id}, RTDB presence (who is online)
// Writes: sessions/{id}/commands/* (start, advance, pause, resume, terminate, sync)
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { equalTo, orderByChild, query as rtQuery, ref as rtRef } from 'firebase/database';
import { rtdb } from '../../firebase.js';
import { listenValue } from '../../lib/listen.js';
import { useGameSession } from '../../hooks/useGameSession.js';
import { Avatar, Button, ButtonLink, Card, Chip, ConfirmModal, Field, Loading } from '../../components/ui.jsx';
import { ClueReview, ClueStage, Countdown, Scoreboard } from '../../components/game/GameParts.jsx';
import { Brand } from '../../components/AppShell.jsx';

function useOnline(classroomId) {
  const [online, setOnline] = useState({});
  useEffect(() => {
    if (!rtdb || !classroomId) return undefined;
    const q = rtQuery(rtRef(rtdb, 'presence'), orderByChild('classroomId'), equalTo(classroomId));
    return listenValue(
      q,
      (snap) => {
        const map = {};
        snap.forEach((c) => {
          const v = c.val();
          if (v?.online && v.studentId) map[v.studentId] = true;
        });
        setOnline(map);
      },
      () => setOnline({})
    );
  }, [classroomId]);
  return online;
}

export default function LiveHost() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const { session, loading, error, send, serverNow } = useGameSession(sessionId, { controller: true });
  const online = useOnline(session?.classroomId);
  const [stopOpen, setStopOpen] = useState(false);
  const [reason, setReason] = useState('');

  if (loading) return <Loading full />;
  if (error || !session) {
    return (
      <div className="page page-narrow stack-lg">
        <h1>Battle not found</h1>
        <ButtonLink to="/teach/competitions">Back to competitions</ButtonLink>
      </div>
    );
  }

  const { status, current } = session;
  const players = session.participants.filter((p) => p.kind === 'student');
  const buzzer = current?.buzz ? session.participants.find((p) => p.id === current.buzz.actorId) : null;
  const lastQ = session.qIndex + 1 >= session.total;

  const stop = async () => {
    await send('terminate', { reason: reason || 'Ended by teacher' });
    setStopOpen(false);
  };

  return (
    <div className="match">
      <header className="match-top">
        <Brand to="/teach" />
        <div className="row">
          <Chip>Live Team Battle</Chip>
          {!['COMPLETE', 'TERMINATED'].includes(status) ? (
            <>
              {status === 'PAUSED' ? (
                <Button onClick={() => send('resume')}>Resume</Button>
              ) : status !== 'READY' ? (
                <Button onClick={() => send('pause')}>Pause</Button>
              ) : null}
              <Button variant="danger" onClick={() => setStopOpen(true)}>
                End battle
              </Button>
            </>
          ) : (
            <Button onClick={() => navigate('/teach/competitions')}>Done</Button>
          )}
        </div>
      </header>
      <main id="main" className="match-body host-stage" style={{ maxWidth: 1100 }}>
        <Scoreboard session={session} mySide={null} />

        {status === 'READY' ? (
          <Card className="stack-lg">
            <h1>Get ready!</h1>
            <p className="muted">Players open QuizQuest on their device and tap Join battle on their home screen. Buzz with the big button or the space bar.</p>
            <div className="grid-2">
              {Object.entries(session.sides).map(([k, s]) => (
                <div key={k} className="stack">
                  <h2>
                    {s.emoji} {s.name}
                  </h2>
                  <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0, gap: 8 }}>
                    {players
                      .filter((p) => p.side === k)
                      .map((p) => (
                        <li key={p.id} className="row">
                          <Avatar emoji={p.avatar} />
                          <span>{p.name}</span>
                          <Chip tone={online[p.id] ? 'green' : 'gray'}>{online[p.id] ? '● Online' : '○ Not here yet'}</Chip>
                        </li>
                      ))}
                  </ul>
                </div>
              ))}
            </div>
            <Button variant="primary" size="xl" onClick={() => send('start')}>
              Start battle
            </Button>
          </Card>
        ) : null}

        {['READING_CLUE', 'AWAITING_ANSWER', 'BUZZ_LOCKED', 'PAUSED'].includes(status) && current ? (
          <>
            {status === 'AWAITING_ANSWER' && buzzer ? (
              <div className="opponent-status alert" role="status" aria-live="assertive" style={{ fontSize: '1.25rem' }}>
                🔔 {session.sides[buzzer.side]?.emoji} {buzzer.name} ({session.sides[buzzer.side]?.name}) buzzed!
              </div>
            ) : null}
            {status === 'AWAITING_ANSWER' ? <Countdown deadline={current.answerDeadline} total={session.rules.answerWindowMs} serverNow={serverNow} /> : null}
            {status === 'AWAITING_ANSWER' && current.choices ? (
              <ol className="choice-grid" style={{ listStyle: 'none', padding: 0, margin: 0 }} aria-label="Answer choices">
                {current.choices.map((c, i) => (
                  <li key={c} className="choice-btn" style={{ cursor: 'default' }}>
                    <span className="choice-key" aria-hidden>
                      {'ABCD'[i]}
                    </span>
                    <span className="choice-text">{c}</span>
                  </li>
                ))}
              </ol>
            ) : null}
            {current.lockedSides?.length ? (
              <p className="muted" style={{ textAlign: 'center' }}>
                Already answered: {current.lockedSides.map((s) => session.sides[s]?.name).join(', ')}
              </p>
            ) : null}
            <ClueStage current={current} large />
          </>
        ) : null}

        {status === 'BONUS' && session.bonus ? (
          <Card className="stack-lg">
            <h2>
              🎁 Bonus for {session.sides[session.bonus.side]?.emoji} {session.sides[session.bonus.side]?.name}
            </h2>
            {session.bonus.leadin ? <p className="muted">{session.bonus.leadin}</p> : null}
            {session.bonus.parts.map((p, i) => {
              const r = session.bonus.results[i];
              return (
                <div key={i} className="stack" style={{ gap: 4 }}>
                  <p className="clue latest">{p.text}</p>
                  {r ? (
                    <p>
                      {r.result === 'correct' ? '✓' : '✗'} <strong>{r.canonicalAnswer}</strong>
                      {r.answer && r.result !== 'correct' ? <span className="muted"> (said “{r.answer}”)</span> : null}
                    </p>
                  ) : (
                    <Countdown deadline={session.bonus.deadline} total={session.rules.bonusWindowMs} serverNow={serverNow} />
                  )}
                </div>
              );
            })}
          </Card>
        ) : null}

        {status === 'SCORED' && current?.outcome ? (
          <Card className="stack-lg">
            <h2>
              {current.outcome.winnerSide
                ? `${session.sides[current.outcome.winnerSide]?.emoji} ${session.sides[current.outcome.winnerSide]?.name} got it!`
                : 'Nobody got this one.'}
            </h2>
            <span className="answer-reveal" style={{ fontSize: '2.25rem' }}>
              {current.outcome.canonicalAnswer}
            </span>
            {current.outcome.explanation ? <p>{current.outcome.explanation}</p> : null}
            <details>
              <summary style={{ cursor: 'pointer', fontWeight: 800, minHeight: 44, display: 'flex', alignItems: 'center' }}>Clue by clue</summary>
              <ClueReview outcome={current.outcome} attempts={current.attempts} sides={session.sides} opponentName="" myActorId={null} />
            </details>
            <Button variant="primary" size="xl" onClick={() => send('advance')}>
              {session.scoredPhase === 'tossup' && current.outcome.winnerSide && session.rules.bonusesEnabled ? 'Bonus round →' : lastQ ? 'Final scores →' : 'Next question →'}
            </Button>
          </Card>
        ) : null}

        {status === 'COMPLETE' ? (
          <Card className="stack-lg" style={{ textAlign: 'center', alignItems: 'center' }}>
            <span style={{ fontSize: 64 }} aria-hidden>
              🏆
            </span>
            <h1>
              {session.result?.winnerSide === 'tie'
                ? "It's a tie!"
                : `${session.sides[session.result?.winnerSide]?.emoji} ${session.sides[session.result?.winnerSide]?.name} win!`}
            </h1>
            <p className="muted">XP and team points are on their way to every player.</p>
            <Link to="/teach/reports" className="btn">
              View reports
            </Link>
          </Card>
        ) : null}

        {status === 'TERMINATED' ? (
          <Card>
            <h2>Battle ended</h2>
            <p className="muted">{session.terminatedReason}</p>
          </Card>
        ) : null}
      </main>
      <ConfirmModal
        open={stopOpen}
        title="End this battle?"
        body={
          <Field label="Reason (saved to the audit log)">
            {(id) => <input id={id} className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Class is over" />}
          </Field>
        }
        confirmLabel="End battle"
        danger
        onConfirm={stop}
        onCancel={() => setStopOpen(false)}
      />
    </div>
  );
}
