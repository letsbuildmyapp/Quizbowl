import { useEffect, useRef, useState } from 'react';
import { Avatar, Button, Chip, Field, Modal, useToast } from '../ui.jsx';
import { READING_SPEEDS, categoryMeta } from '../../lib/catalog.js';
import { answerCase } from '../../lib/format.js';
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

// The server reads a clue over a fixed window before the next one lands, so the
// typing is derived from that schedule (revealedAt -> nextRevealAt) rather than
// run off a local timer. Switching tabs, a late update or a slow Chromebook
// can't desync it: every frame recomputes where the reading should be by now.
const TYPE_TICK_MS = 40;
const CLUE_GAP_MS = 700; // the server's beat between clues; stop typing before it

/** Words per second the server uses, for the modes with no scheduled next clue. */
function estimateMs(text, readingSpeed) {
  const wps = READING_SPEEDS[readingSpeed]?.wordsPerSecond || READING_SPEEDS.medium.wordsPerSecond;
  const words = String(text || '').trim().split(/\s+/).filter(Boolean).length;
  return Math.max(2200, Math.round((words / wps) * 1000));
}

/**
 * A clue appearing at the pace it is being "read", the way a moderator says it.
 * The untyped words stay in the layout (hidden, not absent) so the box never
 * reflows and the buzzer never shifts under a kid's thumb mid-sentence.
 */
export function TypedClue({ text, from, to, frozenAt, serverNow, readingSpeed, instant }) {
  const [, bump] = useState(0);
  const scheduled = from != null && to != null ? to - from - CLUE_GAP_MS : 0;
  const span = scheduled > 0 ? scheduled : from != null ? estimateMs(text, readingSpeed) : 0;
  const live = !instant && span > 0 && frozenAt == null;

  useEffect(() => {
    if (!live) return undefined;
    const id = setInterval(() => {
      bump((n) => n + 1);
      if (serverNow() - from >= span) clearInterval(id);
    }, TYPE_TICK_MS);
    return () => clearInterval(id);
  }, [live, text, from, span, serverNow]);

  let cut = text.length;
  if (!instant && span > 0 && from != null) {
    const at = frozenAt ?? serverNow();
    const progress = Math.max(0, Math.min(1, (at - from) / span));
    cut = Math.round(text.length * progress);
  }
  const typing = cut < text.length;

  return (
    <>
      {/* Screen readers get the whole clue once; they should not hear it letter by letter. */}
      <span className="sr-only">{text}</span>
      <span className={`typed ${typing ? 'is-typing' : ''}`} aria-hidden="true">
        <span className="typed-shown">{text.slice(0, cut)}</span>
        <span className="typed-rest">{text.slice(cut)}</span>
      </span>
    </>
  );
}

export function ClueStage({ current, large, serverNow, readingSpeed, instant }) {
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
        {current.clues.map((c, i) => {
          const latest = i === current.clues.length - 1;
          return (
            <p key={i} ref={latest ? latestRef : null} className={`clue ${latest ? 'latest' : ''}`}>
              {latest && serverNow ? (
                <TypedClue
                  text={c}
                  from={current.revealedAt?.[i]}
                  to={current.nextRevealAt ?? current.readingDoneAt}
                  frozenAt={current.holdStartedAt}
                  serverNow={serverNow}
                  readingSpeed={readingSpeed}
                  instant={instant}
                />
              ) : (
                c
              )}
            </p>
          );
        })}
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

const LETTERS = ['A', 'B', 'C', 'D'];

/**
 * Multiple choice answers: four big buttons. Keys 1-4 or A-D pick; the pick is
 * sent once (the server scores it). Used for tossups (after a buzz) and bonus parts.
 */
export function ChoicePicker({ choices, onPick, deadline, total, serverNow, busy, prompt = 'Pick your answer', autoFocus = true }) {
  const [picked, setPicked] = useState(null);
  const firstRef = useRef(null);
  useEffect(() => {
    if (autoFocus) firstRef.current?.focus();
  }, [autoFocus]);
  const pick = (i) => {
    if (picked != null || busy || i < 0 || i >= choices.length) return;
    setPicked(i);
    onPick(i);
  };
  useEffect(() => {
    const onKey = (e) => {
      if (e.target?.tagName === 'INPUT' || e.target?.tagName === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toUpperCase();
      const i = /^[1-4]$/.test(k) ? Number(k) - 1 : LETTERS.indexOf(k);
      if (i >= 0 && i < choices.length) {
        e.preventDefault();
        pick(i);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return (
    <div className="choice-picker" role="group" aria-label={prompt}>
      <span className="label">{prompt}</span>
      <div className="choice-grid">
        {choices.map((c, i) => (
          <button
            key={`${i}-${c}`}
            ref={i === 0 ? firstRef : null}
            type="button"
            className={`choice-btn ${picked === i ? 'is-picked' : ''}`}
            onClick={() => pick(i)}
            disabled={busy || (picked != null && picked !== i)}
            aria-pressed={picked === i}
            aria-keyshortcuts={`${i + 1} ${LETTERS[i]}`}
          >
            <span className="choice-key" aria-hidden>
              {LETTERS[i]}
            </span>
            <span className="choice-text">{answerCase(c)}</span>
          </button>
        ))}
      </div>
      {deadline ? <Countdown deadline={deadline} total={total} serverNow={serverNow} label="Answer time" /> : null}
      <span className="caption" aria-hidden>
        Press 1 to 4 or A to D
      </span>
    </div>
  );
}
