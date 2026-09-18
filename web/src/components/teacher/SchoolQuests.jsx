// School quests: a shared weekly goal across every class in the school.
// Firestore reads: schoolQuests where schoolId == claims.schoolId; schoolThemes/{schoolId} (useSchoolTheme)
// Firestore writes:
//   schoolQuests/{auto} add { schoolId, title, description, category|null, metric, target, startsAt, endsAt,
//     progress: 0, contributions: {}, createdBy, createdAt: serverTimestamp() }
//   schoolQuests/{id} update { title, description, target, startsAt, endsAt } (creator or school admin)
//   schoolQuests/{id} delete (creator or school admin)
import { useState } from 'react';
import { addDoc, collection, deleteDoc, doc, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { db } from '../../firebase.js';
import { useAuth } from '../../hooks/useAuth.jsx';
import { useQuery } from '../../hooks/useFirestore.js';
import { useSchoolTheme } from '../../hooks/useSchoolTheme.js';
import { CATEGORIES, categoryMeta } from '../../lib/catalog.js';
import { fmtDate, fmtNum } from '../../lib/format.js';
import { ProgressVisual } from '../bot/index.js';
import { Button, Card, Chip, ConfirmModal, EmptyState, ErrorNote, Field, Loading, Modal, Segmented, friendlyError, useToast } from '../ui.jsx';
import { DAY_MS } from './stats.js';

const dateInput = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const parts = (v) => v.split('-').map(Number);
const startOfDay = (v) => {
  const [y, m, d] = parts(v);
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
};
const endOfDay = (v) => {
  const [y, m, d] = parts(v);
  return new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
};
function thisWeek() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const sunday = new Date(d);
  sunday.setDate(sunday.getDate() + 6);
  return { start: dateInput(d.getTime()), end: dateInput(sunday.getTime()) };
}

export default function SchoolQuests() {
  const { claims, user, isSchoolAdmin } = useAuth();
  const schoolId = claims.schoolId;
  const { theme } = useSchoolTheme();
  const quests = useQuery(() => (schoolId ? query(collection(db, 'schoolQuests'), where('schoolId', '==', schoolId)) : null), [schoolId]);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [delBusy, setDelBusy] = useState(false);
  const [delError, setDelError] = useState(null);
  const toast = useToast();
  const [now] = useState(() => Date.now());

  if (!schoolId) return null;
  const label = theme.weeklyQuestLabel || 'Weekly Team Quest';
  const sorted = quests.data.slice().sort((a, b) => (b.startsAt || 0) - (a.startsAt || 0));
  const active = sorted.filter((q) => (q.endsAt || 0) >= now);
  const past = sorted.filter((q) => (q.endsAt || 0) < now);
  const canManage = (q) => q.createdBy === user?.uid || isSchoolAdmin;

  const remove = async () => {
    setDelBusy(true);
    setDelError(null);
    try {
      await deleteDoc(doc(db, 'schoolQuests', deleting.id));
      toast('Quest deleted');
      setDeleting(null);
    } catch (err) {
      setDelError(friendlyError(err));
    } finally {
      setDelBusy(false);
    }
  };

  const card = (q, isPast) => (
    <SchoolQuestCard key={q.id} quest={q} theme={theme} now={now} past={isPast} onEdit={canManage(q) ? () => setEditing(q) : null} onDelete={canManage(q) ? () => setDeleting(q) : null} />
  );

  return (
    <section className="stack" aria-labelledby="sq-heading">
      <div className="row-between">
        <div className="stack" style={{ gap: 4 }}>
          <h2 id="sq-heading">{label}</h2>
          <p className="muted prose">A school-wide goal every class adds to. Everyone who contributes earns the school chest when it's complete.</p>
        </div>
        <Button variant="primary" onClick={() => setEditing({})}>
          New school quest
        </Button>
      </div>
      {quests.loading ? (
        <Loading label="Loading school quests…" />
      ) : quests.error ? (
        <ErrorNote error={quests.error} />
      ) : !sorted.length ? (
        <EmptyState emoji="🏫" title="No school quests yet">
          Set a goal like 500 correct answers across the school this week.
        </EmptyState>
      ) : (
        <div className="stack">
          {active.length ? <div className="grid-2">{active.map((q) => card(q, false))}</div> : <p className="muted">No active school quests right now.</p>}
          {past.length ? (
            <details>
              <summary style={{ cursor: 'pointer', fontWeight: 800, minHeight: 44, display: 'flex', alignItems: 'center' }}>Past school quests ({past.length})</summary>
              <div className="grid-2" style={{ marginTop: 16 }}>
                {past.map((q) => card(q, true))}
              </div>
            </details>
          ) : null}
        </div>
      )}
      {editing ? <SchoolQuestModal quest={editing.id ? editing : null} defaultTitle={label} schoolId={schoolId} onClose={() => setEditing(null)} /> : null}
      <ConfirmModal
        open={!!deleting}
        danger
        title={`Delete ${deleting?.title || 'this quest'}?`}
        body={
          <div className="stack">
            <p className="prose">The quest disappears for every class. Chests already earned are kept.</p>
            {delError ? <ErrorNote>{delError}</ErrorNote> : null}
          </div>
        }
        confirmLabel="Delete quest"
        onConfirm={remove}
        onCancel={() => {
          setDeleting(null);
          setDelError(null);
        }}
        busy={delBusy}
      />
    </section>
  );
}

function SchoolQuestCard({ quest, theme, now, past, onEdit, onDelete }) {
  const progress = quest.progress || 0;
  const target = quest.target || 1;
  const done = !!quest.completedAt || progress >= target;
  const contributors = Object.keys(quest.contributions || {}).length;
  const daysLeft = Math.max(0, Math.ceil(((quest.endsAt || 0) - now) / DAY_MS));
  const notStarted = (quest.startsAt || 0) > now;
  const cat = quest.category ? categoryMeta(quest.category) : null;
  const metric = quest.metric === 'answered' ? 'answered' : 'correct';
  return (
    <Card className="stack">
      <div className="row-between" style={{ alignItems: 'flex-start' }}>
        <h3>{quest.title}</h3>
        {done ? <Chip tone="green">✓ Complete</Chip> : past ? <Chip tone="gray">Ended</Chip> : notStarted ? <Chip tone="sun">Starts {fmtDate(quest.startsAt)}</Chip> : <Chip tone="teal">Active</Chip>}
      </div>
      {quest.description ? <p className="prose">{quest.description}</p> : null}
      <div className="row" style={{ gap: 20, alignItems: 'center' }}>
        <ProgressVisual type={theme.progressVisual} value={Math.min(progress, target)} max={target} theme={theme} size={96} label={theme.progressLabel} />
        <div className="stack" style={{ gap: 4 }}>
          <span className="tabular" style={{ fontWeight: 800 }}>
            {fmtNum(progress)} / {fmtNum(target)} {metric}
          </span>
          <span className="caption">
            {fmtNum(contributors)} {contributors === 1 ? 'student has' : 'students have'} helped
          </span>
          <span className="caption">
            {done ? `Completed ${fmtDate(quest.completedAt)}` : past ? `Ended ${fmtDate(quest.endsAt)}` : `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left`}
          </span>
        </div>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <Chip tone="gray">{cat ? `${cat.emoji} ${cat.id}` : 'Any category'}</Chip>
        <Chip tone="gray">
          {fmtDate(quest.startsAt)} to {fmtDate(quest.endsAt)}
        </Chip>
      </div>
      {onEdit || onDelete ? (
        <div className="row" style={{ gap: 8 }}>
          {onEdit ? (
            <Button size="sm" onClick={onEdit} style={{ minHeight: 44 }} aria-label={`Edit ${quest.title}`}>
              Edit
            </Button>
          ) : null}
          {onDelete ? (
            <Button size="sm" variant="ghost" onClick={onDelete} style={{ minHeight: 44 }} aria-label={`Delete ${quest.title}`}>
              Delete
            </Button>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

function SchoolQuestModal({ quest, defaultTitle, schoolId, onClose }) {
  const { user } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState(() => {
    if (quest) {
      return {
        title: quest.title || '',
        description: quest.description || '',
        category: quest.category || '',
        metric: quest.metric || 'correct',
        target: quest.target || 100,
        start: dateInput(quest.startsAt || Date.now()),
        end: dateInput(quest.endsAt || Date.now())
      };
    }
    const w = thisWeek();
    return { title: defaultTitle, description: '', category: '', metric: 'correct', target: 500, start: w.start, end: w.end };
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e?.preventDefault();
    if (!form.title.trim()) return setError('Give the quest a title.');
    const target = Math.round(Number(form.target));
    if (!target || target < 1) return setError('Set a target of at least 1.');
    if (!form.start || !form.end) return setError('Pick a start and end date.');
    const startsAt = startOfDay(form.start);
    const endsAt = endOfDay(form.end);
    if (endsAt <= startsAt) return setError('The end date must be after the start date.');
    setBusy(true);
    setError(null);
    try {
      const base = { title: form.title.trim(), description: form.description.trim(), target, startsAt, endsAt };
      if (quest) {
        await updateDoc(doc(db, 'schoolQuests', quest.id), base);
        toast('Quest updated');
      } else {
        await addDoc(collection(db, 'schoolQuests'), {
          schoolId,
          ...base,
          category: form.category || null,
          metric: form.metric,
          progress: 0,
          contributions: {},
          createdBy: user.uid,
          createdAt: serverTimestamp()
        });
        toast('School quest created');
      }
      onClose();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={quest ? 'Edit school quest' : 'New school quest'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={busy}>
            {quest ? 'Save changes' : 'Create quest'}
          </Button>
        </>
      }
    >
      <form className="stack" onSubmit={submit}>
        <Field label="Title">
          {(id) => <input id={id} className="input" value={form.title} onChange={(e) => set('title')(e.target.value)} maxLength={60} autoComplete="off" />}
        </Field>
        <Field label="Description" hint="Optional. One line students will see.">
          {(id) => <input id={id} className="input" value={form.description} onChange={(e) => set('description')(e.target.value)} maxLength={140} autoComplete="off" />}
        </Field>
        <Field label="Category" hint={quest ? "Category and count can't change after the quest starts." : undefined}>
          {(id) => (
            <select id={id} className="select" value={form.category} disabled={!!quest} onChange={(e) => set('category')(e.target.value)}>
              <option value="">Any category</option>
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.emoji} {c.id}
                </option>
              ))}
            </select>
          )}
        </Field>
        {quest ? null : (
          <div className="stack" style={{ gap: 8 }}>
            <span className="label">Count</span>
            <Segmented
              label="Count"
              value={form.metric}
              onChange={set('metric')}
              options={[
                { value: 'correct', label: 'Correct answers' },
                { value: 'answered', label: 'Questions answered' }
              ]}
            />
          </div>
        )}
        <Field label="Target" hint="Total for the whole school.">
          {(id) => <input id={id} type="number" inputMode="numeric" min={1} max={1000000} className="input tabular" value={form.target} onChange={(e) => set('target')(e.target.value)} />}
        </Field>
        <div className="grid-2">
          <Field label="Starts">{(id) => <input id={id} type="date" className="input" value={form.start} onChange={(e) => set('start')(e.target.value)} />}</Field>
          <Field label="Ends">{(id) => <input id={id} type="date" className="input" value={form.end} onChange={(e) => set('end')(e.target.value)} />}</Field>
        </div>
        {error ? <ErrorNote>{error}</ErrorNote> : null}
      </form>
    </Modal>
  );
}
