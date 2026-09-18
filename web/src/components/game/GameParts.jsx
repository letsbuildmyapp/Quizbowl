import { useEffect, useRef, useState } from 'react';
import { Avatar, Button, Chip, Field, Modal, useToast } from '../ui.jsx';
import { categoryMeta } from '../../lib/catalog.js';
import { flagQuestion } from '../../lib/game.js';
import './game.css';

export function Scoreboard({ session, mySide }) {
  const sides = Object.entries(session.sides || {});
  const [a, b] = sides;
  const cat = session.current ? categoryMeta(session.current.category) : null;
  const side = ([key, s], right) => (
    <div className={`score-side ${right ? 'right' : ''} ${mySide === key ? 'is-me' : ''}`}>
      {!right && <Avatar emoji={s.emoji} />}
      <div className="stack" style={{ gap: 2, minWidth: 0 }}>
        <span className="score-name">
          {s.name}
          {mySide === key && sides.length > 1 ? <span className="sr-only"> (you)</span> : null}
        </span>
        <span className="score-value" aria-label={`${s.name} score ${s.score}`}>
          {s.score}
        </span>
      </div>
      {right && <Avatar emoji={s.emoji} />}
    </div>
  );
  return (
    <div className="scoreboard" role="group" aria-label="Scoreboard">
      {side(a, false)}
      <div className="score-mid">
        <span className="caption tabular">
          {session.qIndex >= 0 ? `Question ${Math.min(session.qIndex + 1, session.total)} of ${session.total}` : `${session.total} questions`}
        </span>
        {cat ? (
          <Chip style={{ background: `color-mix(in srgb, ${cat.color} 16%, transparent)`, color: 'var(--ink)' }}>
            <span aria-hidden>{cat.emoji}</span> {cat.id}
          </Chip>
        ) : null}
      </div>
      {b ? side(b, true) : <div />}
    </div>
  );
}

export function ClueStage({ current, large }) {
  const latestRef = useRef(null);
  if (!current) return null;
  return (
    <section className={`clue-stage ${large ? 'host-stage' : ''}`} aria-label="Clues">
      <div className="row-between">
        <div className="clue-dots" aria-label={`Clue ${current.clues.length} of ${current.clueCount}`}>
          {Array.from({ length: current.clueCount }, (_, i) => (
            <span key={i} className={i < current.clues.length ? 'on' : ''} />
          ))}
        </div>
        <span className="caption tabular">
          Clue {current.clues.length} of {current.clueCount}
        </span>
      </div>
      {current.leadin ? <p className="leadin">{current.leadin}</p> : null}
      <div aria-live="polite" aria-atomic="false" className="stack" style={{ gap: 10 }}>
        {current.clues.map((c, i) => (
          <p key={i} ref={i === current.clues.length - 1 ? latestRef : null} className={`clue ${i === current.clues.length - 1 ? 'latest' : ''}`}>
            {c}
          </p>
        ))}
      </div>
    </section>
  );
}

export function Countdown({ deadline, total, serverNow, label = 'Time left' }) {
  const [, setT] = useState(0);
  useEffect(() => {
    if (!deadline) return undefined;
    const id = setInterval(() => setT((t) => t + 1), 100);
    return () => clearInterval(id);
  }, [deadline]);
  if (!deadline) return null;
  const left = Math.max(0, deadline - serverNow());
  const pct = Math.max(0, Math.min(100, (left / total) * 100));
  const secs = Math.ceil(left / 1000);
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className={`countdown ${pct < 30 ? 'low' : ''}`} role="timer" aria-label={`${label}: ${secs} seconds`}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <span className="caption tabular" aria-hidden>
        {secs}s
      </span>
    </div>
  );
}

/** Answer input with optional voice (browser speech recognition, teacher-enabled). */
export function AnswerBox({ onSubmit, deadline, total, serverNow, prompt = 'Type your answer', voiceEnabled, disabled, busy }) {
  const [text, setText] = useState('');
  const [heard, setHeard] = useState(null);
  const [listening, setListening] = useState(false);
  const inputRef = useRef(null);
  const recRef = useRef(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  const SR = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
  const canVoice = voiceEnabled && !!SR;
  const listen = () => {
    if (!SR) return;
    const rec = new SR();
    rec.lang = 'en-US';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      const said = e.results[0][0].transcript;
      setHeard(said);
      setText(said);
      inputRef.current?.focus();
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  };
  useEffect(() => () => recRef.current?.abort?.(), []);
  const submit = (e) => {
    e?.preventDefault();
    if (disabled || busy) return;
    onSubmit(text.trim());
  };
  return (
    <form className="answer-box" onSubmit={submit}>
      <label htmlFor="answer-input" className="label">
        {prompt}
      </label>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <input
          id="answer-input"
          ref={inputRef}
          className="input input-lg"
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          maxLength={120}
          disabled={disabled}
        />
        {canVoice ? (
          <Button onClick={listen} disabled={listening || disabled} aria-label="Answer out loud" className="btn-icon" style={{ width: 56, minHeight: 60 }}>
            {listening ? '…' : '🎤'}
          </Button>
        ) : null}
      </div>
      {heard ? <p className="caption">We heard “{heard}”. Fix it if needed, then press Enter.</p> : null}
      <Countdown deadline={deadline} total={total} serverNow={serverNow} label="Answer time" />
      <Button variant="primary" size="lg" type="submit" loading={busy} disabled={disabled}>
        Submit answer
      </Button>
    </form>
  );
}

const FLAG_REASONS = [
  ['wrong_answer', 'The answer is wrong'],
  ['should_accept', 'My answer should count'],
  ['confusing', 'The question is confusing'],
  ['typo', 'There is a typo'],
  ['not_appropriate', "It's not right for my class"]
];

export function ReportQuestion({ questionId, role }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(FLAG_REASONS[0][0]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const submit = async () => {
    setBusy(true);
    try {
      await flagQuestion(questionId, reason, note, role);
      toast('Thanks! A grown-up will check this question.', { emoji: '🚩' });
      setOpen(false);
      setNote('');
    } catch {
      toast("Couldn't send that. Try again.", { emoji: '⚠️' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        🚩 Report a problem
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Report this question"
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={submit} loading={busy}>
              Send report
            </Button>
          </>
        }
      >
        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 4 }}>
          <legend className="label" style={{ marginBottom: 8 }}>
            What's wrong?
          </legend>
          {FLAG_REASONS.map(([v, l]) => (
            <label key={v} className="check">
              <input type="radio" name="flag-reason" value={v} checked={reason === v} onChange={() => setReason(v)} />
              {l}
            </label>
          ))}
        </fieldset>
        <Field label="Anything else? (optional)">
          {(id) => <textarea id={id} className="textarea" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />}
        </Field>
      </Modal>
    </>
  );
}

/** Clue-by-clue review with where each player buzzed. */
export function ClueReview({ outcome, attempts = [], sides, opponentName, myActorId }) {
  const { allClues = [], powerClueIndex, computerPlan } = outcome;
  return (
    <ol className="clue-review" aria-label="Clue by clue">
      {allClues.map((text, i) => {
        const marks = [];
        for (const a of attempts) {
          if (a.clueIndex !== i) continue;
          const who = a.actorId === myActorId ? 'You' : a.kind === 'computer' ? opponentName : sides?.[a.side]?.name || 'Opponent';
          marks.push(
            <Chip key={`${a.actorId}-${a.buzzAt}`} tone={a.result === 'correct' ? 'green' : 'coral'}>
              {a.result === 'correct' ? '✓' : '✗'} {who} buzzed
            </Chip>
          );
        }
        if (computerPlan && computerPlan.buzzClue === i && !attempts.some((a) => a.kind === 'computer')) {
          marks.push(
            <Chip key="plan" tone="gray">
              🤖 {opponentName} was ready here
            </Chip>
          );
        }
        const power = powerClueIndex != null && i <= powerClueIndex;
        return (
          <li key={i} className={power ? 'power' : ''}>
            <span className="num" aria-hidden>
              {i + 1}
            </span>
            <div>
              <p>{text}</p>
              <div className="marks">
                {power ? <Chip tone="sun">⚡ Power zone</Chip> : null}
                {marks}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
