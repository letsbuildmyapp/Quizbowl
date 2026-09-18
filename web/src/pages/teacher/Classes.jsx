// Classes: list, select, create, rename, join code management.
// Firestore reads: classrooms where teacherUid == uid (useClassroom).
// Firestore writes:
//   classrooms/{auto} create (CreateClassModal in TeacherPage.jsx)
//   classrooms/{id} update { name, grade }
//   classrooms/{id} update { joinCode, joinCodeExpiresAt } (regenerate)
//   classrooms/{id} update { joinCodeExpiresAt } (change expiry)
import { useEffect, useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase.js';
import { useClassroom } from '../../hooks/useClassroom.js';
import { fmtDate, toMillis } from '../../lib/format.js';
import { randomCode } from '../../lib/requests.js';
import { Button, Card, Chip, ConfirmModal, ErrorNote, Field, Modal, friendlyError, useToast } from '../../components/ui.jsx';
import { ClassGate, CreateClassModal, GRADES, TeacherHeader } from '../../components/teacher/TeacherPage.jsx';
import { DAY_MS } from '../../components/teacher/stats.js';

const EXPIRY_OPTIONS = [7, 30, 90];

export default function Classes() {
  const cls = useClassroom();
  const [creating, setCreating] = useState(false);
  return (
    <div className="page stack-lg">
      <TeacherHeader
        cls={cls}
        title="Classes"
        subtitle="Pick the class you are working with and manage its join code."
        actions={
          cls.classrooms.length ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              Create a class
            </Button>
          ) : null
        }
      />
      <ClassGate cls={cls}>
        <div className="grid-2">
          <Card className="stack">
            <h2>Your classes</h2>
            <ul className="t-list">
              {cls.classrooms.map((c) => {
                const current = c.id === cls.classroomId;
                return (
                  <li key={c.id} className="row-between">
                    <div className="stack" style={{ gap: 2 }}>
                      <strong>{c.name}</strong>
                      <span className="caption">{c.grade === 'Mixed' ? 'Mixed grades' : `Grade ${c.grade}`}</span>
                    </div>
                    {current ? (
                      <Chip tone="green">Current class</Chip>
                    ) : (
                      <Button size="sm" onClick={() => cls.select(c.id)} style={{ minHeight: 44 }}>
                        Switch to this class
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
          {cls.classroom ? <ClassroomCard key={cls.classroom.id} classroom={cls.classroom} /> : null}
        </div>
      </ClassGate>
      <CreateClassModal open={creating} onClose={() => setCreating(false)} onCreated={(id) => cls.select(id)} />
    </div>
  );
}

function ClassroomCard({ classroom }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const expires = toMillis(classroom.joinCodeExpiresAt);
  const expired = expires && expires < Date.now();

  const update = async (key, data, message) => {
    setBusy(key);
    setError(null);
    try {
      await updateDoc(doc(db, 'classrooms', classroom.id), data);
      toast(message);
      return true;
    } catch (err) {
      setError(err);
      return false;
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="stack-lg">
      <div className="row-between">
        <div className="stack" style={{ gap: 2 }}>
          <h2>{classroom.name}</h2>
          <span className="caption">{classroom.grade === 'Mixed' ? 'Mixed grades' : `Grade ${classroom.grade}`}</span>
        </div>
        <Button onClick={() => setEditing(true)}>Rename</Button>
      </div>

      <div className="stack" style={{ gap: 8 }}>
        <span className="stat-label">Class code</span>
        <span className="t-code" aria-label={`Class code ${classroom.joinCode?.split('').join(' ')}`}>
          {classroom.joinCode || '······'}
        </span>
        <span className="row" style={{ gap: 8 }}>
          {expired ? <Chip tone="coral">Expired</Chip> : <Chip tone="teal">Active</Chip>}
          <span className="muted">
            {expired ? 'Expired' : 'Expires'} {fmtDate(expires, { month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
        </span>
        <p className="caption prose">Students enter this code on the student sign-in page, then pick their alias and PIN.</p>
      </div>

      <div className="stack" style={{ gap: 8 }}>
        <span className="label">Keep the code working for</span>
        <div className="row">
          {EXPIRY_OPTIONS.map((d) => (
            <Button key={d} loading={busy === `exp${d}`} onClick={() => update(`exp${d}`, { joinCodeExpiresAt: Date.now() + d * DAY_MS }, `Code now works for ${d} days`)}>
              {d} days
            </Button>
          ))}
        </div>
      </div>

      <div>
        <Button variant="danger" onClick={() => setConfirmRegen(true)}>
          Make a new code
        </Button>
      </div>
      <ErrorNote error={error} />

      <ConfirmModal
        open={confirmRegen}
        title="Make a new class code?"
        body="The old code stops working right away. Students who are already signed in stay signed in."
        confirmLabel="Make new code"
        danger
        busy={busy === 'regen'}
        onCancel={() => setConfirmRegen(false)}
        onConfirm={async () => {
          const ok = await update('regen', { joinCode: randomCode(6), joinCodeExpiresAt: Date.now() + 30 * DAY_MS }, 'New class code ready');
          if (ok) setConfirmRegen(false);
        }}
      />
      <RenameModal open={editing} classroom={classroom} onClose={() => setEditing(false)} />
    </Card>
  );
}

function RenameModal({ open, classroom, onClose }) {
  const toast = useToast();
  const [name, setName] = useState(classroom.name || '');
  const [grade, setGrade] = useState(classroom.grade || '5');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setName(classroom.name || '');
      setGrade(classroom.grade || '5');
      setError(null);
    }
  }, [open, classroom.name, classroom.grade]);

  const save = async (e) => {
    e?.preventDefault();
    if (!name.trim()) return setError('Give the class a name.');
    setBusy(true);
    try {
      await updateDoc(doc(db, 'classrooms', classroom.id), { name: name.trim(), grade });
      toast('Class updated');
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
      title="Edit class"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} loading={busy}>
            Save
          </Button>
        </>
      }
    >
      <form className="stack" onSubmit={save}>
        <Field label="Class name">
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
