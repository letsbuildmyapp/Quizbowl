// Match screen (all play modes, including live team battles for students).
// Reads: sessions/{id} (live), classrooms/{classroomId} (voice + read-aloud defaults)
// Writes: sessions/{id}/commands/*, students/{id}/reviewDeck/*, contentFlags
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { X } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth.jsx';
import { useDoc } from '../../hooks/useFirestore.js';
import { useGameSession } from '../../hooks/useGameSession.js';
import { Avatar, Button, ButtonLink, Card, Chip, ConfirmModal, Loading, useToast } from '../../components/ui.jsx';
import { AnswerBox, ClueReview, ClueStage, Countdown, ReportQuestion, Scoreboard } from '../../components/game/GameParts.jsx';
import { Brand } from '../../components/AppShell.jsx';
import { MODE_LABELS, saveToReviewDeck } from '../../lib/game.js';
import { SPEECH_RATE, sounds, speak, stopSpeaking } from '../../lib/sound.js';
import { READING_SPEEDS } from '../../lib/catalog.js';

export default function Match() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const auth = useAuth();
  const toast = useToast();
  const { session, loading, error, send, serverNow, isController, actorId, mySide, lastRejection, clearRejection } = useGameSession(sessionId);
  const { data: classroom } = useDoc(auth.claims.classroomId ? `classrooms/${auth.claims.classroomId}` : null);
  const prefs = { ...(classroom?.settings?.accessibility || {}), ...(auth.student?.settings || {}) };
  const soundOn = prefs.sound !== false;
  const voiceEnabled = !!classroom?.settings?.voiceAnswers;

  const [pendingBuzz, setPendingBuzz] = useState(null); // { qIndex, queuedAnswer }
  const [busy, setBusy] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [saved, setSaved] = useState({});
  const reviewedRef = useRef(new Set());

  const status = session?.status;
  const current = session?.current;
  const isLive = session?.mode === 'live_battle';
  const opponentName = session?.opponent?.name || 'Opponent';
  const myBuzzConfirmed = status === 'AWAITING_ANSWER' && current?.buzz?.actorId === actorId;
  const mySideLocked = !!(mySide && current?.lockedSides?.includes(mySide));
  const canBuzz = status === 'READING_CLUE' && !mySideLocked && !pendingBuzz;

  // Finished: go to results.
  useEffect(() => {
    if (status === 'COMPLETE') {
      if (soundOn) sounds.win();
      const t = setTimeout(() => navigate(`/play/results/${sessionId}`, { replace: true }), 900);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [status, navigate, sessionId, soundOn]);

  // Rejected buzz (someone else was first / locked out).
  useEffect(() => {
    if (!lastRejection) return;
    if (lastRejection.type === 'buzz') {
      setPendingBuzz(null);
      toast(lastRejection.code === 'too-late' ? 'Just missed it! Someone buzzed first.' : lastRejection.message, { emoji: '⏱️' });
    } else if (lastRejection.type === 'answer') {
      toast(lastRejection.code === 'too-late' ? 'Time ran out on that answer.' : lastRejection.message, { emoji: '⏱️' });
    }
    clearRejection();
  }, [lastRejection, clearRejection, toast]);

  // Once the server confirms our buzz, send any answer typed in the meantime.
  useEffect(() => {
    if (!pendingBuzz) return;
    if (myBuzzConfirmed) {
      if (pendingBuzz.queuedAnswer != null) {
        send('answer', { text: pendingBuzz.queuedAnswer }, { watch: true });
      }
      setPendingBuzz(null);
    } else if (status !== 'READING_CLUE' && status !== 'AWAITING_ANSWER' && status !== 'BUZZ_LOCKED') {
      setPendingBuzz(null);
    }
  }, [pendingBuzz, myBuzzConfirmed, status, send]);

  // Sounds + read-aloud as clues appear.
  const clueCount = current?.clues?.length || 0;
  useEffect(() => {
    if (!clueCount || status !== 'READING_CLUE') return;
    if (prefs.readAloud) speak(current.clues[clueCount - 1], { rate: SPEECH_RATE[session.rules.readingSpeed] || 1 });
    else if (soundOn) sounds.clue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clueCount, current?.questionId]);
  useEffect(() => {
    if (status && status !== 'READING_CLUE') stopSpeaking();
    if (status === 'BUZZ_LOCKED' && soundOn) sounds.opponent();
  }, [status, soundOn]);
  useEffect(() => () => stopSpeaking(), []);

  // Outcome sound + log that the explanation was shown.
  const outcomeKey = status === 'SCORED' ? `${session.qIndex}-${session.scoredPhase}` : null;
  useEffect(() => {
    if (!outcomeKey || !current?.outcome) return;
    if (session.scoredPhase === 'tossup') {
      const won = current.outcome.winnerSide && current.outcome.winnerSide === mySide;
      if (soundOn) (won ? sounds.correct : sounds.wrong)();
      if (!reviewedRef.current.has(current.questionId) && isController) {
        reviewedRef.current.add(current.questionId);
        send('review', { questionId: current.questionId, explanationViewed: true }).catch(() => {});
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcomeKey]);

  const buzz = useCallback(() => {
    if (!canBuzz) return;
    if (soundOn) sounds.buzz();
    stopSpeaking();
    setPendingBuzz({ qIndex: session.qIndex, queuedAnswer: null });
    send('buzz', { seenClueIndex: clueCount - 1 }, { watch: true }).catch(() => setPendingBuzz(null));
  }, [canBuzz, soundOn, session?.qIndex, send, clueCount]);

  const submitAnswer = async (text) => {
    if (pendingBuzz && !myBuzzConfirmed) {
      setPendingBuzz((p) => (p ? { ...p, queuedAnswer: text } : p));
      return;
    }
    setBusy(true);
    try {
      await send('answer', status === 'BONUS' ? { text, part: session.bonus.partIndex } : { text }, { watch: true });
    } finally {
      setBusy(false);
    }
  };

  const advance = () => send('advance');

  // Keyboard: Space buzzes, N reveals the next clue (manual). Enter on the focused Next button continues.
  useEffect(() => {
    const onKey = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || document.querySelector('[role="dialog"]')) return;
      if (e.code === 'Space' && canBuzz) {
        e.preventDefault();
        buzz();
      } else if ((e.key === 'n' || e.key === 'N') && status === 'READING_CLUE' && session?.rules.readingSpeed === 'manual' && isController) {
        send('reveal');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const leave = async () => {
    setConfirmLeave(false);
    if (!isLive && session && !['COMPLETE', 'TERMINATED'].includes(status)) await send('terminate', { reason: 'Player left' }).catch(() => {});
    navigate('/play');
  };

  const save = async () => {
    try {
      await saveToReviewDeck(auth.claims.studentId, current);
      setSaved((s) => ({ ...s, [current.questionId]: true }));
      send('review', { questionId: current.questionId, saved: true }).catch(() => {});
      toast('Saved to your Review Deck', { emoji: '🗂️' });
    } catch {
      toast("Couldn't save that one. Try again.", { emoji: '⚠️' });
    }
  };

  const oppStatus = useMemo(() => {
    if (!session || !current) return null;
    const last = current.attempts?.[current.attempts.length - 1];
    if (status === 'BUZZ_LOCKED' && current.buzz?.kind === 'computer') {
      return { alert: true, text: `${session.opponent?.avatar || ''} ${opponentName} buzzed! “${session.opponent?.lines?.buzz || 'I know it!'}”` };
    }
    if (status === 'AWAITING_ANSWER' && current.buzz?.actorId !== actorId) {
      const p = session.participants.find((x) => x.id === current.buzz.actorId);
      const team = session.sides[current.buzz.side]?.name;
      return { alert: true, text: `${team} buzzed! ${p?.name || 'A player'} is answering.` };
    }
    if (status === 'READING_CLUE' && last && last.result === 'incorrect') {
      const who = last.kind === 'computer' ? opponentName : last.actorId === actorId ? 'You' : session.sides[last.side]?.name;
      const said = last.answer ? ` said “${last.answer}”` : " didn't answer";
      return { alert: false, text: `${who}${said}. Not quite! ${mySideLocked ? 'Keep listening.' : 'You can still buzz.'}` };
    }
    if (status === 'READING_CLUE' && session.opponent) return { alert: false, text: `${session.opponent.avatar} ${opponentName} is listening…` };
    if (status === 'READING_CLUE' && mySideLocked) return { alert: false, text: 'Your team already answered. Keep listening.' };
    return null;
  }, [session, current, status, actorId, opponentName, mySideLocked]);

  if (loading) return <Loading full label="Loading your match…" />;
  if (error || !session) {
    return (
      <div className="page page-narrow stack-lg">
        <h1>We couldn't open that match</h1>
        <p className="muted">It may have ended, or it isn't yours.</p>
        <ButtonLink to="/play" variant="primary">
          Back home
        </ButtonLink>
      </div>
    );
  }

  const header = (
    <header className="match-top">
      <Brand to="/play" />
      <div className="row">
        <Chip tone="purple">{session.title || MODE_LABELS[session.mode]}</Chip>
        <Button variant="ghost" onClick={() => setConfirmLeave(true)} aria-label="Leave match">
          <X size={18} aria-hidden /> Leave
        </Button>
      </div>
    </header>
  );

  return (
    <div className="match">
      {header}
      <main id="main" className="match-body">
        {status === 'READY' ? (
          <Intro session={session} isController={isController} onStart={() => send('start')} isLive={isLive} />
        ) : status === 'TERMINATED' ? (
          <Card className="stack-lg" style={{ textAlign: 'center', alignItems: 'center' }}>
            <span style={{ fontSize: 48 }} aria-hidden>
              🛑
            </span>
            <h2>This match was stopped</h2>
            <p className="muted">{session.terminatedBy === 'teacher' ? `Your teacher ended it: ${session.terminatedReason}` : 'It ended before the last question.'}</p>
            <ButtonLink to="/play" variant="primary" size="lg">
              Back home
            </ButtonLink>
          </Card>
        ) : (
          <>
            <Scoreboard session={session} mySide={mySide} />
            {status === 'PAUSED' ? (
              <Card className="stack" style={{ alignItems: 'center', textAlign: 'center' }}>
                <h2>Paused</h2>
                <p className="muted">The clock is stopped. Ready when you are.</p>
                {isController ? (
                  <Button variant="primary" size="lg" onClick={() => send('resume')}>
                    Resume
                  </Button>
                ) : (
                  <p>Waiting for the host…</p>
                )}
              </Card>
            ) : null}

            {oppStatus ? (
              <div className={`opponent-status ${oppStatus.alert ? 'alert' : ''}`} role="status" aria-live="assertive">
                {oppStatus.text}
              </div>
            ) : null}

            {['READING_CLUE', 'BUZZ_LOCKED', 'AWAITING_ANSWER'].includes(status) ? <ClueStage current={current} /> : null}

            {/* Answering (optimistic right after pressing BUZZ) */}
            {(myBuzzConfirmed || (pendingBuzz && pendingBuzz.qIndex === session.qIndex && status !== 'SCORED')) ? (
              <AnswerBox
                key={`a-${session.qIndex}-${current?.attempts?.length}`}
                onSubmit={submitAnswer}
                deadline={myBuzzConfirmed ? current.answerDeadline : null}
                total={session.rules.answerWindowMs}
                serverNow={serverNow}
                voiceEnabled={voiceEnabled}
                busy={busy || (!!pendingBuzz?.queuedAnswer && !myBuzzConfirmed)}
                prompt="You buzzed! What's the answer?"
              />
            ) : null}

            {status === 'READING_CLUE' ? (
              <div className="buzz-wrap">
                <button type="button" className="buzz-btn" onClick={buzz} disabled={!canBuzz} aria-label="Buzz in">
                  BUZZ!
                </button>
                <p className="kbd-hint">
                  Press <span className="kbd">Space</span> to buzz
                </p>
                {isController && !isLive ? (
                  <div className="row" style={{ justifyContent: 'center' }}>
                    {session.rules.readingSpeed === 'manual' && current.clues.length < current.clueCount ? (
                      <Button variant="teal" onClick={() => send('reveal')}>
                        Next clue <span className="kbd">N</span>
                      </Button>
                    ) : null}
                    <Button variant="ghost" onClick={() => send('skip')}>
                      {session.rules.readingSpeed === 'manual' && current.clues.length >= current.clueCount ? 'Show the answer' : "I don't know"}
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {status === 'BONUS' ? (
              <BonusPanel session={session} mySide={mySide} serverNow={serverNow} onAnswer={submitAnswer} busy={busy} onSkip={() => send('skip')} isController={isController} opponentName={opponentName} voiceEnabled={voiceEnabled} />
            ) : null}

            {status === 'SCORED' ? (
              <Outcome
                session={session}
                mySide={mySide}
                actorId={actorId}
                opponentName={opponentName}
                isController={isController}
                onNext={advance}
                onSave={save}
                saved={!!saved[current.questionId]}
                canSave={auth.isStudent}
              />
            ) : null}
          </>
        )}
      </main>
      <ConfirmModal
        open={confirmLeave}
        title="Leave this match?"
        body={isLive ? 'The battle keeps going without you. You can rejoin from your home screen.' : "Your progress in this match won't count if you leave now."}
        confirmLabel="Leave"
        danger
        onConfirm={leave}
        onCancel={() => setConfirmLeave(false)}
      />
    </div>
  );
}

function Intro({ session, isController, onStart, isLive }) {
  const opp = session.opponent;
  const speed = READING_SPEEDS[session.rules.readingSpeed]?.label || 'Medium';
  useEffect(() => {
    if (!isController) return undefined;
    const onKey = (e) => {
      if (e.code === 'Space' || e.key === 'Enter') {
        e.preventDefault();
        onStart();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isController, onStart]);
  return (
    <Card className="intro-card">
      {opp ? (
        <>
          <span className="eyebrow">Your rival</span>
          <span className="persona" aria-hidden>
            {opp.avatar}
          </span>
          <h1>{opp.name}</h1>
          <div className="row" style={{ justifyContent: 'center' }}>
            <Chip>{opp.difficulty}</Chip>
            <Chip tone="teal">{opp.strengths}</Chip>
          </div>
          <p className="speech">“{opp.intro}”</p>
        </>
      ) : isLive ? (
        <>
          <span className="eyebrow">Live Team Battle</span>
          <div className="row" style={{ justifyContent: 'center', gap: 24 }}>
            {Object.entries(session.sides).map(([k, s]) => (
              <div key={k} className="stack" style={{ alignItems: 'center', gap: 6 }}>
                <Avatar emoji={s.emoji} size="lg" />
                <strong>{s.name}</strong>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <img src="/art/owl.png" alt="" width="140" height="120" style={{ objectFit: 'contain' }} />
          <h1>{session.title || MODE_LABELS[session.mode]}</h1>
        </>
      )}
      <p className="muted">
        {session.total} questions · {speed} reading{session.rules.powerEnabled ? ' · buzz early for power points' : ''}
      </p>
      {isController ? (
        <>
          <Button variant="primary" size="xl" onClick={onStart} autoFocus>
            Start
          </Button>
          <p className="kbd-hint">
            Clues appear one at a time. Buzz with <span className="kbd">Space</span> as soon as you know it.
          </p>
        </>
      ) : (
        <p style={{ fontWeight: 800 }}>Waiting for your teacher to start…</p>
      )}
    </Card>
  );
}

function Outcome({ session, mySide, actorId, opponentName, isController, onNext, onSave, saved, canSave }) {
  const current = session.current;
  const o = current.outcome;
  const bonusDone = session.scoredPhase === 'bonus';
  const myAttempt = current.attempts.find((a) => a.actorId === actorId);
  const winner = o.winnerSide;
  const iWon = winner && winner === mySide;
  const winnerName = winner ? (session.sides[winner]?.name || opponentName) : null;
  const lastQuestion = session.qIndex + 1 >= session.total;
  const bonusComing = !bonusDone && winner && session.rules.bonusesEnabled;
  const correctAttempt = current.attempts.find((a) => a.result === 'correct');

  let headline;
  let icon;
  if (iWon) {
    icon = correctAttempt?.powered ? '⚡' : '🎉';
    headline = correctAttempt?.powered ? `Power! +${correctAttempt.points}` : `Correct! +${correctAttempt?.points ?? 10}`;
  } else if (winner) {
    icon = '💡';
    headline = `${winnerName} got it.`;
  } else {
    icon = '🤔';
    headline = 'Nobody got this one.';
  }

  const nextLabel = bonusComing ? 'Bonus round' : lastQuestion && (bonusDone || !bonusComing) ? 'See results' : 'Next question';

  return (
    <Card className="outcome" aria-live="polite">
      {bonusDone && session.bonus ? <BonusResults bonus={session.bonus} /> : null}
      <div className="outcome-head">
        <span className="big-icon" aria-hidden>
          {icon}
        </span>
        <div className="stack" style={{ gap: 4 }}>
          <h2>{headline}</h2>
          {myAttempt ? (
            <p>
              You said <strong>“{myAttempt.answer || '(no answer)'}”</strong> {myAttempt.result === 'correct' ? '✓ correct' : '✗ not quite'}
              {myAttempt.flaggedClose ? '. That was close, so your teacher will take a look.' : ''}
            </p>
          ) : null}
          {current.attempts
            .filter((a) => a.kind === 'computer')
            .map((a) => (
              <p key={a.buzzAt} className="muted">
                {session.opponent?.avatar} {opponentName} said “{a.answer || '…'}” {a.result === 'correct' ? '✓' : '✗'}
                {a.result !== 'correct' && session.opponent?.lines?.wrong ? ` “${session.opponent.lines.wrong}”` : ''}
              </p>
            ))}
        </div>
      </div>

      <div className="stack" style={{ gap: 6 }}>
        <span className="label">The answer</span>
        <span className="answer-reveal">{o.canonicalAnswer}</span>
        {o.acceptedAnswers?.length ? <span className="caption">Also accepted: {o.acceptedAnswers.join(', ')}</span> : null}
        {o.pronunciationNotes ? <span className="caption">Say it: {o.pronunciationNotes}</span> : null}
      </div>
      {o.explanation ? (
        <Card tone="sun" tight>
          <p>
            <strong>Why: </strong>
            {o.explanation}
          </p>
        </Card>
      ) : null}

      <details>
        <summary style={{ cursor: 'pointer', fontWeight: 800, minHeight: 44, display: 'flex', alignItems: 'center' }}>See every clue</summary>
        <div style={{ marginTop: 12 }}>
          <ClueReview outcome={o} attempts={current.attempts} sides={session.sides} opponentName={opponentName} myActorId={actorId} />
        </div>
      </details>

      <div className="row-between">
        <div className="row">
          {canSave ? (
            <Button onClick={onSave} disabled={saved}>
              {saved ? '✓ Saved' : '🗂️ Save to Review Deck'}
            </Button>
          ) : null}
          <ReportQuestion questionId={current.questionId} role="student" />
        </div>
        {isController ? (
          <Button variant="primary" size="lg" onClick={onNext} autoFocus>
            {nextLabel} →
          </Button>
        ) : (
          <span className="muted">Waiting for the host…</span>
        )}
      </div>
    </Card>
  );
}

function BonusResults({ bonus }) {
  const pts = bonus.results.reduce((s, r) => s + r.points, 0);
  return (
    <Card tone="purple" tight className="stack" style={{ gap: 8 }}>
      <strong>
        Bonus: {bonus.results.filter((r) => r.result === 'correct').length} of {bonus.results.length} right (+{pts})
      </strong>
      <ul className="stack" style={{ gap: 4, margin: 0, paddingLeft: 18 }}>
        {bonus.results.map((r, i) => (
          <li key={i}>
            {r.result === 'correct' ? '✓' : '✗'} {r.canonicalAnswer}
            {r.answer && r.result !== 'correct' ? <span className="muted"> (said “{r.answer}”)</span> : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function BonusPanel({ session, mySide, serverNow, onAnswer, busy, onSkip, isController, opponentName, voiceEnabled }) {
  const b = session.bonus;
  const mine = b.side === mySide;
  const part = b.parts[b.partIndex];
  const owner = session.sides[b.side]?.name || opponentName;
  return (
    <Card className="stack-lg">
      <div className="row-between">
        <h2>🎁 Bonus round</h2>
        <Chip tone="sun">
          Part {Math.min(b.partIndex + 1, b.parts.length)} of 3 · {owner}
        </Chip>
      </div>
      {b.leadin ? <p className="muted">{b.leadin}</p> : null}
      {b.results.map((r, i) => (
        <div key={i} className="stack" style={{ gap: 4 }}>
          <p>{b.parts[i].text}</p>
          <p>
            {r.result === 'correct' ? '✓' : '✗'} <strong>{r.canonicalAnswer}</strong>
            {r.answer && r.result !== 'correct' ? <span className="muted"> (said “{r.answer}”)</span> : null}
          </p>
          {r.explanation ? <p className="caption">{r.explanation}</p> : null}
        </div>
      ))}
      {part && b.results.length === b.partIndex ? (
        <div className="stack">
          <p className="clue latest">{part.text}</p>
          {mine ? (
            <>
              <AnswerBox
                key={`b-${session.qIndex}-${b.partIndex}`}
                onSubmit={onAnswer}
                deadline={b.deadline}
                total={session.rules.bonusWindowMs}
                serverNow={serverNow}
                busy={busy}
                voiceEnabled={voiceEnabled}
                prompt="Your answer"
              />
              {isController && session.mode !== 'live_battle' ? (
                <Button variant="ghost" onClick={onSkip}>
                  I don't know
                </Button>
              ) : null}
            </>
          ) : (
            <p className="opponent-status">
              {session.opponent ? `${session.opponent.avatar} ${opponentName} is thinking…` : `${owner} is answering…`}
            </p>
          )}
          {!mine && b.deadline ? <Countdown deadline={b.deadline} total={session.rules.bonusWindowMs} serverNow={serverNow} /> : null}
        </div>
      ) : null}
    </Card>
  );
}
