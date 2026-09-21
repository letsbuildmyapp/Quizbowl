// Students: roster, PINs, login cards, nickname requests, teams, family codes, privacy requests.
// Firestore reads:
//   classrooms (useClassroom), students where classroomId == X, teams where classroomId == X,
//   students/{id}/private/credentials (on reveal and for printing)
// Firestore writes:
//   students/{newId} set { classroomId, schoolId, teacherUid, displayName, avatar, teamId: null, active: true, consent: 'school', createdAt: ts }
//   students/{id}/private/credentials set { pin }
//   students/{id} update { displayName, avatar, teamId, active }
//   students/{id} update { displayName, 'nicknameRequest.status': 'approved' } | { 'nicknameRequest.status': 'rejected' }
//   teams/{auto} create { classroomId, name, emoji, color }; teams/{id} update / delete
//   parentInvites/{CODE} set { studentId, classroomId, teacherUid, expiresAt, usedBy: null, createdAt: ts }
//   awardRequests/{auto} via request(): { studentId, itemId, note } (bulk school gear award, one per student)
//   privacyRequests/{auto} { uid, requesterRole: 'teacher', studentId, classroomId, type, details, status: 'pending', createdAt: ts }
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase.js';
import { useClassroom } from '../../hooks/useClassroom.js';
import { timeAgo } from '../../lib/format.js';
import { Avatar, Button, Card, Chip, EmptyState, ErrorNote, Loading, friendlyError, useToast } from '../../components/ui.jsx';
import { ClassGate, TeacherHeader, useRoster, useTeams } from '../../components/teacher/TeacherPage.jsx';
import {
  AddStudentsModal,
  EditStudentModal,
  ParentInviteModal,
  PinCell,
  PrintSheet,
  PrivacyModal,
  TeamModal,
  credRef
} from '../../components/teacher/students-parts.jsx';
import { AwardModal } from '../../components/teacher/rewards-parts.jsx';

export default function Students() {
  const cls = useClassroom();
  const [adding, setAdding] = useState(false);
  const [printing, setPrinting] = useState(null);
  const [printBusy, setPrintBusy] = useState(false);
  const [printError, setPrintError] = useState(null);
  const roster = useRoster(cls.classroomId);

  const print = async () => {
    setPrintBusy(true);
    setPrintError(null);
    try {
      const cards = await Promise.all(
        roster.active.map(async (s) => {
          const snap = await getDoc(credRef(s.id));
          return { id: s.id, displayName: s.displayName, avatar: s.avatar, pin: snap.data()?.pin || '????' };
        })
      );
      setPrinting(cards);
    } catch (err) {
      setPrintError(err);
    } finally {
      setPrintBusy(false);
    }
  };

  // Print once the portal has rendered, then clear it.
  useEffect(() => {
    if (!printing) return undefined;
    const done = () => setPrinting(null);
    window.addEventListener('afterprint', done);
    const t = setTimeout(() => window.print(), 50);
    return () => {
      clearTimeout(t);
      window.removeEventListener('afterprint', done);
    };
  }, [printing]);

  return (
    <div className="page stack-lg">
      <TeacherHeader
        cls={cls}
        title="Students"
        subtitle="Students sign in with the class code, their alias, and a 4-digit PIN."
        actions={
          cls.classroom ? (
            <>
              <Button onClick={print} loading={printBusy} disabled={!roster.active.length}>
                Print login cards
              </Button>
              <Button variant="primary" onClick={() => setAdding(true)}>
                Add students
              </Button>
            </>
          ) : null
        }
      />
      <ClassGate cls={cls}>
        <ErrorNote error={printError} />
        <RosterBody classroom={cls.classroom} roster={roster} onAdd={() => setAdding(true)} />
        <AddStudentsModal open={adding} onClose={() => setAdding(false)} classroom={cls.classroom} existing={roster.data} />
        <PrintSheet cards={printing} joinCode={cls.classroom?.joinCode} className={cls.classroom?.name} />
      </ClassGate>
    </div>
  );
}

function RosterBody({ classroom, roster, onAdd }) {
  const teams = useTeams(classroom.id);
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState(null);
  const [inviting, setInviting] = useState(null);
  const [privacy, setPrivacy] = useState(null);
  const [teamEdit, setTeamEdit] = useState(null);
  const [awarding, setAwarding] = useState(false);

  if (roster.loading) return <Loading label="Loading students…" />;
  if (roster.error) return <ErrorNote error={roster.error} />;

  const inactiveCount = roster.data.length - roster.active.length;
  const shown = showInactive ? roster.data : roster.active;
  const pendingNicknames = roster.active.filter((s) => s.nicknameRequest?.status === 'pending' && s.nicknameRequest?.name);

  return (
    <>
      {pendingNicknames.length ? <NicknameRequests students={pendingNicknames} /> : null}

      <JoinCard classroom={classroom} />

      <Card className="stack">
        <div className="row-between">
          <h2>
            Roster <span className="muted tabular">({roster.active.length})</span>
          </h2>
          <div className="row">
            {inactiveCount ? (
              <label className="check">
                <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
                Show {inactiveCount} deactivated
              </label>
            ) : null}
            {roster.active.length ? (
              <Button onClick={() => setAwarding(true)}>
                <span aria-hidden>🎁</span> Award school gear
              </Button>
            ) : null}
          </div>
        </div>
        {!roster.data.length ? (
          <EmptyState emoji="🧑‍🎓" title="No students yet" action={<Button variant="primary" onClick={onAdd}>Add students</Button>}>
            Add each student with a nickname or first name and initial. Each one gets an avatar and a PIN.
          </EmptyState>
        ) : (
          <div className="table-wrap" style={{ position: 'relative' }}>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Student</th>
                  <th scope="col">Team</th>
                  <th scope="col">PIN</th>
                  <th scope="col">Last played</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <div className="row" style={{ flexWrap: 'nowrap' }}>
                        <Avatar emoji={s.avatar} />
                        <div className="stack" style={{ gap: 2 }}>
                          <Link to={`/teach/students/${s.id}`}>{s.displayName}</Link>
                          {s.active === false ? <Chip tone="gray">Deactivated</Chip> : null}
                          {s.consent === 'pending' || s.consent === 'revoked' ? <Chip tone="sun">Needs family consent</Chip> : null}
                          {s.joinedWithCode ? <Chip tone="gray">Joined with the code</Chip> : null}
                        </div>
                      </div>
                    </td>
                    <td>
                      <TeamSelect student={s} teams={teams.data} />
                    </td>
                    <td>
                      <PinCell student={s} />
                    </td>
                    <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                      {s.lastPlayedAt ? timeAgo(s.lastPlayedAt) : 'Not yet'}
                    </td>
                    <td>
                      <div className="row" style={{ flexWrap: 'nowrap', gap: 8 }}>
                        <Button size="sm" onClick={() => setEditing(s)} aria-label={`Edit ${s.displayName}`} style={{ minHeight: 44 }}>
                          Edit
                        </Button>
                        <Button size="sm" onClick={() => setInviting(s)} aria-label={`Family code for ${s.displayName}`} style={{ minHeight: 44 }}>
                          Family code
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setPrivacy(s)} aria-label={`Privacy request for ${s.displayName}`} style={{ minHeight: 44 }}>
                          Privacy
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="stack">
        <div className="row-between">
          <h2>Teams</h2>
          <Button onClick={() => setTeamEdit({})}>New team</Button>
        </div>
        {teams.loading ? (
          <Loading label="Loading teams…" />
        ) : teams.error ? (
          <ErrorNote error={teams.error} />
        ) : !teams.data.length ? (
          <EmptyState emoji="🛡️" title="No teams yet">
            Teams are used for Team Quests, live battles, and team leaderboards.
          </EmptyState>
        ) : (
          <ul className="t-list">
            {teams.data.map((t) => {
              const members = roster.active.filter((s) => s.teamId === t.id);
              return (
                <li key={t.id} className="row-between">
                  <div className="row" style={{ flexWrap: 'nowrap' }}>
                    <span className="avatar" style={{ background: t.color }} aria-hidden>
                      {t.emoji}
                    </span>
                    <div className="stack" style={{ gap: 2 }}>
                      <strong>{t.name}</strong>
                      <span className="caption">
                        {members.length ? members.map((m) => m.displayName).join(', ') : 'No members yet'}
                      </span>
                    </div>
                  </div>
                  <Button size="sm" onClick={() => setTeamEdit(t)} aria-label={`Edit team ${t.name}`} style={{ minHeight: 44 }}>
                    Edit
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        {teams.data.length ? <span className="caption">Pick each student’s team in the roster above.</span> : null}
      </Card>

      {awarding ? <AwardModal open students={roster.active} onClose={() => setAwarding(false)} /> : null}
      <EditStudentModal student={editing} teams={teams.data} onClose={() => setEditing(null)} />
      <ParentInviteModal student={inviting} classroomId={classroom.id} onClose={() => setInviting(null)} />
      <PrivacyModal student={privacy} classroomId={classroom.id} onClose={() => setPrivacy(null)} />
      <TeamModal
        team={teamEdit}
        classroomId={classroom.id}
        members={teamEdit?.id ? roster.data.filter((s) => s.teamId === teamEdit.id) : []}
        onClose={() => setTeamEdit(null)}
      />
    </>
  );
}

/** The class code, and whether students can add themselves with it. */
function JoinCard({ classroom }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const selfJoin = classroom.settings?.selfJoin !== false;

  const toggle = async (value) => {
    setBusy(true);
    try {
      await updateDoc(doc(db, 'classrooms', classroom.id), { 'settings.selfJoin': value });
      toast(value ? 'Students can join with the code' : 'Only you can add students now');
    } catch (err) {
      toast(friendlyError(err), { emoji: '\u26a0\ufe0f' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="stack">
      <div className="row-between" style={{ gap: 16, flexWrap: 'wrap' }}>
        <div className="stack" style={{ gap: 4 }}>
          <h2>Class code</h2>
          <span className="caption">Write it on the board. Students go to quizquest and type it in.</span>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <span className="t-code" aria-label={`Class code ${classroom.joinCode?.split('').join(' ')}`}>
            {classroom.joinCode || '\u00b7\u00b7\u00b7\u00b7\u00b7\u00b7'}
          </span>
          <Button
            onClick={() => {
              navigator.clipboard?.writeText(classroom.joinCode);
              toast('Class code copied');
            }}
          >
            Copy
          </Button>
        </div>
      </div>
      <label className="check">
        <input type="checkbox" checked={selfJoin} disabled={busy} onChange={(e) => toggle(e.target.checked)} />
        Let students join with the code
      </label>
      <span className="caption">
        {selfJoin
          ? 'A student types the code, picks a name and a PIN, and starts playing. You can rename or remove anyone here.'
          : 'Students can only sign in if you add them to the roster.'}
      </span>
    </Card>
  );
}

function TeamSelect({ student, teams }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const change = async (teamId) => {
    setBusy(true);
    try {
      await updateDoc(doc(db, 'students', student.id), { teamId: teamId || null });
    } catch (err) {
      toast(friendlyError(err), { emoji: '⚠️' });
    } finally {
      setBusy(false);
    }
  };
  if (!teams.length) return <span className="muted">No teams</span>;
  return (
    <select
      className="select"
      style={{ minWidth: 150 }}
      aria-label={`Team for ${student.displayName}`}
      value={student.teamId || ''}
      disabled={busy}
      onChange={(e) => change(e.target.value)}
    >
      <option value="">No team</option>
      {teams.map((t) => (
        <option key={t.id} value={t.id}>
          {t.emoji} {t.name}
        </option>
      ))}
    </select>
  );
}

function NicknameRequests({ students }) {
  const toast = useToast();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const decide = async (s, approve) => {
    setBusy(s.id + approve);
    setError(null);
    try {
      const ref = doc(db, 'students', s.id);
      if (approve) await updateDoc(ref, { displayName: s.nicknameRequest.name, 'nicknameRequest.status': 'approved' });
      else await updateDoc(ref, { 'nicknameRequest.status': 'rejected' });
      toast(approve ? `${s.nicknameRequest.name} approved` : 'Nickname request declined');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card tone="sun" className="stack">
      <h2>Nickname requests</h2>
      <ul className="t-list">
        {students.map((s) => (
          <li key={s.id} className="row-between">
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <Avatar emoji={s.avatar} />
              <span>
                <strong>{s.displayName}</strong> wants to be <strong>{s.nicknameRequest.name}</strong>
              </span>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <Button variant="primary" onClick={() => decide(s, true)} loading={busy === s.id + true}>
                Approve
              </Button>
              <Button onClick={() => decide(s, false)} loading={busy === s.id + false}>
                Decline
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <ErrorNote error={error} />
    </Card>
  );
}
