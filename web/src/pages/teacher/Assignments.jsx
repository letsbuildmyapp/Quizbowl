// Assignments: create, edit, archive; completion per assignment.
// Firestore reads: classrooms (useClassroom), students where classroomId ==, teams where classroomId ==,
//   assignments where classroomId ==, assignments/{id}/progress/*, contentStats/summary.
// Firestore writes:
//   assignments/{auto} add { classroomId, teacherUid, title, mode, category, setId, difficulty, count,
//     personaId, dueAt, targets: { type, ids }, createdAt: serverTimestamp(), archived: false }
//   assignments/{id} update { title, mode, category, setId, difficulty, count, personaId, dueAt, targets }
//   assignments/{id} update { archived }
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { addDoc, collection, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase.js';
import { useAuth } from '../../hooks/useAuth.jsx';
import { useClassroom } from '../../hooks/useClassroom.js';
import { useDoc } from '../../hooks/useFirestore.js';
import { CATEGORIES, PERSONAS, TIER_LABELS, categoryMeta, personaById } from '../../lib/catalog.js';
import { fmtDate } from '../../lib/format.js';
import { Button, Card, Chip, EmptyState, ErrorNote, Field, Loading, Modal, Segmented, friendlyError, useToast } from '../../components/ui.jsx';
import { ClassGate, TeacherHeader, useRoster, useTeams } from '../../components/teacher/TeacherPage.jsx';
import { AssignmentCompletion, useAssignments } from '../../components/teacher/assignments.jsx';
import { MODE_LABELS } from '../../components/teacher/stats.js';

const MODES = [
  { value: 'practice', label: 'Learn & Practice' },
  { value: 'score_attack', label: 'Solo Score Attack' },
  { value: 'versus', label: 'Battle the Computer' }
];
const DIFFICULTIES = [
  { value: '', label: 'Any' },
  { value: '1', label: '1 Easy' },
  { value: '2', label: '2 Medium' },
  { value: '3', label: '3 Hard' }
];
const DIFF_LABEL = { 1: 'Easy', 2: 'Medium', 3: 'Hard' };
const PREFILL_KEYS = ['title', 'mode', 'category', 'count', 'difficulty', 'setId', 'personaId', 'students'];

function msToDateInput(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function dateInputToEndOfDay(value) {
  if (!value) return null;
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
}
const clampCount = (n) => Math.max(5, Math.min(20, Number.isFinite(n) ? Math.round(n) : 10));

function blankForm(prefill = {}) {
  const mode = MODES.some((m) => m.value === prefill.mode) ? prefill.mode : 'practice';
  const students = prefill.students ? prefill.students.split(',').filter(Boolean) : [];
  return {
    title: prefill.title || '',
    mode,
    category: CATEGORIES.some((c) => c.id === prefill.category) ? prefill.category : '',
    setId: prefill.setId || '',
    difficulty: ['1', '2', '3'].includes(prefill.difficulty) ? prefill.difficulty : '',
    count: prefill.count ? clampCount(Number(prefill.count)) : 10,
    personaId: prefill.personaId || '',
    due: '',
    targetType: students.length ? 'students' : 'class',
    teamId: '',
    studentIds: students
  };
}

function formFromAssignment(a) {
  const t = a.targets || { type: 'class', ids: [] };
  return {
    title: a.title || '',
    mode: a.mode || 'practice',
    category: a.category || '',
    setId: a.setId || '',
    difficulty: a.difficulty ? String(a.difficulty) : '',
    count: a.count || 10,
    personaId: a.personaId || '',
    due: msToDateInput(a.dueAt),
    targetType: t.type || 'class',
    teamId: t.type === 'team' ? t.ids?.[0] || '' : '',
    studentIds: t.type === 'students' ? t.ids || [] : []
  };
}

export default function Assignments() {
  const cls = useClassroom();
  const [searchParams, setSearchParams] = useSearchParams();
  const [prefill] = useState(() => {
    const p = {};
    for (const k of PREFILL_KEYS) if (searchParams.get(k)) p[k] = searchParams.get(k);
    return Object.keys(p).length ? p : null;
  });
  // editing: null (closed) | { id?: string, form }
  const [editing, setEditing] = useState(null);

  useEffect(() => {
    if (!prefill) return;
    setEditing({ form: blankForm(prefill) });
    setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="page stack-lg">
      <TeacherHeader
        cls={cls}
        title="Assignments"
        subtitle="Pick a mode, topic and length. Students see it on their home screen."
        actions={
          cls.classroom ? (
            <Button variant="primary" onClick={() => setEditing({ form: blankForm() })}>
              New assignment
            </Button>
          ) : null
        }
      />
      <ClassGate cls={cls}>
        {cls.classroom ? <AssignmentsBody classroom={cls.classroom} editing={editing} setEditing={setEditing} /> : null}
      </ClassGate>
    </div>
  );
}

function AssignmentsBody({ classroom, editing, setEditing }) {
  const roster = useRoster(classroom.id);
  const teams = useTeams(classroom.id);
  const assignments = useAssignments(classroom.id);
  const toast = useToast();
  const [showArchived, setShowArchived] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);

  const toggleArchive = async (a) => {
    setBusyId(a.id);
    setError(null);
    try {
      await updateDoc(doc(db, 'assignments', a.id), { archived: !a.archived });
      toast(a.archived ? 'Assignment restored' : 'Assignment archived');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusyId(null);
    }
  };

  const describeTargets = (a) => {
    const t = a.targets || { type: 'class' };
    if (t.type === 'team') {
      const team = teams.data.find((x) => x.id === t.ids?.[0]);
      return team ? `${team.emoji || ''} ${team.name}`.trim() : 'A team';
    }
    if (t.type === 'students') return `${t.ids?.length || 0} chosen students`;
    return 'Whole class';
  };

  const list = showArchived ? assignments.archived : assignments.current;

  return (
    <div className="stack-lg">
      <div className="row-between">
        <Segmented
          label="Which assignments"
          value={showArchived ? 'archived' : 'current'}
          onChange={(v) => setShowArchived(v === 'archived')}
          options={[
            { value: 'current', label: `Current (${assignments.current.length})` },
            { value: 'archived', label: `Archived (${assignments.archived.length})` }
          ]}
        />
      </div>
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      {assignments.loading ? (
        <Loading label="Loading assignments…" />
      ) : assignments.error ? (
        <ErrorNote error={assignments.error} />
      ) : !list.length ? (
        showArchived ? (
          <EmptyState emoji="🗂️" title="No archived assignments">Archived assignments show up here.</EmptyState>
        ) : (
          <EmptyState emoji="📋" title="No assignments yet" action={<Button variant="primary" onClick={() => setEditing({ form: blankForm() })}>New assignment</Button>}>
            Assignments tell students what to practice next.
          </EmptyState>
        )
      ) : (
        <div className="stack">
          {list.map((a) => {
            const cat = a.category ? categoryMeta(a.category) : null;
            const persona = a.personaId ? personaById(a.personaId) : null;
            const overdue = a.dueAt && a.dueAt < Date.now();
            return (
              <Card key={a.id}>
                <div className="stack">
                  <div className="row-between" style={{ alignItems: 'flex-start' }}>
                    <div className="stack" style={{ gap: 8 }}>
                      <h2>{a.title}</h2>
                      <div className="row" style={{ gap: 8 }}>
                        <Chip>{MODE_LABELS[a.mode] || a.mode}</Chip>
                        <Chip tone="teal">{cat ? `${cat.emoji} ${cat.id}` : 'Mixed'}</Chip>
                        <Chip tone="gray">
                          <span className="tabular">{a.count}</span> questions
                        </Chip>
                        {a.difficulty ? <Chip tone="gray">{DIFF_LABEL[a.difficulty]}</Chip> : null}
                        {persona ? (
                          <Chip tone="sun">
                            {persona.avatar} {persona.name}
                          </Chip>
                        ) : null}
                      </div>
                      <span className="muted">
                        {describeTargets(a)} · {a.dueAt ? `${overdue ? 'Was due' : 'Due'} ${fmtDate(a.dueAt)}` : 'No due date'}
                      </span>
                    </div>
                    <AssignmentCompletion assignment={a} activeRoster={roster.active} />
                  </div>
                  <div className="row">
                    <Button size="sm" onClick={() => setEditing({ id: a.id, form: formFromAssignment(a) })}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" loading={busyId === a.id} onClick={() => toggleArchive(a)}>
                      {a.archived ? 'Restore' : 'Archive'}
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      {editing ? (
        <AssignmentForm
          key={editing.id || 'new'}
          classroom={classroom}
          editing={editing}
          roster={roster.active}
          teams={teams.data}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function AssignmentForm({ classroom, editing, roster, teams, onClose }) {
  const { user } = useAuth();
  const toast = useToast();
  const content = useDoc('contentStats/summary');
  const sets = content.data?.sets || [];
  const [form, setForm] = useState(editing.form);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  const minTier = classroom.settings?.opponentMinTier ?? 0;
  const maxTier = classroom.settings?.opponentMaxTier ?? 3;
  const personas = useMemo(() => PERSONAS.filter((p) => p.tier === -1 || (p.tier >= minTier && p.tier <= maxTier)), [minTier, maxTier]);

  const toggleStudent = (id) =>
    setForm((f) => ({ ...f, studentIds: f.studentIds.includes(id) ? f.studentIds.filter((x) => x !== id) : [...f.studentIds, id] }));

  const submit = async (e) => {
    e?.preventDefault();
    if (!form.title.trim()) return setError('Give the assignment a title.');
    if (form.targetType === 'team' && !form.teamId) return setError('Choose a team.');
    if (form.targetType === 'students' && !form.studentIds.length) return setError('Choose at least one student.');
    if (form.mode === 'versus' && form.personaId && !personas.some((p) => p.id === form.personaId)) {
      return setError('That computer opponent is outside this class’s difficulty range.');
    }
    const ids = form.targetType === 'team' ? [form.teamId] : form.targetType === 'students' ? form.studentIds : [];
    const data = {
      title: form.title.trim(),
      mode: form.mode,
      category: form.category || null,
      setId: form.setId || null,
      difficulty: form.difficulty ? Number(form.difficulty) : null,
      count: clampCount(Number(form.count)),
      personaId: form.mode === 'versus' ? form.personaId || null : null,
      dueAt: dateInputToEndOfDay(form.due),
      targets: { type: form.targetType, ids }
    };
    setBusy(true);
    setError(null);
    try {
      if (editing.id) {
        await updateDoc(doc(db, 'assignments', editing.id), data);
        toast('Assignment saved');
      } else {
        await addDoc(collection(db, 'assignments'), {
          classroomId: classroom.id,
          teacherUid: user.uid,
          ...data,
          createdAt: serverTimestamp(),
          archived: false
        });
        toast('Assignment created');
      }
      onClose();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  // Keep ids that are no longer on the roster visible so the teacher can uncheck them.
  const unknownIds = form.studentIds.filter((id) => !roster.some((s) => s.id === id));

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={editing.id ? 'Edit assignment' : 'New assignment'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={busy}>
            {editing.id ? 'Save changes' : 'Create assignment'}
          </Button>
        </>
      }
    >
      <form className="stack-lg" onSubmit={submit}>
        <Field label="Title">
          {(id) => <input id={id} className="input" value={form.title} onChange={(e) => set('title')(e.target.value)} maxLength={80} autoComplete="off" />}
        </Field>
        <div className="stack" style={{ gap: 8 }}>
          <span className="label">Mode</span>
          <Segmented label="Mode" value={form.mode} onChange={set('mode')} options={MODES} />
        </div>
        <div className="grid-2">
          <Field label="Category">
            {(id) => (
              <select id={id} className="select" value={form.category} onChange={(e) => set('category')(e.target.value)}>
                <option value="">Mixed</option>
                {CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.emoji} {c.id}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Question set" hint={content.loading ? 'Loading sets…' : sets.length ? 'Optional' : 'No sets published yet'}>
            {(id) => (
              <select id={id} className="select" value={form.setId} onChange={(e) => set('setId')(e.target.value)} disabled={!sets.length && !form.setId}>
                <option value="">Any set</option>
                {sets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.count})
                  </option>
                ))}
                {form.setId && !sets.some((s) => s.id === form.setId) ? <option value={form.setId}>Current set</option> : null}
              </select>
            )}
          </Field>
          <Field label="Difficulty">
            {(id) => (
              <select id={id} className="select" value={form.difficulty} onChange={(e) => set('difficulty')(e.target.value)}>
                {DIFFICULTIES.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label={`Questions: ${form.count}`} hint="Between 5 and 20">
            {(id) => (
              <input id={id} type="range" min={5} max={20} step={1} value={form.count} onChange={(e) => set('count')(Number(e.target.value))} style={{ minHeight: 44 }} />
            )}
          </Field>
          {form.mode === 'versus' ? (
            <Field label="Computer opponent" hint={`This class allows ${TIER_LABELS[minTier]} to ${TIER_LABELS[maxTier]}.`}>
              {(id) => (
                <select id={id} className="select" value={form.personaId} onChange={(e) => set('personaId')(e.target.value)}>
                  <option value="">Student picks</option>
                  {personas.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.avatar} {p.name} ({p.difficulty})
                    </option>
                  ))}
                </select>
              )}
            </Field>
          ) : null}
          <Field label="Due date" hint="Optional">
            {(id) => <input id={id} type="date" className="input" value={form.due} onChange={(e) => set('due')(e.target.value)} />}
          </Field>
        </div>
        <div className="stack">
          <span className="label">Who gets it</span>
          <Segmented
            label="Who gets it"
            value={form.targetType}
            onChange={set('targetType')}
            options={[
              { value: 'class', label: 'Whole class' },
              { value: 'team', label: 'A team' },
              { value: 'students', label: 'Chosen students' }
            ]}
          />
          {form.targetType === 'team' ? (
            teams.length ? (
              <Field label="Team">
                {(id) => (
                  <select id={id} className="select" value={form.teamId} onChange={(e) => set('teamId')(e.target.value)}>
                    <option value="">Choose a team</option>
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.emoji} {t.name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            ) : (
              <p className="muted">No teams yet. Add teams on the Students page.</p>
            )
          ) : null}
          {form.targetType === 'students' ? (
            roster.length ? (
              <fieldset className="stack" style={{ gap: 4, border: 0, padding: 0, margin: 0 }}>
                <legend className="sr-only">Students</legend>
                <span className="caption tabular">{form.studentIds.length} selected</span>
                <div className="grid-3" style={{ gap: 4 }}>
                  {roster.map((s) => (
                    <label key={s.id} className="check">
                      <input type="checkbox" checked={form.studentIds.includes(s.id)} onChange={() => toggleStudent(s.id)} />
                      <span aria-hidden>{s.avatar}</span> {s.displayName}
                    </label>
                  ))}
                  {unknownIds.map((id) => (
                    <label key={id} className="check">
                      <input type="checkbox" checked onChange={() => toggleStudent(id)} />
                      Student no longer active
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : (
              <p className="muted">No active students yet. Add students first.</p>
            )
          ) : null}
        </div>
        {error ? <ErrorNote>{error}</ErrorNote> : null}
      </form>
    </Modal>
  );
}
