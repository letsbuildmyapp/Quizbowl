// Class settings: leaderboard, computer opponent range, match rules, accessibility, voice answers,
//   rewards and motion (settings.rewards, defaults from rewards.defaultClassRewards).
// Firestore reads: classrooms (via useClassroom).
// Firestore writes: classrooms/{id} update { settings }.
import { useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase.js';
import { useClassroom } from '../../hooks/useClassroom.js';
import { DEFAULT_RULES, READING_SPEEDS, TIER_LABELS } from '../../lib/catalog.js';
import { rewards as rewardConfig } from '../../lib/rewards.js';
import { Button, Card, ErrorNote, Field, Segmented, friendlyError, useToast } from '../../components/ui.jsx';
import { ClassGate, TeacherHeader } from '../../components/teacher/TeacherPage.jsx';

const SPEEDS = ['slow', 'medium', 'fast'].map((v) => ({ value: v, label: READING_SPEEDS[v]?.label || v }));
const TIERS = TIER_LABELS.map((label, value) => ({ value, label }));

function withDefaults(settings = {}) {
  return {
    leaderboard: settings.leaderboard || 'class',
    opponentMinTier: settings.opponentMinTier ?? 0,
    opponentMaxTier: settings.opponentMaxTier ?? 3,
    rules: { ...DEFAULT_RULES, ...(settings.rules || {}) },
    accessibility: { readingSpeed: 'medium', readAloud: false, reducedMotion: false, largeText: false, ...(settings.accessibility || {}) },
    voiceAnswers: !!settings.voiceAnswers,
    rewards: { ...rewardConfig.defaultClassRewards, ...(settings.rewards || {}) }
  };
}

const HALL_FIELDS = [
  { value: 'loadout', label: 'QuizBot and gear' },
  { value: 'level', label: 'Level' },
  { value: 'featuredBadge', label: 'Featured badge' },
  { value: 'featuredItems', label: 'Featured items' },
  { value: 'worldsMastered', label: 'Worlds mastered' }
];

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function NumberField({ label, hint, value, min, max, onChange, disabled }) {
  return (
    <Field label={label} hint={hint}>
      {(id) => (
        <input
          id={id}
          type="number"
          className="input tabular"
          value={value}
          min={min}
          max={max}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          onBlur={(e) => onChange(clamp(Number(e.target.value) || 0, min, max))}
        />
      )}
    </Field>
  );
}

function Toggle({ label, checked, onChange, hint }) {
  return (
    <div className="stack" style={{ gap: 2 }}>
      <label className="check">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        {label}
      </label>
      {hint ? <span className="caption">{hint}</span> : null}
    </div>
  );
}

function SettingsForm({ classroom }) {
  const toast = useToast();
  const [draft, setDraft] = useState(() => withDefaults(classroom.settings));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const setRule = (patch) => setDraft((d) => ({ ...d, rules: { ...d.rules, ...patch } }));
  const setA11y = (patch) => setDraft((d) => ({ ...d, accessibility: { ...d.accessibility, ...patch } }));
  const setRewards = (patch) => setDraft((d) => ({ ...d, rewards: { ...d.rewards, ...patch } }));
  const toggleHallField = (field, on) =>
    setRewards({ hallPeerFields: HALL_FIELDS.map((f) => f.value).filter((v) => (v === field ? on : draft.rewards.hallPeerFields.includes(v))) });
  const r = draft.rules;
  const rw = draft.rewards;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const rules = {
        ...r,
        matchLength: clamp(Number(r.matchLength) || 10, 5, 20),
        tossupPoints: clamp(Number(r.tossupPoints) || 10, 1, 50),
        powerPoints: clamp(Number(r.powerPoints) || 15, 1, 50),
        negPoints: -Math.abs(clamp(Math.abs(Number(r.negPoints) || 5), 1, 50)),
        answerWindowMs: clamp(Number(r.answerWindowMs) || 5000, 3000, 15000)
      };
      await updateDoc(doc(db, 'classrooms', classroom.id), { settings: { ...draft, rules } });
      toast('Class settings saved');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack-lg">
      <Card className="stack">
        <h2>Leaderboard</h2>
        <Segmented
          label="Leaderboard visibility"
          value={draft.leaderboard}
          onChange={(v) => set({ leaderboard: v })}
          options={[
            { value: 'class', label: 'Individual ranks' },
            { value: 'teams', label: 'Team totals only' },
            { value: 'off', label: 'Off' }
          ]}
        />
        <p className="caption">
          {draft.leaderboard === 'class'
            ? 'Students see a weekly class ranking. Students can opt out of it themselves.'
            : draft.leaderboard === 'teams'
              ? 'Students see team totals, never individual ranks.'
              : 'Students see no rankings.'}
        </p>
      </Card>

      <Card className="stack">
        <h2>Computer opponent range</h2>
        <p className="muted">Students only face computer opponents inside this range. The adaptive rival stays inside it too.</p>
        <div className="grid-2">
          <Field label="Easiest opponent">
            {(id) => (
              <select
                id={id}
                className="select"
                value={draft.opponentMinTier}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  set({ opponentMinTier: v, opponentMaxTier: Math.max(v, draft.opponentMaxTier) });
                }}
              >
                {TIERS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Hardest opponent">
            {(id) => (
              <select
                id={id}
                className="select"
                value={draft.opponentMaxTier}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  set({ opponentMaxTier: v, opponentMinTier: Math.min(v, draft.opponentMinTier) });
                }}
              >
                {TIERS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
      </Card>

      <Card className="stack-lg">
        <h2>Match rules</h2>
        <div className="grid-2">
          <NumberField label="Questions per match" hint="5 to 20" value={r.matchLength} min={5} max={20} onChange={(v) => setRule({ matchLength: v })} />
          <NumberField
            label="Answer window (seconds)"
            hint="3 to 15"
            value={r.answerWindowMs === '' ? '' : Math.round(r.answerWindowMs / 1000)}
            min={3}
            max={15}
            onChange={(v) => setRule({ answerWindowMs: v === '' ? '' : v * 1000 })}
          />
          <NumberField label="Points for a correct tossup" value={r.tossupPoints} min={1} max={50} onChange={(v) => setRule({ tossupPoints: v })} />
        </div>
        <div className="field">
          <span className="label">Reading speed</span>
          <Segmented label="Match reading speed" value={r.readingSpeed} onChange={(v) => setRule({ readingSpeed: v })} options={SPEEDS} />
        </div>
        <div className="grid-2">
          <div className="stack" style={{ gap: 8 }}>
            <Toggle label="Power points for early buzzes" checked={!!r.powerEnabled} onChange={(v) => setRule({ powerEnabled: v })} />
            <NumberField label="Power points" value={r.powerPoints} min={1} max={50} disabled={!r.powerEnabled} onChange={(v) => setRule({ powerPoints: v })} />
          </div>
          <div className="stack" style={{ gap: 8 }}>
            <Toggle label="Take points off for wrong interrupts" checked={!!r.negEnabled} onChange={(v) => setRule({ negEnabled: v })} />
            <NumberField
              label="Points taken off"
              value={r.negPoints === '' ? '' : Math.abs(r.negPoints)}
              min={1}
              max={50}
              disabled={!r.negEnabled}
              onChange={(v) => setRule({ negPoints: v === '' ? '' : -Math.abs(v) })}
            />
          </div>
        </div>
        <Toggle label="Bonus questions after a correct tossup" checked={!!r.bonusesEnabled} onChange={(v) => setRule({ bonusesEnabled: v })} />
      </Card>

      <Card className="stack">
        <h2>Accessibility defaults</h2>
        <p className="muted">New students start with these. Students can change their own settings.</p>
        <div className="field">
          <span className="label">Reading speed</span>
          <Segmented label="Default reading speed" value={draft.accessibility.readingSpeed} onChange={(v) => setA11y({ readingSpeed: v })} options={SPEEDS} />
        </div>
        <Toggle label="Read questions aloud" checked={!!draft.accessibility.readAloud} onChange={(v) => setA11y({ readAloud: v })} />
        <Toggle label="Reduced motion" checked={!!draft.accessibility.reducedMotion} onChange={(v) => setA11y({ reducedMotion: v })} />
        <Toggle label="Large text" checked={!!draft.accessibility.largeText} onChange={(v) => setA11y({ largeText: v })} />
      </Card>

      <Card className="stack">
        <h2>Voice answers</h2>
        <Toggle label="Let students say their answers" checked={draft.voiceAnswers} onChange={(v) => set({ voiceAnswers: v })} />
        <div className="alert alert-info">
          The browser's speech recognition may process audio outside QuizQuest. Leave this off unless your school approves it.
        </div>
      </Card>

      <Card className="stack">
        <h2>Rewards and motion</h2>
        <p className="muted">How chests, streaks, celebrations, and the Quiz Hall work in this class.</p>
        <Toggle
          label="Random chest contents"
          checked={!!rw.randomChests}
          onChange={(v) => setRewards({ randomChests: v })}
          hint={rw.randomChests ? 'Chests give a random item the student does not own yet.' : 'Chests give the best item the student does not own yet. No randomness.'}
        />
        <Toggle label="Show daily streaks to students" checked={!!rw.showStreaks} onChange={(v) => setRewards({ showStreaks: v })} />
        <div className="field">
          <span className="label">Celebrations</span>
          <Segmented
            label="Celebration style"
            value={rw.celebrations}
            onChange={(v) => setRewards({ celebrations: v })}
            options={[
              { value: 'standard', label: 'Standard' },
              { value: 'calm', label: 'Calm' }
            ]}
          />
          <span className="hint">
            {rw.celebrations === 'calm' ? 'Fewer particles, no screen shake, and shorter celebrations.' : 'Full reward reveals and celebrations.'}
          </span>
        </div>
        <Toggle
          label="Let classmates see each other's Quiz Hall"
          checked={!!rw.hallPeerView}
          onChange={(v) => setRewards({ hallPeerView: v })}
          hint="Each student still chooses whether to share. Halls are private by default."
        />
        <fieldset className="t-fieldset" disabled={!rw.hallPeerView}>
          <legend className="label">Classmates can see</legend>
          {HALL_FIELDS.map((f) => (
            <label key={f.value} className="check">
              <input type="checkbox" checked={rw.hallPeerFields.includes(f.value)} onChange={(e) => toggleHallField(f.value, e.target.checked)} />
              {f.label}
            </label>
          ))}
        </fieldset>
      </Card>

      {error ? <ErrorNote>{error}</ErrorNote> : null}
      <div className="row">
        <Button variant="primary" size="lg" onClick={save} loading={busy}>
          Save settings
        </Button>
        <Button variant="ghost" onClick={() => setDraft(withDefaults(classroom.settings))}>
          Discard changes
        </Button>
      </div>
    </div>
  );
}

export default function ClassSettings() {
  const cls = useClassroom();
  return (
    <div className="page stack-lg">
      <TeacherHeader cls={cls} title="Class settings" subtitle="Rules and defaults for this class." />
      <ClassGate cls={cls}>{cls.classroom ? <SettingsForm key={cls.classroom.id} classroom={cls.classroom} /> : null}</ClassGate>
    </div>
  );
}
