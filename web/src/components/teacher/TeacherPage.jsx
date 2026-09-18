// Shared teacher-area building blocks: page header with class switcher, the
// "no class yet" gate, the create-class modal, and roster/summary hooks.
// Firestore reads: classrooms (via useClassroom), students where classroomId ==,
//   teams where classroomId ==, sessionSummaries where {field} == X and completedAt range.
// Firestore writes: classrooms/{auto} (create class).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { addDoc, collection, query, serverTimestamp, where } from 'firebase/firestore';
import { db } from '../../firebase.js';
import { useAuth } from '../../hooks/useAuth.jsx';
import { useQuery } from '../../hooks/useFirestore.js';
import { DEFAULT_RULES } from '../../lib/catalog.js';
import { randomCode } from '../../lib/requests.js';
import { Button, EmptyState, ErrorNote, Field, Loading, Modal, PageHeader, friendlyError, useToast } from '../ui.jsx';
import { DAY_MS } from './stats.js';
import '../../pages/teacher/teacher.css';

export const GRADES = ['4', '5', '6', '7', '8', 'Mixed'];

export function ClassSwitcher({ cls }) {
  const { classrooms, classroomId, select } = cls;
  return (
    <div className="t-switcher">
      {classrooms.length > 1 ? (
        <>
          <label htmlFor="t-class-switch" className="sr-only">
            Current class
          </label>
          <select id="t-class-switch" className="select" value={classroomId || ''} onChange={(e) => select(e.target.value)}>
            {classrooms.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </>
      ) : null}
      <Link to="/teach/classes">All classes</Link>
    </div>
  );
}

/** PageHeader plus the class switcher. cls = useClassroom() result. */
export function TeacherHeader({ cls, title, subtitle, actions }) {
  return (
    <PageHeader
      eyebrow={cls?.classroom ? cls.classroom.name : 'Teacher'}
      title={title}
      subtitle={subtitle}
      actions={
        <>
          {cls?.classrooms?.length ? <ClassSwitcher cls={cls} /> : null}
          {actions}
        </>
      }
    />
  );
}

/** Loading / error / no-classes states before rendering a class page. */
export function ClassGate({ cls, children }) {
  const [open, setOpen] = useState(false);
  if (cls.loading) return <Loading label="Loading your classes…" />;
  if (cls.error) return <ErrorNote error={cls.error} />;
  if (!cls.classrooms.length) {
    return (
      <>
        <EmptyState emoji="🏫" title="Create your first class" action={<Button variant="primary" onClick={() => setOpen(true)}>Create a class</Button>}>
          A class gives students a join code and keeps their progress together.
        </EmptyState>
        <CreateClassModal open={open} onClose={() => setOpen(false)} onCreated={(id) => cls.select(id)} />
      </>
    );
  }
  return children;
}

export function CreateClassModal({ open, onClose, onCreated }) {
  const { user, claims } = useAuth();
  const toast = useToast();
  const [name, setName] = useState('');
  const [grade, setGrade] = useState('5');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e?.preventDefault();
    if (!name.trim()) return setError('Give the class a name.');
    setBusy(true);
    setError(null);
    try {
      const ref = await addDoc(collection(db, 'classrooms'), {
        schoolId: claims.schoolId || null,
        teacherUid: user.uid,
        name: name.trim(),
        grade,
        joinCode: randomCode(6),
        joinCodeExpiresAt: Date.now() + 30 * DAY_MS,
        settings: {
          leaderboard: 'class',
          opponentMinTier: 0,
          opponentMaxTier: 3,
          rules: { ...DEFAULT_RULES },
          accessibility: { readingSpeed: 'medium', readAloud: false, reducedMotion: false, largeText: false },
          voiceAnswers: false
        },
        dismissedSuggestions: [],
        createdAt: serverTimestamp()
      });
      toast(`${name.trim()} created`);
      setName('');
      onCreated?.(ref.id);
      onClose();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create a class"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={busy}>
            Create class
          </Button>
        </>
      }
    >
      <form className="stack" onSubmit={submit}>
        <Field label="Class name" hint="For example: Room 12 Quiz Club">
          {(id) => <input id={id} className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="off" />}
        </Field>
        <Field label="Grade">
          {(id) => (
            <select id={id} className="select" value={grade} onChange={(e) => setGrade(e.target.value)}>
              {GRADES.map((g) => (
                <option key={g} value={g}>
                  {g === 'Mixed' ? 'Mixed grades' : `Grade ${g}`}
                </option>
              ))}
            </select>
          )}
        </Field>
        {error ? <ErrorNote>{error}</ErrorNote> : null}
      </form>
    </Modal>
  );
}

/** All students in a class (active and inactive), sorted by alias. */
export function useRoster(classroomId) {
  const res = useQuery(() => (classroomId ? query(collection(db, 'students'), where('classroomId', '==', classroomId)) : null), [classroomId]);
  const data = res.data.slice().sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
  return { ...res, data, active: data.filter((s) => s.active !== false) };
}

export function useTeams(classroomId) {
  const res = useQuery(() => (classroomId ? query(collection(db, 'teams'), where('classroomId', '==', classroomId)) : null), [classroomId]);
  return { ...res, data: res.data.slice().sort((a, b) => (a.name || '').localeCompare(b.name || '')) };
}

/**
 * sessionSummaries where {field} == value and completedAt in [since, until].
 * Composite index: sessionSummaries (field ASC, completedAt ASC).
 */
export function useSummaries(field, value, since, until) {
  return useQuery(() => {
    if (!value) return null;
    const parts = [where(field, '==', value), where('completedAt', '>=', since)];
    if (until) parts.push(where('completedAt', '<=', until));
    return query(collection(db, 'sessionSummaries'), ...parts);
  }, [field, value, since, until]);
}

/** Name lookup for a roster: id -> student. */
export function rosterMap(roster) {
  return Object.fromEntries(roster.map((s) => [s.id, s]));
}
