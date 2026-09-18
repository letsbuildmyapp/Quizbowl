// Roster building blocks for pages/teacher/Students.jsx.
// Firestore reads: students/{id}/private/credentials (PIN, on demand).
// Firestore writes:
//   students/{newId} set { classroomId, schoolId, teacherUid, displayName, avatar, teamId: null, active: true, consent: 'school', createdAt: ts }
//   students/{id}/private/credentials set { pin }
//   students/{id} update { displayName, avatar, teamId, active }
//   teams/{auto} create { classroomId, name, emoji, color }; teams/{id} update { name, emoji, color }; teams/{id} delete
//   parentInvites/{CODE} set { studentId, classroomId, teacherUid, expiresAt, usedBy: null, createdAt: ts }
//   privacyRequests/{auto} via submitRequest { uid, requesterRole: 'teacher', studentId, classroomId, type, details, status: 'pending', createdAt: ts }
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { addDoc, collection, deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase.js';
import { useAuth } from '../../hooks/useAuth.jsx';
import { AVATARS } from '../../lib/catalog.js';
import { fmtDate } from '../../lib/format.js';
import { randomCode, submitRequest } from '../../lib/requests.js';
import { Button, ConfirmModal, ErrorNote, Field, Modal, Segmented, friendlyError, useToast } from '../ui.jsx';
import { DAY_MS } from './stats.js';

export const MAX_BULK = 40;
export const TEAM_EMOJI = ['🦊', '🐯', '🦉', '🐉', '🚀', '⚡', '🌟', '🔥', '🌊', '🍀', '🎯', '🛡️'];
export const TEAM_COLORS = ['#6d4df2', '#e5484d', '#0f9d8a', '#f59e0b', '#ec4899', '#22a06b', '#2563eb', '#8b5cf6'];

export function randomPin() {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 10000;
  return String(n).padStart(4, '0');
}
export const randomAvatar = () => AVATARS[Math.floor(Math.random() * AVATARS.length)];
export const credRef = (studentId) => doc(db, 'students', studentId, 'private', 'credentials');

/** Create one student profile, then its PIN doc (sequential so rules can check the profile). */
export async function createStudent({ classroom, teacherUid, displayName }) {
  const ref = doc(collection(db, 'students'));
  await setDoc(ref, {
    classroomId: classroom.id,
    schoolId: classroom.schoolId || null,
    teacherUid,
    displayName,
    avatar: randomAvatar(),
    teamId: null,
    active: true,
    consent: 'school',
    createdAt: serverTimestamp()
  });
  await setDoc(credRef(ref.id), { pin: randomPin() });
  return ref.id;
}

/** Split the bulk textarea: trim, drop empties, dedupe (case-insensitive). */
export function parseAliases(text) {
  const seen = new Set();
  const out = [];
  for (const line of text.split('\n')) {
    const name = line.trim().slice(0, 30);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
  }
  return out;
}

export function AddStudentsModal({ open, onClose, classroom, existing }) {
  const { user } = useAuth();
  const toast = useToast();
  const [mode, setMode] = useState('one');
  const [one, setOne] = useState('');
  const [bulk, setBulk] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setOne('');
      setBulk('');
      setError(null);
    }
  }, [open]);

  const names = mode === 'one' ? parseAliases(one) : parseAliases(bulk);
  const taken = new Set(existing.map((s) => (s.displayName || '').toLowerCase()));
  const dupes = names.filter((n) => taken.has(n.toLowerCase()));

  const submit = async (e) => {
    e?.preventDefault();
    setError(null);
    if (!names.length) return setError('Type at least one alias.');
    if (names.length > MAX_BULK) return setError(`Add up to ${MAX_BULK} students at a time.`);
    if (dupes.length) return setError(`Already in this class: ${dupes.join(', ')}`);
    setBusy(true);
    try {
      await Promise.all(names.map((displayName) => createStudent({ classroom, teacherUid: user.uid, displayName })));
      toast(names.length === 1 ? `${names[0]} added` : `${names.length} students added`);
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
      title="Add students"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={busy}>
            {names.length > 1 ? `Add ${names.length} students` : 'Add student'}
          </Button>
        </>
      }
    >
      <form className="stack" onSubmit={submit}>
        <Segmented
          label="How many"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'one', label: 'One student' },
            { value: 'bulk', label: 'A list' }
          ]}
        />
        <div className="alert alert-info">Use a nickname or first name with an initial. Full legal names are not needed.</div>
        {mode === 'one' ? (
          <Field label="Alias" hint="Shown on the leaderboard and login cards. For example: Maya R.">
            {(id) => <input id={id} className="input" value={one} onChange={(e) => setOne(e.target.value)} maxLength={30} autoComplete="off" />}
          </Field>
        ) : (
          <Field label="Aliases, one per line" hint={`Up to ${MAX_BULK} at a time. Each student gets an avatar and a 4-digit PIN.`}>
            {(id) => <textarea id={id} className="textarea" rows={8} value={bulk} onChange={(e) => setBulk(e.target.value)} />}
          </Field>
        )}
        {mode === 'bulk' && names.length ? (
          <span className="caption tabular">
            {names.length} {names.length === 1 ? 'alias' : 'aliases'} ready
          </span>
        ) : null}
        {error ? <ErrorNote>{error}</ErrorNote> : null}
      </form>
    </Modal>
  );
}

/** PIN cell: hidden until revealed; reset makes a new one. */
export function PinCell({ student }) {
  const toast = useToast();
  const [pin, setPin] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState(null);

  const reveal = async () => {
    setBusy(true);
    setError(null);
    try {
      const snap = await getDoc(credRef(student.id));
      setPin(snap.data()?.pin || 'none');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = randomPin();
      await setDoc(credRef(student.id), { pin: next });
      setPin(next);
      setConfirm(false);
      toast(`New PIN for ${student.displayName}`);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
      {pin ? (
        <>
          <span className="t-pin" aria-label={`PIN ${pin.split('').join(' ')}`}>
            {pin}
          </span>
          <Button variant="ghost" size="sm" onClick={() => setPin(null)} aria-label={`Hide PIN for ${student.displayName}`} style={{ minHeight: 44 }}>
            Hide
          </Button>
        </>
      ) : (
        <Button variant="ghost" size="sm" onClick={reveal} loading={busy} aria-label={`Show PIN for ${student.displayName}`} style={{ minHeight: 44 }}>
          Show PIN
        </Button>
      )}
      <Button variant="ghost" size="sm" onClick={() => setConfirm(true)} aria-label={`Reset PIN for ${student.displayName}`} style={{ minHeight: 44 }}>
        Reset
      </Button>
      {error ? <span className="caption" role="alert">{error}</span> : null}
      <ConfirmModal
        open={confirm}
        title={`Reset PIN for ${student.displayName}?`}
        body="The old PIN stops working. Give the student the new one before they sign in again."
        confirmLabel="Reset PIN"
        busy={busy}
        onCancel={() => setConfirm(false)}
        onConfirm={reset}
      />
    </div>
  );
}

export function EditStudentModal({ student, teams, onClose }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState('');
  const [teamId, setTeamId] = useState('');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  useEffect(() => {
    if (student) {
      setName(student.displayName || '');
      setAvatar(student.avatar || AVATARS[0]);
      setTeamId(student.teamId || '');
      setError(null);
    }
  }, [student]);

  if (!student) return null;
  const inactive = student.active === false;

  const save = async (e) => {
    e?.preventDefault();
    if (!name.trim()) return setError('Alias cannot be empty.');
    setBusy('save');
    try {
      await updateDoc(doc(db, 'students', student.id), { displayName: name.trim().slice(0, 30), avatar, teamId: teamId || null });
      toast('Student updated');
      onClose();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(null);
    }
  };

  const setActive = async (active) => {
    setBusy('active');
    try {
      await updateDoc(doc(db, 'students', student.id), { active });
      toast(active ? `${student.displayName} is active again` : `${student.displayName} deactivated`);
      setConfirmDeactivate(false);
      onClose();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit ${student.displayName}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} loading={busy === 'save'}>
            Save
          </Button>
        </>
      }
    >
      <form className="stack" onSubmit={save}>
        <Field label="Alias" hint="A nickname or first name with an initial.">
          {(id) => <input id={id} className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={30} autoComplete="off" />}
        </Field>
        <div className="stack" style={{ gap: 8 }}>
          <span className="label" id="edit-avatar-label">
            Avatar
          </span>
          <div className="row" role="radiogroup" aria-labelledby="edit-avatar-label" style={{ gap: 8 }}>
            {AVATARS.map((a) => (
              <button
                key={a}
                type="button"
                role="radio"
                aria-checked={avatar === a}
                aria-label={`Avatar ${a}`}
                onClick={() => setAvatar(a)}
                className="btn btn-icon"
                style={{ fontSize: '1.4rem', borderColor: avatar === a ? 'var(--purple)' : undefined, background: avatar === a ? 'var(--purple-soft)' : undefined }}
              >
                {a}
              </button>
            ))}
          </div>
        </div>
        <Field label="Team">
          {(id) => (
            <select id={id} className="select" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              <option value="">No team</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.emoji} {t.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <hr className="divider" />
        <div className="row-between">
          <span className="muted">{inactive ? 'This student cannot sign in.' : 'Deactivated students cannot sign in. Their history is kept.'}</span>
          {inactive ? (
            <Button onClick={() => setActive(true)} loading={busy === 'active'}>
              Reactivate
            </Button>
          ) : (
            <Button variant="danger" onClick={() => setConfirmDeactivate(true)}>
              Deactivate
            </Button>
          )}
        </div>
        {error ? <ErrorNote>{error}</ErrorNote> : null}
      </form>
      <ConfirmModal
        open={confirmDeactivate}
        title={`Deactivate ${student.displayName}?`}
        body="They will not be able to sign in. You can reactivate them later."
        confirmLabel="Deactivate"
        danger
        busy={busy === 'active'}
        onCancel={() => setConfirmDeactivate(false)}
        onConfirm={() => setActive(false)}
      />
    </Modal>
  );
}

export function TeamModal({ team, classroomId, members, onClose }) {
  const toast = useToast();
  const isNew = !team?.id;
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState(TEAM_EMOJI[0]);
  const [color, setColor] = useState(TEAM_COLORS[0]);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (team) {
      setName(team.name || '');
      setEmoji(team.emoji || TEAM_EMOJI[0]);
      setColor(team.color || TEAM_COLORS[0]);
      setError(null);
    }
  }, [team]);

  if (!team) return null;

  const save = async (e) => {
    e?.preventDefault();
    if (!name.trim()) return setError('Give the team a name.');
    setBusy('save');
    try {
      const data = { name: name.trim().slice(0, 30), emoji, color };
      if (isNew) await addDoc(collection(db, 'teams'), { classroomId, ...data });
      else await updateDoc(doc(db, 'teams', team.id), data);
      toast(isNew ? 'Team created' : 'Team updated');
      onClose();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy('delete');
    try {
      await Promise.all(members.map((s) => updateDoc(doc(db, 'students', s.id), { teamId: null })));
      await deleteDoc(doc(db, 'teams', team.id));
      toast('Team deleted');
      setConfirmDelete(false);
      onClose();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? 'New team' : `Edit ${team.name}`}
      footer={
        <>
          {!isNew ? (
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              Delete team
            </Button>
          ) : null}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} loading={busy === 'save'}>
            Save
          </Button>
        </>
      }
    >
      <form className="stack" onSubmit={save}>
        <Field label="Team name">
          {(id) => <input id={id} className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={30} autoComplete="off" />}
        </Field>
        <div className="stack" style={{ gap: 8 }}>
          <span className="label" id="team-emoji-label">
            Emoji
          </span>
          <div className="row" role="radiogroup" aria-labelledby="team-emoji-label" style={{ gap: 8 }}>
            {TEAM_EMOJI.map((e2) => (
              <button
                key={e2}
                type="button"
                role="radio"
                aria-checked={emoji === e2}
                aria-label={`Emoji ${e2}`}
                onClick={() => setEmoji(e2)}
                className="btn btn-icon"
                style={{ fontSize: '1.3rem', borderColor: emoji === e2 ? 'var(--purple)' : undefined, background: emoji === e2 ? 'var(--purple-soft)' : undefined }}
              >
                {e2}
              </button>
            ))}
          </div>
        </div>
        <div className="stack" style={{ gap: 8 }}>
          <span className="label" id="team-color-label">
            Color
          </span>
          <div className="row" role="radiogroup" aria-labelledby="team-color-label" style={{ gap: 8 }}>
            {TEAM_COLORS.map((c, i) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={`Color ${i + 1}`}
                onClick={() => setColor(c)}
                className="btn btn-icon"
                style={{ background: c, borderColor: color === c ? 'var(--ink)' : c, color: '#fff' }}
              >
                {color === c ? '✓' : ''}
              </button>
            ))}
          </div>
        </div>
        {!isNew ? <span className="caption">Assign students to this team from the roster.</span> : null}
        {error ? <ErrorNote>{error}</ErrorNote> : null}
      </form>
      <ConfirmModal
        open={confirmDelete}
        title={`Delete ${team.name}?`}
        body={`${members.length} ${members.length === 1 ? 'student' : 'students'} will have no team. Their points stay with them.`}
        confirmLabel="Delete team"
        danger
        busy={busy === 'delete'}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={remove}
      />
    </Modal>
  );
}

export function ParentInviteModal({ student, classroomId, onClose }) {
  const { user } = useAuth();
  const [code, setCode] = useState(null);
  const [expiresAt, setExpiresAt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setCode(null);
    setError(null);
  }, [student]);

  if (!student) return null;

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = randomCode(8);
      const exp = Date.now() + 14 * DAY_MS;
      await setDoc(doc(db, 'parentInvites', next), {
        studentId: student.id,
        classroomId,
        teacherUid: user.uid,
        expiresAt: exp,
        usedBy: null,
        createdAt: serverTimestamp()
      });
      setCode(next);
      setExpiresAt(exp);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={`Family code for ${student.displayName}`} footer={<Button onClick={onClose}>Done</Button>}>
      <div className="stack">
        {code ? (
          <>
            <span className="t-code" aria-label={`Family code ${code.split('').join(' ')}`}>
              {code}
            </span>
            <p className="prose">Go to the QuizQuest sign-in page, choose Family, and enter this code.</p>
            <span className="caption">Works once. Expires {fmtDate(expiresAt, { month: 'short', day: 'numeric', year: 'numeric' })}.</span>
          </>
        ) : (
          <>
            <p className="prose">Make a one-time code a parent or guardian uses to link to this student.</p>
            <div>
              <Button variant="primary" onClick={create} loading={busy}>
                Make family code
              </Button>
            </div>
          </>
        )}
        <ErrorNote error={error} />
      </div>
    </Modal>
  );
}

const PRIVACY_TYPES = [
  { value: 'correction', label: 'Correct data' },
  { value: 'export', label: 'Export data' },
  { value: 'deletion', label: 'Delete data' }
];
const PRIVACY_HINTS = {
  correction: 'Describe what is wrong and what it should say.',
  export: 'An export of this student’s data will be prepared for you.',
  deletion: 'Deletes this student’s profile and game history after review.'
};

export function PrivacyModal({ student, classroomId, onClose }) {
  const toast = useToast();
  const [type, setType] = useState('correction');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    setType('correction');
    setDetails('');
    setError(null);
  }, [student]);

  if (!student) return null;

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await submitRequest('privacyRequests', { requesterRole: 'teacher', studentId: student.id, classroomId, type, details: details.trim() });
      toast('Privacy request sent');
      setConfirm(false);
      onClose();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  const submit = (e) => {
    e?.preventDefault();
    if (type === 'correction' && !details.trim()) return setError('Describe the correction.');
    if (type === 'deletion') return setConfirm(true);
    return send();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Privacy request for ${student.displayName}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={type === 'deletion' ? 'coral' : 'primary'} onClick={submit} loading={busy && !confirm}>
            Send request
          </Button>
        </>
      }
    >
      <form className="stack" onSubmit={submit}>
        <Segmented label="Request type" value={type} onChange={setType} options={PRIVACY_TYPES} />
        <p className="muted">{PRIVACY_HINTS[type]}</p>
        <Field label="Details" hint="Optional for export and deletion. Do not include full names.">
          {(id) => <textarea id={id} className="textarea" value={details} onChange={(e) => setDetails(e.target.value)} maxLength={1000} />}
        </Field>
        {error ? <ErrorNote>{error}</ErrorNote> : null}
      </form>
      <ConfirmModal
        open={confirm}
        title={`Request deletion for ${student.displayName}?`}
        body="After approval, this student’s profile and game history are permanently deleted."
        confirmLabel="Request deletion"
        danger
        busy={busy}
        onCancel={() => setConfirm(false)}
        onConfirm={send}
      />
    </Modal>
  );
}

/** Portal onto <body>; only shows on paper (see .print-sheet in teacher.css). */
export function PrintSheet({ cards, joinCode, className }) {
  if (!cards?.length) return null;
  return createPortal(
    <div className="print-sheet" aria-hidden>
      {cards.map((c) => (
        <div key={c.id} className="print-card">
          <span className="print-avatar">{c.avatar || '🙂'}</span>
          <div style={{ display: 'grid', gap: 6 }}>
            <div>
              <div className="print-label">QuizQuest · {className}</div>
              <div className="print-value">{c.displayName}</div>
            </div>
            <div style={{ display: 'flex', gap: 20 }}>
              <div>
                <div className="print-label">Class code</div>
                <div className="print-value">{joinCode}</div>
              </div>
              <div>
                <div className="print-label">PIN</div>
                <div className="print-value">{c.pin}</div>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>,
    document.body
  );
}
