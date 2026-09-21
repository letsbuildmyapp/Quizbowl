// Match screen (all play modes, including live team battles for students),
// presented as a Pokémon-style battle: arena scene on top, battle dialog below.
// Reads: sessions/{id} (live), classrooms/{classroomId} (voice + read-aloud defaults, celebrations)
// Writes: sessions/{id}/commands/*, students/{id}/reviewDeck/*, contentFlags
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { X } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth.jsx';
import { useDoc } from '../../hooks/useFirestore.js';
import { useGameSession } from '../../hooks/useGameSession.js';
import { useSchoolTheme } from '../../hooks/useSchoolTheme.js';
import { Button, ButtonLink, Chip, ConfirmModal, Loading, useToast } from '../../components/ui.jsx';
import { AnswerBox, ChoicePicker, ClueReview, Countdown, ReportQuestion } from '../../components/game/GameParts.jsx';
import { BuzzerArt } from '../../components/bot/index.js';
import BattleScene from '../../components/battle/BattleScene.jsx';
import { arenaWorld, foeView } from '../../components/battle/battleModel.js';
import { sfx } from '../../components/battle/sfx.js';
import { MODE_LABELS, saveToReviewDeck } from '../../lib/game.js';
import { SOUND_ENABLED, SPEECH_RATE, sounds, speak, stopSpeaking } from '../../lib/sound.js';
import { READING_SPEEDS, categoryMeta, levelProgress } from '../../lib/catalog.js';
import { currentLoadout } from '../../lib/rewards.js';

const RESULTS_DELAY_MS = 2000;
// How long to wait for the server to confirm a buzz before giving the buzzer back.
const BUZZ_CONFIRM_MS = 6000;

export default function Match() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const auth = useAuth();
  const toast = useToast();
  const { theme } = useSchoolTheme();
  const { session, loading, error, send, serverNow, isController, actorId, mySide, lastRejection, clearRejection } = useGameSession(sessionId);
  const { data: classroom } = useDoc(auth.claims.classroomId ? `classrooms/${auth.claims.classroomId}` : null);
  const prefs = { ...(classroom?.settings?.accessibility || {}), ...(auth.student?.settings || {}) };
  const soundOn = SOUND_ENABLED && prefs.sound !== false;
  const voiceEnabled = !!classroom?.settings?.voiceAnswers;
  const calm = classroom?.settings?.rewards?.celebrations === 'calm';

  const [pendingBuzz, setPendingBuzz] = useState(null); // { qIndex, queuedAnswer }
  const [busy, setBusy] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [saved, setSaved] = useState({});
  const [late, setLate] = useState(false);
  const [chargeKey, setChargeKey] = useState(null);
  const reviewedRef = useRef(new Set());
  const worldRef = useRef(null);

  const status = session?.status;
  const current = session?.current;
  const isLive = session?.mode === 'live_battle';
  const opponentName = session?.opponent?.name || 'Opponent';
  const myBuzzConfirmed = status === 'AWAITING_ANSWER' && current?.buzz?.actorId === actorId;
  const mySideLocked = !!(mySide && current?.lockedSides?.includes(mySide));
  const canBuzz = status === 'READING_CLUE' && !mySideLocked && !pendingBuzz;
  const answering = myBuzzConfirmed || (pendingBuzz && pendingBuzz.qIndex === session?.qIndex && status !== 'SCORED');
  const attemptKey = status === 'BONUS' ? `b${session?.qIndex}-${session?.bonus?.results?.length}` : `t${session?.qIndex}-${current?.attempts?.length || 0}`;
  const charging = chargeKey != null && chargeKey === attemptKey && ['AWAITING_ANSWER', 'BONUS', 'READING_CLUE'].includes(status);

  const foe = useMemo(() => (session ? foeView(session, mySide) : null), [session, mySide]);
  const w = session ? arenaWorld(session) : null;
  if (w && !worldRef.current) worldRef.current = w;
  const worldId = worldRef.current || w;

  // Finished: let kids see the victory moment, then go to results.
  const goResults = useCallback(() => navigate(`/play/results/${sessionId}`, { replace: true }), [navigate, sessionId]);
  useEffect(() => {
    if (status !== 'COMPLETE') return undefined;
    const t = setTimeout(goResults, RESULTS_DELAY_MS);
    return () => clearTimeout(t);
  }, [status, goResults]);

  // Rejected buzz (someone else was first / locked out).
  useEffect(() => {
    if (!lastRejection) return;
    if (lastRejection.type === 'buzz') {
      setPendingBuzz(null);
      setLate(true);
      toast(lastRejection.code === 'too-late' ? 'Just missed it! Someone buzzed first.' : lastRejection.message, { emoji: '⏱️' });
    } else if (lastRejection.type === 'answer') {
      toast(lastRejection.code === 'too-late' ? 'Time ran out on that answer.' : lastRejection.message, { emoji: '⏱️' });
    }
    clearRejection();
  }, [lastRejection, clearRejection, toast]);
  useEffect(() => {
    if (!late) return undefined;
    const t = setTimeout(() => setLate(false), 1500);
    return () => clearTimeout(t);
  }, [late]);

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

  // Safety net: if the confirmation never arrives (a dropped update, a command
  // that went nowhere), don't strand the kid on "choices are on the way". Ask the
  // server where we are and hand the buzzer back.
  useEffect(() => {
    if (!pendingBuzz || myBuzzConfirmed) return undefined;
    const t = setTimeout(() => {
      setPendingBuzz(null);
      send('sync').catch(() => {});
    }, BUZZ_CONFIRM_MS);
    return () => clearTimeout(t);
  }, [pendingBuzz, myBuzzConfirmed, send]);

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
      if (soundOn && won) sounds.correct();
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

  // Multiple choice: the pick is sent as an index; the server scores it.
  const submitChoice = async (choice) => {
    setChargeKey(attemptKey);
    if (soundOn) sfx.charge();
    setBusy(true);
    try {
      await send('answer', status === 'BONUS' ? { choice, part: session.bonus.partIndex } : { choice }, { watch: true });
    } finally {
      setBusy(false);
    }
  };

  const submitAnswer = async (text) => {
    setChargeKey(attemptKey);
    if (soundOn) sfx.charge();
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

  // One line of battle narration above the clues (announced to screen readers).
  const narration = useMemo(() => {
    if (!session || !current) return null;
    const last = current.attempts?.[current.attempts.length - 1];
    if (status === 'BUZZ_LOCKED' && current.buzz?.kind === 'computer') {
      return { alert: true, text: `${opponentName} buzzed! “${session.opponent?.lines?.buzz || 'I know it!'}”` };
    }
    if (status === 'AWAITING_ANSWER' && current.buzz?.actorId !== actorId) {
      const p = session.participants.find((x) => x.id === current.buzz.actorId);
      const team = session.sides[current.buzz.side]?.name;
      return { alert: true, text: `${team} buzzed! ${p?.name || 'A player'} is answering.` };
    }
    if (answering) return { alert: false, text: 'You buzzed! What’s the answer?' };
    if (status === 'READING_CLUE' && last && last.result === 'incorrect') {
      const who = last.kind === 'computer' ? opponentName : last.actorId === actorId ? 'You' : session.sides[last.side]?.name;
      const said = last.answer ? ` said “${last.answer}”` : " didn't answer";
      const quip = last.kind === 'computer' && session.opponent?.lines?.wrong ? ` “${session.opponent.lines.wrong}”` : '';
      return { alert: false, text: `${who}${said}. Not quite!${quip} ${mySideLocked ? 'Keep listening.' : 'You can still buzz!'}` };
    }
    if (status === 'READING_CLUE' && mySideLocked) return { alert: false, text: 'Your team already answered. Keep listening.' };
    if (status === 'READING_CLUE' && session.opponent) return { alert: false, text: `${opponentName} is listening…` };
    if (status === 'READING_CLUE') return { alert: false, text: 'Listen to the clues. Buzz when you know it!' };
    return null;
  }, [session, current, status, actorId, opponentName, mySideLocked, answering]);

  // Keep the newest clue in view inside the dialog box (scroll only, never focus).
  const textRef = useRef(null);
  useEffect(() => {
    const el = textRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [clueCount, current?.questionId, narration?.text]);

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

  const loadout = currentLoadout(auth.student);
  const xp = levelProgress(auth.student?.xp || 0);
  const me = session.participants.find((p) => p.id === actorId);
  const player = { name: auth.student?.displayName || me?.name || 'You', level: auth.student?.level || xp.level, xpPct: xp.pct };
  const cat = current ? categoryMeta(current.category) : null;
  const inQuestion = ['READING_CLUE', 'BUZZ_LOCKED', 'AWAITING_ANSWER'].includes(status);
  const buzzerState = late ? 'late' : myBuzzConfirmed ? 'accepted' : pendingBuzz ? 'pressed' : canBuzz ? 'ready' : 'disabled';
  const skin = loadout.held || 'buzzer-classic';

  const hud = (
    <div className="bt-hud">
      <button type="button" className="btn-hud" onClick={() => setConfirmLeave(true)} aria-label="Leave match">
        <X size={18} aria-hidden /> Leave
      </button>
      {session.qIndex >= 0 && status !== 'COMPLETE' ? (
        <span className="bt-hud-pill tabular">
          Q {Math.min(session.qIndex + 1, session.total)} of {session.total}
        </span>
      ) : null}
      {cat && status !== 'COMPLETE' ? (
        <span className="bt-hud-pill">
          <span aria-hidden>{cat.emoji}</span> {cat.id}
        </span>
      ) : null}
      <span className="bt-hud-pill bt-hud-title">{session.title || MODE_LABELS[session.mode]}</span>
    </div>
  );

  let dock;
  if (status === 'READY') {
    dock = <IntroDock session={session} foe={foe} isController={isController} onStart={() => send('start')} />;
  } else if (status === 'TERMINATED') {
    dock = (
      <div className="bt-dock-inner wide">
        <div className="bt-box bt-textbox" role="status">
          <p className="bt-say">This match was stopped.</p>
          <p className="muted">{session.terminatedBy === 'teacher' ? `Your teacher ended it: ${session.terminatedReason}` : 'It ended before the last question.'}</p>
          <div>
            <ButtonLink to="/play" variant="primary" size="lg">
              Back home
            </ButtonLink>
          </div>
        </div>
      </div>
    );
  } else if (status === 'PAUSED') {
    dock = (
      <div className="bt-dock-inner wide">
        <div className="bt-box bt-textbox" role="status" style={{ alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
          <p className="bt-say">Paused</p>
          <p className="muted">The clock is stopped. Ready when you are.</p>
          {isController ? (
            <Button variant="primary" size="lg" onClick={() => send('resume')} autoFocus>
              Resume
            </Button>
          ) : (
            <p>Waiting for the host…</p>
          )}
        </div>
      </div>
    );
  } else if (status === 'COMPLETE') {
    dock = <FinaleDock session={session} foe={foe} mySide={mySide} isLive={isLive} onContinue={goResults} />;
  } else if (status === 'SCORED') {
    dock = (
      <div className="bt-dock-inner wide">
        <Outcome
          session={session}
          mySide={mySide}
          actorId={actorId}
          opponentName={opponentName}
          foe={foe}
          isController={isController}
          onNext={advance}
          onSave={save}
          saved={!!saved[current.questionId]}
          canSave={auth.isStudent}
        />
      </div>
    );
  } else if (status === 'BONUS') {
    dock = (
      <div className="bt-dock-inner wide">
        <BonusPanel
          session={session}
          mySide={mySide}
          serverNow={serverNow}
          onAnswer={submitAnswer}
          onChoice={submitChoice}
          busy={busy || charging}
          onSkip={() => send('skip')}
          isController={isController}
          opponentName={opponentName}
          voiceEnabled={voiceEnabled}
        />
      </div>
    );
  } else if (inQuestion && current) {
    const manual = session.rules.readingSpeed === 'manual';
    let caption = (
      <>
        Press <span className="kbd">Space</span> to buzz
      </>
    );
    if (status === 'BUZZ_LOCKED') caption = `${opponentName} is answering…`;
    else if (status === 'AWAITING_ANSWER') caption = 'Someone is answering…';
    else if (late) caption = 'Just missed it!';
    else if (mySideLocked) caption = 'Keep listening…';
    dock = (
      <div className={`bt-dock-inner ${myBuzzConfirmed && current?.choices ? 'has-choices' : ''}`}>
        <section className="bt-box bt-textbox" ref={textRef} aria-label="Battle dialog">
          <div className="bt-cluehead">
            <div className="clue-dots" aria-hidden="true">
              {Array.from({ length: current.clueCount }, (_, i) => (
                <span key={i} className={i < current.clues.length ? 'on' : ''} />
              ))}
            </div>
            <span className="caption tabular">
              Clue {current.clues.length} of {current.clueCount}
            </span>
          </div>
          {narration ? (
            <p className={`bt-narrate ${narration.alert ? 'alert' : ''}`} role="status" aria-live={narration.alert ? 'assertive' : 'polite'}>
              {narration.text}
            </p>
          ) : null}
          <div className="bt-clues">
            {current.leadin ? <p className="leadin">{current.leadin}</p> : null}
            <div aria-live="polite" aria-atomic="false" className="bt-clues">
              {current.clues.map((c, i) => (
                <p key={i} className={`bt-clue ${i === current.clues.length - 1 ? 'latest' : 'old'}`}>
                  {c}
                </p>
              ))}
            </div>
          </div>
        </section>

        {answering ? (
          <section className="bt-box bt-actions stacked" aria-label="Your answer">
            <div className="bt-answer">
              <div className="bt-mini-buzz" aria-hidden="true">
                <BuzzerArt state={myBuzzConfirmed ? 'accepted' : 'pressed'} skin={skin} theme={theme} teamColor={theme.primaryColor} size={84} />
              </div>
              {myBuzzConfirmed && current.choices ? (
                <ChoicePicker
                  key={`c-${session.qIndex}-${current?.attempts?.length}`}
                  choices={current.choices}
                  onPick={submitChoice}
                  deadline={current.answerDeadline}
                  total={session.rules.answerWindowMs}
                  serverNow={serverNow}
                  busy={busy || charging}
                  prompt={charging ? 'Charging your answer…' : "What's the answer?"}
                />
              ) : !myBuzzConfirmed && session.rules.answerFormat !== 'typed' ? (
                <p className="bt-narrate" role="status" aria-live="polite">
                  Buzzed! Your answer choices are on the way…
                </p>
              ) : (
                <AnswerBox
                  key={`a-${session.qIndex}-${current?.attempts?.length}`}
                  onSubmit={submitAnswer}
                  deadline={myBuzzConfirmed ? current.answerDeadline : null}
                  total={session.rules.answerWindowMs}
                  serverNow={serverNow}
                  voiceEnabled={voiceEnabled}
                  busy={busy || charging || (!!pendingBuzz?.queuedAnswer && !myBuzzConfirmed)}
                  prompt={charging ? 'Charging your answer…' : "What's the answer?"}
                />
              )}
            </div>
          </section>
        ) : (
          <section className="bt-box bt-actions" aria-label="Buzzer">
            <button
              type="button"
              className="bt-buzz"
              onPointerDown={(e) => {
                if (e.button === 0 && canBuzz) {
                  e.preventDefault();
                  buzz();
                }
              }}
              onClick={(e) => {
                if (e.detail === 0) buzz();
              }}
              disabled={!canBuzz}
              aria-label="Buzz in"
              aria-keyshortcuts="Space"
            >
              <BuzzerArt state={buzzerState} skin={skin} theme={theme} teamColor={theme.primaryColor} size={180} />
              <span className="bt-buzz-label" aria-hidden="true">
                BUZZ!
              </span>
            </button>
            <div className="bt-buzz-side">
              <p className="bt-buzz-caption">{caption}</p>
              {status === 'READING_CLUE' && isController && !isLive ? (
                <div className="bt-controls">
                  {manual && current.clues.length < current.clueCount ? (
                    <Button variant="teal" onClick={() => send('reveal')}>
                      Next clue <span className="kbd">N</span>
                    </Button>
                  ) : null}
                  <Button variant="ghost" onClick={() => send('skip')}>
                    {manual && current.clues.length >= current.clueCount ? 'Show the answer' : "I don't know"}
                  </Button>
                </div>
              ) : null}
            </div>
          </section>
        )}
      </div>
    );
  }

  return (
    <div className="battle" data-status={status}>
      <BattleScene
        session={session}
        mySide={mySide}
        foe={foe}
        worldId={worldId}
        loadout={loadout}
        theme={theme}
        player={player}
        buzzing={!!answering}
        charging={charging}
        soundOn={soundOn}
        calm={calm}
      >
        {hud}
      </BattleScene>
      <main id="main" className="bt-dock">
        {dock}
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

function IntroDock({ session, foe, isController, onStart }) {
  const speed = READING_SPEEDS[session.rules.readingSpeed]?.label || 'Medium';
  useEffect(() => {
    if (!isController) return undefined;
    const onKey = (e) => {
      if (document.querySelector('[role="dialog"]')) return;
      if (e.code === 'Space' || e.key === 'Enter') {
        e.preventDefault();
        onStart();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isController, onStart]);

  let say;
  let quote = null;
  if (foe.type === 'team') {
    const [a, b] = Object.values(session.sides);
    say = `${a?.name} vs ${b?.name}!`;
    quote = 'Buzz fast and answer for your team.';
  } else if (foe.type === 'dummy') {
    say = 'Training time!';
    quote = 'Warm up on the training dummy. No pressure, just practice.';
  } else {
    say = foe.wild ? `A wild ${foe.name} appeared!` : `${foe.name} wants to battle!`;
    quote = foe.intro ? `“${foe.intro}”` : null;
  }
  const opp = session.opponent;
  return (
    <div className="bt-dock-inner">
      <section className="bt-box bt-textbox" aria-label="Battle dialog">
        <p className="bt-say" role="status" aria-live="polite">
          {say}
        </p>
        {quote ? <p className="bt-quote">{quote}</p> : null}
        {opp?.strengths ? (
          <div className="row">
            {opp.difficulty ? <Chip>{opp.difficulty}</Chip> : null}
            <Chip tone="teal">{opp.strengths}</Chip>
          </div>
        ) : null}
        <p className="muted">
          {session.total} questions · {speed} reading{session.rules.powerEnabled ? ' · buzz early for power points' : ''}
        </p>
      </section>
      <section className="bt-box bt-actions stacked" aria-label="Start">
        {isController ? (
          <>
            <Button variant="primary" size="xl" onClick={onStart} autoFocus>
              Start battle
            </Button>
            <p className="caption" style={{ textAlign: 'center', maxWidth: 300 }}>
              Clues appear one at a time. Buzz with <span className="kbd">Space</span> as soon as you know it.
            </p>
          </>
        ) : (
          <p style={{ fontWeight: 800, textAlign: 'center' }}>Waiting for your teacher to start…</p>
        )}
      </section>
    </div>
  );
}

function FinaleDock({ session, foe, mySide, isLive, onContinue }) {
  const winner = session.result?.winnerSide;
  const myScore = session.sides?.[mySide || 'A']?.score ?? 0;
  let say;
  let quote = null;
  if (!winner) {
    say = 'Training complete!';
    quote = `Final score: ${myScore}. Nice work!`;
  } else if (winner === 'tie') {
    say = "It's a tie!";
    quote = 'What a close battle.';
  } else if (winner === mySide) {
    if (isLive) say = `${session.sides[mySide]?.name} win!`;
    else if (foe.wild) say = `You won! ${foe.name} fled!`;
    else say = `You beat ${foe.name}!`;
    const line = foe.boss || foe.wild ? foe.defeat : foe.lines?.lose;
    quote = line ? (foe.wild ? line : `“${line}”`) : null;
  } else {
    say = isLive ? 'Great battle!' : `${foe.name} wins this time.`;
    quote = !isLive && foe.lines?.win ? `“${foe.lines.win}” Every battle makes you stronger.` : 'Every battle makes you stronger.';
  }
  return (
    <div className="bt-dock-inner">
      <section className="bt-box bt-textbox" aria-label="Battle dialog">
        <p className="bt-say" role="status" aria-live="assertive">
          {say}
        </p>
        {quote ? <p className="bt-quote">{quote}</p> : null}
      </section>
      <section className="bt-box bt-actions stacked" aria-label="Continue">
        <Button variant="primary" size="xl" onClick={onContinue} autoFocus>
          Continue →
        </Button>
        <p className="caption">Heading to your results…</p>
      </section>
    </div>
  );
}

function Outcome({ session, mySide, actorId, opponentName, foe, isController, onNext, onSave, saved, canSave }) {
  const current = session.current;
  const o = current.outcome;
  const bonusDone = session.scoredPhase === 'bonus';
  const myAttempt = current.attempts.find((a) => a.actorId === actorId);
  const winner = o.winnerSide;
  const iWon = winner && winner === mySide;
  const winnerName = winner ? session.sides[winner]?.name || opponentName : null;
  const lastQuestion = session.qIndex + 1 >= session.total;
  const bonusComing = !bonusDone && winner && session.rules.bonusesEnabled;
  const correctAttempt = current.attempts.find((a) => a.result === 'correct');

  let headline;
  let icon;
  let hitline = null;
  if (iWon) {
    icon = correctAttempt?.powered ? '⚡' : '🎉';
    headline = correctAttempt?.powered ? `Power! +${correctAttempt.points}` : `Correct! +${correctAttempt?.points ?? 10}`;
    if (!bonusDone) hitline = foe.type === 'dummy' ? 'Direct hit on the training dummy!' : correctAttempt?.powered ? `A super strong hit on ${foe.name}!` : `Your attack hit ${foe.name}!`;
  } else if (winner) {
    icon = '💡';
    headline = `${winnerName} got it.`;
    if (!bonusDone) hitline = `${foe.name} landed a hit. You'll get the next one!`;
  } else {
    icon = '🤔';
    headline = 'Nobody got this one.';
  }

  const nextLabel = bonusComing ? 'Bonus round' : lastQuestion && (bonusDone || !bonusComing) ? 'See results' : 'Next question';

  // An Enter meant for the answer box can land on Next if time runs out at the
  // same moment; ignore activations in the first moment so the answer stays readable.
  const armedRef = useRef(false);
  useEffect(() => {
    const t = setTimeout(() => {
      armedRef.current = true;
    }, 700);
    return () => clearTimeout(t);
  }, []);
  const next = () => {
    if (armedRef.current) onNext();
  };

  return (
    <section className="bt-box bt-split-box" aria-label="Answer">
      <div className="bt-split">
        <div className="bt-split-main" aria-live="polite">
          {bonusDone && session.bonus ? <BonusResults bonus={session.bonus} /> : null}
          <div className="bt-outcome-head">
            <span className="big-icon" aria-hidden>
              {icon}
            </span>
            <div className="stack" style={{ gap: 2 }}>
              <h2>{headline}</h2>
              {hitline ? <p className="bt-hitline">{hitline}</p> : null}
            </div>
          </div>
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
                {opponentName} said “{a.answer || '…'}” {a.result === 'correct' ? '✓' : '✗'}
                {a.result !== 'correct' && session.opponent?.lines?.wrong ? ` “${session.opponent.lines.wrong}”` : ''}
              </p>
            ))}
          <div className="bt-answer-card">
            <span className="label">The answer</span>
            <span className="answer-reveal">{o.canonicalAnswer}</span>
            {o.acceptedAnswers?.length ? <span className="caption">Also accepted: {o.acceptedAnswers.join(', ')}</span> : null}
            {o.pronunciationNotes ? <span className="caption">Say it: {o.pronunciationNotes}</span> : null}
          </div>
          {o.explanation ? (
            <p className="bt-why">
              <strong>Why: </strong>
              {o.explanation}
            </p>
          ) : null}
          <details>
            <summary style={{ cursor: 'pointer', fontWeight: 800, minHeight: 44, display: 'flex', alignItems: 'center' }}>See every clue</summary>
            <div style={{ marginTop: 8 }}>
              <ClueReview outcome={o} attempts={current.attempts} sides={session.sides} opponentName={opponentName} myActorId={actorId} />
            </div>
          </details>
        </div>
        <div className="bt-split-side">
          {isController ? (
            <Button variant="primary" size="lg" onClick={next} autoFocus>
              {nextLabel} →
            </Button>
          ) : (
            <span className="muted">Waiting for the host…</span>
          )}
          {canSave ? (
            <Button onClick={onSave} disabled={saved}>
              {saved ? '✓ Saved' : '🗂️ Save to Review Deck'}
            </Button>
          ) : null}
          <ReportQuestion questionId={current.questionId} role="student" />
        </div>
      </div>
    </section>
  );
}

function BonusResults({ bonus }) {
  const pts = bonus.results.reduce((s, r) => s + r.points, 0);
  return (
    <div className="bt-bonus-part" style={{ background: 'var(--purple-soft)' }}>
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
    </div>
  );
}

function BonusPanel({ session, mySide, serverNow, onAnswer, onChoice, busy, onSkip, isController, opponentName, voiceEnabled }) {
  const b = session.bonus;
  const mine = b.side === mySide;
  const part = b.parts[b.partIndex];
  const owner = session.sides[b.side]?.name || opponentName;
  const open = part && b.results.length === b.partIndex;
  return (
    <section className="bt-box bt-split-box" aria-label="Bonus round">
      <div className={`bt-split ${open && mine && part?.choices ? 'has-choices' : ''}`}>
        <div className="bt-split-main">
          <div className="row-between">
            <h2 className="bt-say" style={{ margin: 0 }}>
              🎁 Bonus round!
            </h2>
            <Chip tone="sun">
              Part {Math.min(b.partIndex + 1, b.parts.length)} of 3 · {owner}
            </Chip>
          </div>
          {b.leadin ? <p className="muted">{b.leadin}</p> : null}
          {b.results.map((r, i) => (
            <div key={i} className="bt-bonus-part">
              <p>{b.parts[i].text}</p>
              <p>
                {r.result === 'correct' ? '✓' : '✗'} <strong>{r.canonicalAnswer}</strong>
                {r.answer && r.result !== 'correct' ? <span className="muted"> (said “{r.answer}”)</span> : null}
              </p>
              {r.explanation ? <p className="caption">{r.explanation}</p> : null}
            </div>
          ))}
          {open ? (
            <p className="bt-clue latest" aria-live="polite">
              {part.text}
            </p>
          ) : null}
        </div>
        <div className="bt-split-side" style={{ justifyContent: 'center' }}>
          {open && mine ? (
            <>
              <div className="bt-answer" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
                {part?.choices ? (
                  <ChoicePicker
                    key={`bc-${session.qIndex}-${b.partIndex}`}
                    choices={part.choices}
                    onPick={onChoice}
                    deadline={b.deadline}
                    total={session.rules.bonusWindowMs}
                    serverNow={serverNow}
                    busy={busy}
                    prompt="Your answer"
                  />
                ) : (
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
                )}
              </div>
              {isController && session.mode !== 'live_battle' ? (
                <Button variant="ghost" onClick={onSkip}>
                  I don't know
                </Button>
              ) : null}
            </>
          ) : open ? (
            <>
              <p className="bt-narrate" role="status">
                {session.opponent ? `${opponentName} is thinking…` : `${owner} is answering…`}
              </p>
              {b.deadline ? <Countdown deadline={b.deadline} total={session.rules.bonusWindowMs} serverNow={serverNow} /> : null}
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}
