// School admin: school theme (preset + overrides, live preview) and school reward catalog.
// Firestore writes:
//   schools/{schoolId} update { theme: { presetId, ...overrides } } (only the keys the rules allow)
//   schools/{schoolId} update { rewardCatalog: { approved: [itemIds] } | null }
// A trigger projects both to schoolThemes/{schoolId} for students.
import { useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase.js';
import { THEMES, resolveTheme, rewards } from '../../lib/rewards.js';
import { Crest, ItemArt, ProgressVisual, QuizBot, itemDisplayName } from '../bot/index.js';
import { luminance } from '../bot/util.js';
import { Button, Card, ErrorNote, Field, Segmented, friendlyError, useToast } from '../ui.jsx';

const TEXT_FIELDS = [
  { key: 'displayName', label: 'Display name', hint: 'For example: Westside Warriors', max: 40 },
  { key: 'mascotName', label: 'Mascot name', hint: 'Used in gear names, like "Warrior Cape".', max: 24 },
  { key: 'teamHubLabel', label: 'Team hub label', hint: 'Name of the team page students see.', max: 40 },
  { key: 'weeklyQuestLabel', label: 'Weekly quest label', hint: 'Name of the school-wide weekly goal.', max: 40 },
  { key: 'modeLabel', label: 'Mode label', hint: 'Shown on themed screens.', max: 40 },
  { key: 'seasonLabel', label: 'Season label', hint: 'Optional. For example: Spring Season', max: 40 }
];
const COLOR_FIELDS = [
  { key: 'primaryColor', label: 'Primary color' },
  { key: 'secondaryColor', label: 'Secondary color' },
  { key: 'accentColor', label: 'Accent color' }
];
const OVERRIDE_KEYS = [
  'displayName',
  'mascotName',
  'crestLetter',
  'primaryColor',
  'secondaryColor',
  'accentColor',
  'teamHubLabel',
  'weeklyQuestLabel',
  'progressVisual',
  'progressLabel',
  'modeLabel',
  'seasonLabel'
];
const HEX = /^#[0-9a-f]{6}$/i;
const PREVIEW_LOADOUT = { ...rewards.starterLoadout, paint: 'paint-school', headgear: 'head-school', back: 'back-school', held: 'buzzer-school' };
export const SCHOOL_ITEMS = rewards.cosmetics.filter((c) => c.school);

export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function draftFrom(theme) {
  const t = resolveTheme(theme);
  const out = { presetId: THEMES[t.presetId] ? t.presetId : 'quizquest' };
  for (const k of OVERRIDE_KEYS) out[k] = t[k] ?? '';
  return out;
}

/** Keep only the values that differ from the preset, so preset updates still flow through. */
function toSaved(draft) {
  const base = THEMES[draft.presetId] || THEMES.quizquest;
  const out = { presetId: draft.presetId };
  for (const k of OVERRIDE_KEYS) {
    const v = typeof draft[k] === 'string' ? draft[k].trim() : draft[k];
    if (v === '' || v == null) continue;
    if (v !== (base[k] ?? '')) out[k] = v;
  }
  return out;
}

function validate(d) {
  const problems = [];
  if (!d.displayName.trim()) problems.push('Add a display name.');
  if (!d.mascotName.trim()) problems.push('Add a mascot name.');
  if ([...d.crestLetter.trim()].length !== 1) problems.push('The crest letter must be exactly 1 character.');
  for (const c of COLOR_FIELDS) if (!HEX.test(d[c.key])) problems.push(`${c.label} must be a hex color like #c8102e.`);
  return problems;
}

function ColorField({ label, value, onChange }) {
  const [text, setText] = useState(value);
  const [prev, setPrev] = useState(value);
  if (value !== prev) {
    setPrev(value);
    setText(value);
  }
  return (
    <Field label={label} hint="Pick a color or type a hex code.">
      {(id) => (
        <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
          <input
            type="color"
            className="t-color-swatch"
            aria-label={`${label} picker`}
            value={HEX.test(value) ? value : '#000000'}
            onChange={(e) => onChange(e.target.value)}
          />
          <input
            id={id}
            className="input tabular"
            value={text}
            maxLength={7}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => {
              const v = e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`;
              setText(v);
              if (HEX.test(v)) onChange(v.toLowerCase());
            }}
            onBlur={() => setText(value)}
          />
        </div>
      )}
    </Field>
  );
}

export function SchoolThemeCard({ school }) {
  const toast = useToast();
  const [draft, setDraft] = useState(() => draftFrom(school.theme));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const problems = validate(draft);
  const ratio = HEX.test(draft.primaryColor) && HEX.test(draft.secondaryColor) ? contrastRatio(draft.primaryColor, draft.secondaryColor) : null;
  const preview = resolveTheme(toSaved(draft));

  const pickPreset = (id) => setDraft({ ...draftFrom({ presetId: id }), seasonLabel: draft.seasonLabel });

  const save = async () => {
    if (problems.length) return;
    setBusy(true);
    setError(null);
    try {
      await updateDoc(doc(db, 'schools', school.id), { theme: toSaved(draft) });
      toast('School theme saved');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="stack-lg" aria-labelledby="theme-title">
      <div className="stack" style={{ gap: 6 }}>
        <h2 id="theme-title">School theme</h2>
        <p className="muted prose">Sets the colors, crest, and names students see across the game.</p>
      </div>
      <div className="alert alert-info">Use original designs. Only upload or name official school marks with the school's approval.</div>

      <div className="t-theme-layout">
        <div className="stack-lg">
          <div className="field">
            <span className="label">Start from a preset</span>
            <Segmented label="Theme preset" value={draft.presetId} onChange={pickPreset} options={rewards.themes.map((t) => ({ value: t.id, label: t.displayName }))} />
            <span className="hint">Picking a preset resets the fields below to its values.</span>
          </div>

          <div className="grid-2">
            {TEXT_FIELDS.slice(0, 2).map((f) => (
              <Field key={f.key} label={f.label} hint={f.hint}>
                {(id) => <input id={id} className="input" value={draft[f.key]} maxLength={f.max} onChange={(e) => set({ [f.key]: e.target.value })} />}
              </Field>
            ))}
            <Field label="Crest letter" hint="1 character, drawn on the shield.">
              {(id) => (
                <input
                  id={id}
                  className="input"
                  value={draft.crestLetter}
                  maxLength={2}
                  onChange={(e) => set({ crestLetter: [...e.target.value.trim()].slice(-1).join('').toUpperCase() })}
                />
              )}
            </Field>
          </div>

          <div className="stack">
            <div className="grid-3">
              {COLOR_FIELDS.map((c) => (
                <ColorField key={c.key} label={c.label} value={draft[c.key]} onChange={(v) => set({ [c.key]: v })} />
              ))}
            </div>
            {ratio != null && ratio < 3 ? (
              <div className="alert alert-error" role="status">
                Primary and secondary colors have a contrast of {ratio.toFixed(1)}:1. Pick colors with at least 3:1 so the crest letter stays readable.
              </div>
            ) : ratio != null ? (
              <span className="caption tabular">Primary and secondary contrast: {ratio.toFixed(1)}:1</span>
            ) : null}
          </div>

          <div className="grid-2">
            {TEXT_FIELDS.slice(2).map((f) => (
              <Field key={f.key} label={f.label} hint={f.hint}>
                {(id) => <input id={id} className="input" value={draft[f.key]} maxLength={f.max} onChange={(e) => set({ [f.key]: e.target.value })} />}
              </Field>
            ))}
          </div>

          <div className="grid-2">
            <div className="field">
              <span className="label">Progress visual</span>
              <Segmented
                label="Progress visual"
                value={draft.progressVisual}
                onChange={(v) => set({ progressVisual: v })}
                options={[
                  { value: 'flame', label: 'Flame' },
                  { value: 'star', label: 'Star' }
                ]}
              />
            </div>
            <Field label="Progress label" hint="For example: Warrior Flame">
              {(id) => <input id={id} className="input" value={draft.progressLabel} maxLength={30} onChange={(e) => set({ progressLabel: e.target.value })} />}
            </Field>
          </div>
        </div>

        <aside className="t-theme-preview" aria-label="Theme preview" style={{ '--t-pri': preview.primaryColor, '--t-acc': preview.accentColor }}>
          <span className="stat-label">Preview</span>
          <div className="row" style={{ gap: 12, flexWrap: 'nowrap' }}>
            <Crest theme={preview} size={64} />
            <div className="stack" style={{ gap: 2, minWidth: 0 }}>
              <strong className="t-theme-name">{preview.displayName}</strong>
              <span className="caption">{[preview.modeLabel, preview.seasonLabel].filter(Boolean).join(' · ')}</span>
            </div>
          </div>
          <div className="t-theme-bot">
            <QuizBot loadout={PREVIEW_LOADOUT} theme={preview} size={150} title={`QuizBot wearing ${preview.mascotName} gear`} />
          </div>
          <ProgressVisual type={preview.progressVisual} value={60} max={100} theme={preview} size={110} label={preview.progressLabel} />
          <ul className="t-theme-labels">
            <li>
              <span className="caption">Team hub</span>
              <strong>{preview.teamHubLabel}</strong>
            </li>
            <li>
              <span className="caption">Weekly quest</span>
              <strong>{preview.weeklyQuestLabel}</strong>
            </li>
          </ul>
        </aside>
      </div>

      {problems.length ? (
        <div className="alert alert-error" role="alert">
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      <div className="row">
        <Button variant="primary" onClick={save} loading={busy} disabled={problems.length > 0}>
          Save school theme
        </Button>
        <Button variant="ghost" onClick={() => setDraft(draftFrom(school.theme))}>
          Discard changes
        </Button>
      </div>
    </Card>
  );
}

export function RewardCatalogCard({ school }) {
  const toast = useToast();
  const theme = resolveTheme(school.theme);
  const initial = () => ({ all: !school.rewardCatalog?.approved, approved: new Set(school.rewardCatalog?.approved || SCHOOL_ITEMS.map((i) => i.id)) });
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const toggle = (id, on) =>
    setDraft((d) => {
      const approved = new Set(d.approved);
      if (on) approved.add(id);
      else approved.delete(id);
      return { ...d, approved };
    });

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const rewardCatalog = draft.all ? null : { approved: SCHOOL_ITEMS.map((i) => i.id).filter((id) => draft.approved.has(id)) };
      await updateDoc(doc(db, 'schools', school.id), { rewardCatalog });
      toast('School gear list saved');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="stack-lg" aria-labelledby="catalog-title">
      <div className="stack" style={{ gap: 6 }}>
        <h2 id="catalog-title">School gear</h2>
        <p className="muted prose">Choose which school gear students can earn from the school chest or a teacher award.</p>
      </div>
      <label className="check">
        <input type="checkbox" checked={draft.all} onChange={(e) => setDraft((d) => ({ ...d, all: e.target.checked }))} />
        Approve all school gear, including gear added later
      </label>
      <ul className="t-gear-grid" aria-label="School gear">
        {SCHOOL_ITEMS.map((item) => {
          const name = itemDisplayName(item, theme);
          const on = draft.all || draft.approved.has(item.id);
          return (
            <li key={item.id}>
              <label className="t-gear-item" data-on={on}>
                <input type="checkbox" checked={on} disabled={draft.all} onChange={(e) => toggle(item.id, e.target.checked)} />
                <ItemArt itemId={item.id} theme={theme} size={56} title={name} />
                <span className="stack" style={{ gap: 2, minWidth: 0 }}>
                  <strong>{name}</strong>
                  <span className="caption">{item.unlock.type === 'teacher_award' ? 'Teachers can award it' : 'From the school quest chest'}</span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {!draft.all && draft.approved.size === 0 ? <span className="caption">With nothing approved, school chests give Crafting Stars instead of gear.</span> : null}
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      <div className="row">
        <Button variant="primary" onClick={save} loading={busy}>
          Save school gear
        </Button>
      </div>
    </Card>
  );
}
