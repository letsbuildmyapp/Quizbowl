// Mode select: Learn & Practice, Solo Score Attack, Battle the Computer
// (quick or custom), Team Quest, Review Deck. Live Team Battles are started by
// the teacher and appear on the home screen.
// Reads: students/{id} (useAuth), classrooms/{classroomId} (opponent range, rules)
// Writes: sessionRequests
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth.jsx';
import { useDoc } from '../../hooks/useFirestore.js';
import { Button, ButtonLink, Card, Chip, ErrorNote, Field, PageHeader, Segmented } from '../../components/ui.jsx';
import { startSession } from '../../lib/game.js';
import { CATEGORIES, PERSONAS, TIER_LABELS } from '../../lib/catalog.js';

const CATEGORY_OPTIONS = [{ value: '', label: 'Mixed' }, ...CATEGORIES.map((c) => ({ value: c.id, label: `${c.emoji} ${c.id}` }))];

function CategorySelect({ value, onChange, id }) {
  return (
    <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value)}>
      {CATEGORY_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export default function Modes() {
  const { student, claims } = useAuth();
  const navigate = useNavigate();
  const { data: classroom } = useDoc(claims.classroomId ? `classrooms/${claims.classroomId}` : null);
  const [starting, setStarting] = useState(null);
  const [err, setErr] = useState(null);

  // Practice
  const [pCat, setPCat] = useState('');
  const [pDiff, setPDiff] = useState('');
  const [pCount, setPCount] = useState(8);
  const [pSpeed, setPSpeed] = useState('manual');
  const [pUntimed, setPUntimed] = useState(true);
  // Score attack
  const [sCat, setSCat] = useState('');
  // Versus custom
  const minTier = classroom?.settings?.opponentMinTier ?? 0;
  const maxTier = classroom?.settings?.opponentMaxTier ?? 3;
  const available = PERSONAS.filter((p) => p.adaptive || (p.tier >= minTier && p.tier <= maxTier));
  const [persona, setPersona] = useState('adaptive-rival');
  const [vCat, setVCat] = useState('');
  const [vCount, setVCount] = useState(classroom?.settings?.rules?.matchLength || 10);
  const [vSpeed, setVSpeed] = useState(student?.settings?.readingSpeed || 'medium');

  const go = async (key, mode, options) => {
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

  const best = student?.personalBests?.score_attack;

  return (
    <div className="page stack-xl">
      <PageHeader eyebrow="Play" title="Choose your mode" subtitle="Every question you answer earns XP, cards, and progress for your team." />
      <ErrorNote error={err} />

      <Card className="stack-lg" tone="coral">
        <div className="row-between">
          <div className="stack" style={{ gap: 4 }}>
            <h2>⚔️ Battle the Computer</h2>
            <p>Race a computer rival to the buzzer. It plays fair: it has to wait for clues just like you.</p>
          </div>
          <Button variant="coral" size="lg" loading={starting === 'quick'} onClick={() => go('quick', 'versus', { personaId: 'adaptive-rival', count: classroom?.settings?.rules?.matchLength || 10 })}>
            Quick match
          </Button>
        </div>
        <div className="stack">
          <span className="label">Or pick your rival</span>
          <div className="grid-3" role="radiogroup" aria-label="Rival">
            {available.map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={persona === p.id}
                onClick={() => setPersona(p.id)}
                className="card card-tight"
                style={{
                  textAlign: 'left',
                  cursor: 'pointer',
                  borderWidth: 2,
                  borderColor: persona === p.id ? 'var(--purple)' : 'var(--line)',
                  font: 'inherit',
                  color: 'inherit'
                }}
              >
                <div className="row" style={{ flexWrap: 'nowrap' }}>
                  <span style={{ fontSize: 36 }} aria-hidden>
                    {p.avatar}
                  </span>
                  <div className="stack" style={{ gap: 2 }}>
                    <strong>{p.name}</strong>
                    <span className="caption">
                      {p.difficulty} · {p.strengths}
                    </span>
                  </div>
                  {persona === p.id ? (
                    <Chip tone="purple" style={{ marginLeft: 'auto' }}>
                      ✓
                    </Chip>
                  ) : null}
                </div>
              </button>
            ))}
          </div>
          {available.length < PERSONAS.length ? (
            <p className="caption">
              Your teacher set rivals from {TIER_LABELS[minTier]} to {TIER_LABELS[maxTier]}.
            </p>
          ) : null}
        </div>
        <div className="grid-3">
          <Field label="Category">{(id) => <CategorySelect id={id} value={vCat} onChange={setVCat} />}</Field>
          <Field label="Questions">
            {(id) => (
              <select id={id} className="select" value={vCount} onChange={(e) => setVCount(Number(e.target.value))}>
                {[5, 10, 15, 20].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Reading speed">
            {(id) => (
              <select id={id} className="select" value={vSpeed} onChange={(e) => setVSpeed(e.target.value)}>
                <option value="slow">Slow</option>
                <option value="medium">Medium</option>
                <option value="fast">Fast</option>
              </select>
            )}
          </Field>
        </div>
        <Button variant="primary" size="lg" loading={starting === 'custom'} onClick={() => go('custom', 'versus', { personaId: persona, category: vCat || undefined, count: vCount, readingSpeed: vSpeed })}>
          Start custom match
        </Button>
      </Card>

      <div className="grid-2">
        <Card className="stack-lg" tone="teal">
          <div className="stack" style={{ gap: 4 }}>
            <h2>📘 Learn & Practice</h2>
            <p>Take your time. See the answer and why after every question.</p>
          </div>
          <Field label="Category">{(id) => <CategorySelect id={id} value={pCat} onChange={setPCat} />}</Field>
          <div className="stack" style={{ gap: 6 }}>
            <span className="label">Difficulty</span>
            <Segmented label="Difficulty" value={pDiff} onChange={setPDiff} options={[{ value: '', label: 'Any' }, { value: '1', label: 'Easy' }, { value: '2', label: 'Medium' }, { value: '3', label: 'Hard' }]} />
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <span className="label">Clues</span>
            <Segmented label="Clue pace" value={pSpeed} onChange={setPSpeed} options={[{ value: 'manual', label: 'I tap for the next one' }, { value: 'slow', label: 'Slow' }, { value: 'medium', label: 'Medium' }]} />
          </div>
          <div className="grid-2">
            <Field label="Questions">
              {(id) => (
                <select id={id} className="select" value={pCount} onChange={(e) => setPCount(Number(e.target.value))}>
                  {[5, 8, 10, 15].map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              )}
            </Field>
            <label className="check" style={{ alignSelf: 'end' }}>
              <input type="checkbox" checked={pUntimed} onChange={(e) => setPUntimed(e.target.checked)} />
              No answer timer
            </label>
          </div>
          <Button variant="teal" size="lg" loading={starting === 'practice'} onClick={() => go('practice', 'practice', { category: pCat || undefined, difficulty: pDiff || undefined, count: pCount, readingSpeed: pSpeed, untimed: pUntimed })}>
            Start practice
          </Button>
        </Card>

        <Card className="stack-lg" tone="sun">
          <div className="stack" style={{ gap: 4 }}>
            <h2>🎯 Solo Score Attack</h2>
            <p>10 timed questions. Beat your best score, accuracy, streak, or early-buzz score.</p>
          </div>
          {best ? (
            <div className="grid-2" style={{ gap: 8 }}>
              <Chip tone="gray">Best score {best.points}</Chip>
              <Chip tone="gray">Best accuracy {best.accuracy}%</Chip>
              <Chip tone="gray">Best streak {best.streak}</Chip>
              <Chip tone="gray">Early buzz {best.earlyBuzz}</Chip>
            </div>
          ) : (
            <p className="muted">No personal best yet. Set one!</p>
          )}
          <Field label="Category">{(id) => <CategorySelect id={id} value={sCat} onChange={setSCat} />}</Field>
          <Button variant="sun" size="lg" loading={starting === 'score'} onClick={() => go('score', 'score_attack', { category: sCat || undefined, count: 10 })}>
            Start Score Attack
          </Button>
        </Card>
      </div>

      <div className="grid-2">
        <Card className="stack">
          <h2>🤝 Team Quest</h2>
          <p className="muted">Answer questions to fill your team's weekly goal.</p>
          <ButtonLink to="/play/team">See my team quest</ButtonLink>
        </Card>
        <Card className="stack">
          <h2>🗂️ Review Deck</h2>
          <p className="muted">Practice the questions you saved.</p>
          <Button loading={starting === 'review'} onClick={() => go('review', 'review')}>
            Practice my deck ({student?.reviewDeckCount || 0})
          </Button>
        </Card>
      </div>
      <p className="caption">Live Team Battles start from your teacher's screen. When one begins, a Join button shows up on your home page.</p>
    </div>
  );
}
