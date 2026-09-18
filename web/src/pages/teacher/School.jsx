// School admin: school settings, teacher join code, teacher approvals, class-level export, audit log.
// Firestore reads: schools/{schoolId}, schools/{schoolId}/teachers/*, classrooms where schoolId ==,
//   sessionSummaries where schoolId == X and completedAt in range,
//   auditEvents where schoolId == X orderBy at desc limit 50.
// Firestore writes: schools/{schoolId} update { settings }, schools/{schoolId} update { teacherJoinCode },
//   schools/{schoolId} update { theme } | { rewardCatalog } (components/teacher/SchoolTheme.jsx),
//   adminActions/{auto} (via request) { uid, action: 'approveTeacher'|'suspendTeacher', schoolId, teacherUid, status, createdAt }.
import { useMemo, useState } from 'react';
import { collection, doc, limit, orderBy, query, updateDoc, where } from 'firebase/firestore';
import { db } from '../../firebase.js';
import { useAuth } from '../../hooks/useAuth.jsx';
import { useDoc, useQuery } from '../../hooks/useFirestore.js';
import { downloadFile, fmtDateTime, fmtNum, toCsv } from '../../lib/format.js';
import { randomCode, request } from '../../lib/requests.js';
import { Button, Card, Chip, ConfirmModal, EmptyState, ErrorNote, Field, Loading, PageHeader, Segmented, friendlyError, useToast } from '../../components/ui.jsx';
import { useSummaries } from '../../components/teacher/TeacherPage.jsx';
import { DAY_MS, pctText, totals } from '../../components/teacher/stats.js';
import { RewardCatalogCard, SchoolThemeCard } from '../../components/teacher/SchoolTheme.jsx';

const STATUS_TONE = { approved: 'green', pending: 'sun', suspended: 'coral' };
const STATUS_LABEL = { approved: 'Approved', pending: 'Waiting for approval', suspended: 'Suspended' };

const TIMEZONES = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu'];

const toInputDate = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function withDefaults(s = {}) {
  return {
    consentMode: s.consentMode || 'school',
    retentionDays: s.retentionDays ?? 365,
    timezone: s.timezone || 'America/New_York',
    allowCrossSchoolChallenges: s.allowCrossSchoolChallenges ?? true
  };
}

function SettingsCard({ school }) {
  const toast = useToast();
  const [draft, setDraft] = useState(() => withDefaults(school.settings));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const zones = TIMEZONES.includes(draft.timezone) ? TIMEZONES : [draft.timezone, ...TIMEZONES];

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const retentionDays = Math.max(30, Math.min(730, Math.round(Number(draft.retentionDays) || 365)));
      await updateDoc(doc(db, 'schools', school.id), { settings: { ...draft, retentionDays } });
      setDraft((d) => ({ ...d, retentionDays }));
      toast('School settings saved');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="stack-lg">
      <h2>School settings</h2>
      <div className="field">
        <span className="label">Who gives consent for students to play</span>
        <Segmented
          label="Consent mode"
          value={draft.consentMode}
          onChange={(v) => set({ consentMode: v })}
          options={[
            { value: 'school', label: 'The school' },
            { value: 'parent', label: 'A parent' }
          ]}
        />
        <span className="hint">
          {draft.consentMode === 'school'
            ? 'The school authorizes use under its agreement.'
            : 'A parent must grant consent before a student can play.'}
        </span>
      </div>
      <div className="grid-2">
        <Field label="Keep game details for (days)" hint="30 to 730. Event-level game data is deleted after this.">
          {(id) => (
            <input
              id={id}
              type="number"
              className="input tabular"
              min={30}
              max={730}
              value={draft.retentionDays}
              onChange={(e) => set({ retentionDays: e.target.value === '' ? '' : Number(e.target.value) })}
            />
          )}
        </Field>
        <Field label="Time zone" hint="Used for daily streaks and weekly totals.">
          {(id) => (
            <select id={id} className="select" value={draft.timezone} onChange={(e) => set({ timezone: e.target.value })}>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z.replace('_', ' ')}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <label className="check">
        <input type="checkbox" checked={draft.allowCrossSchoolChallenges} onChange={(e) => set({ allowCrossSchoolChallenges: e.target.checked })} />
        Allow classes to join challenges hosted by other schools
      </label>
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      <div className="row">
        <Button variant="primary" onClick={save} loading={busy}>
          Save school settings
        </Button>
      </div>
    </Card>
  );
}

function JoinCodeCard({ school }) {
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const regenerate = async () => {
    setBusy(true);
    setError(null);
    try {
      await updateDoc(doc(db, 'schools', school.id), { teacherJoinCode: randomCode(8) });
      toast('New teacher join code ready');
      setConfirm(false);
    } catch (err) {
      setError(friendlyError(err));
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="stack">
      <h2>Teacher join code</h2>
      <p className="muted">Teachers enter this code when they sign up. You approve them below.</p>
      <span className="t-code" aria-label={`Teacher join code ${(school.teacherJoinCode || '').split('').join(' ')}`}>
        {school.teacherJoinCode || 'None yet'}
      </span>
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      <div className="row">
        <Button onClick={() => setConfirm(true)}>Make a new code</Button>
      </div>
      <ConfirmModal
        open={confirm}
        title="Make a new teacher join code?"
        body="The old code stops working. Teachers already in your school are not affected."
        confirmLabel="Make new code"
        onConfirm={regenerate}
        onCancel={() => setConfirm(false)}
        busy={busy}
      />
    </Card>
  );
}

function TeachersCard({ schoolId, myUid }) {
  const toast = useToast();
  const teachers = useQuery(() => collection(db, 'schools', schoolId, 'teachers'), [schoolId]);
  const [busyId, setBusyId] = useState(null);
  const [suspending, setSuspending] = useState(null);
  const [error, setError] = useState(null);

  const act = async (action, t) => {
    setBusyId(t.id);
    setError(null);
    try {
      await request('adminActions', { action, schoolId, teacherUid: t.id });
      toast(action === 'approveTeacher' ? `${t.displayName || 'Teacher'} approved` : `${t.displayName || 'Teacher'} suspended`);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusyId(null);
      setSuspending(null);
    }
  };

  const order = { pending: 0, approved: 1, suspended: 2 };
  const list = teachers.data.slice().sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3) || (a.displayName || '').localeCompare(b.displayName || ''));

  return (
    <Card className="stack">
      <h2>Teachers</h2>
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      {teachers.error ? (
        <ErrorNote error={teachers.error} />
      ) : teachers.loading ? (
        <Loading />
      ) : list.length ? (
        <div className="table-wrap" style={{ position: 'relative' }}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Teacher</th>
                <th scope="col">Status</th>
                <th scope="col">Requested</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((t) => (
                <tr key={t.id}>
                  <td>
                    <div className="stack" style={{ gap: 2 }}>
                      <span style={{ fontWeight: 800 }}>
                        {t.displayName || 'Teacher'}
                        {t.isAdmin ? ' (admin)' : ''}
                      </span>
                      {t.email ? <span className="caption">{t.email}</span> : null}
                    </div>
                  </td>
                  <td>
                    <Chip tone={STATUS_TONE[t.status] || 'gray'}>{STATUS_LABEL[t.status] || t.status || 'Unknown'}</Chip>
                  </td>
                  <td className="tabular">{fmtDateTime(t.requestedAt)}</td>
                  <td>
                    <div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                      {t.status !== 'approved' ? (
                        <Button size="sm" variant="primary" loading={busyId === t.id} onClick={() => act('approveTeacher', t)}>
                          Approve
                        </Button>
                      ) : null}
                      {t.status !== 'suspended' && t.id !== myUid ? (
                        <Button size="sm" variant="danger" disabled={busyId === t.id} onClick={() => setSuspending(t)}>
                          Suspend
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState emoji="🧑‍🏫" title="No teachers yet">Share the teacher join code to invite colleagues.</EmptyState>
      )}
      <ConfirmModal
        open={!!suspending}
        danger
        title={`Suspend ${suspending?.displayName || 'this teacher'}?`}
        body="They lose access to their classes until you approve them again. Student progress is kept."
        confirmLabel="Suspend"
        onConfirm={() => act('suspendTeacher', suspending)}
        onCancel={() => setSuspending(null)}
        busy={!!suspending && busyId === suspending.id}
      />
    </Card>
  );
}

function ExportCard({ schoolId }) {
  const [from, setFrom] = useState(() => toInputDate(Date.now() - 27 * DAY_MS));
  const [to, setTo] = useState(() => toInputDate(Date.now()));
  const { since, until } = useMemo(() => {
    const s = new Date(`${from}T00:00:00`).getTime();
    const u = new Date(`${to}T23:59:59.999`).getTime();
    return { since: Number.isFinite(s) ? s : Date.now() - 28 * DAY_MS, until: Number.isFinite(u) ? u : null };
  }, [from, to]);

  const sums = useSummaries('schoolId', schoolId, since, until);
  const classes = useQuery(() => query(collection(db, 'classrooms'), where('schoolId', '==', schoolId)), [schoolId]);

  const rows = useMemo(() => {
    const groups = {};
    for (const s of sums.data) (groups[s.classroomId || 'none'] ||= []).push(s);
    const names = Object.fromEntries(classes.data.map((c) => [c.id, c.name]));
    return Object.entries(groups)
      .map(([id, list]) => {
        const t = totals(list);
        return { name: names[id] || 'Other class', students: new Set(list.map((s) => s.studentId)).size, ...t };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [sums.data, classes.data]);

  const exportCsv = () => {
    const header = ['Class', 'Students who played', 'Sessions', 'Questions', 'Accuracy'];
    const body = rows.map((r) => [r.name, r.students, r.sessions, r.seen, pctText(r.correct, r.answered)]);
    downloadFile(`quizquest-school-${from}_to_${to}.csv`, toCsv([header, ...body]));
  };

  return (
    <Card className="stack">
      <h2>School export</h2>
      <p className="muted">Class-level totals only. No student names or ids.</p>
      <div className="grid-2">
        <Field label="From">{(id) => <input id={id} type="date" className="input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />}</Field>
        <Field label="To">{(id) => <input id={id} type="date" className="input" value={to} min={from} onChange={(e) => setTo(e.target.value)} />}</Field>
      </div>
      {sums.error ? <ErrorNote error={sums.error} /> : null}
      {classes.error ? <ErrorNote error={classes.error} /> : null}
      {sums.loading || classes.loading ? (
        <Loading />
      ) : rows.length ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Class</th>
                <th scope="col" className="num">Students who played</th>
                <th scope="col" className="num">Sessions</th>
                <th scope="col" className="num">Questions</th>
                <th scope="col" className="num">Accuracy</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name}>
                  <td>{r.name}</td>
                  <td className="num">{fmtNum(r.students)}</td>
                  <td className="num">{fmtNum(r.sessions)}</td>
                  <td className="num">{fmtNum(r.seen)}</td>
                  <td className="num">{pctText(r.correct, r.answered)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState emoji="📊" title="No games in this range" />
      )}
      <div className="row">
        <Button variant="primary" onClick={exportCsv} disabled={!rows.length}>
          Export CSV
        </Button>
      </div>
    </Card>
  );
}

function detailText(e) {
  const d = e.details;
  if (!d) return '';
  if (typeof d === 'string') return d;
  try {
    return JSON.stringify(d).slice(0, 140);
  } catch {
    return '';
  }
}

function AuditCard({ schoolId }) {
  const log = useQuery(() => query(collection(db, 'auditEvents'), where('schoolId', '==', schoolId), orderBy('at', 'desc'), limit(50)), [schoolId]);
  return (
    <Card className="stack">
      <h2>Audit log</h2>
      <p className="muted">The latest 50 actions in your school.</p>
      {log.error ? (
        <ErrorNote error={log.error} />
      ) : log.loading ? (
        <Loading />
      ) : log.data.length ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Action</th>
                <th scope="col">By</th>
                <th scope="col">Details</th>
              </tr>
            </thead>
            <tbody>
              {log.data.map((e) => (
                <tr key={e.id}>
                  <td className="tabular" style={{ whiteSpace: 'nowrap' }}>
                    {fmtDateTime(e.at)}
                  </td>
                  <td>{e.action}</td>
                  <td>{e.actorRole || 'system'}</td>
                  <td className="caption">{[typeof e.target === 'string' ? e.target : '', detailText(e)].filter(Boolean).join(' · ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState emoji="🗒️" title="Nothing logged yet" />
      )}
    </Card>
  );
}

export default function School() {
  const { claims, isSchoolAdmin, user } = useAuth();
  const schoolId = isSchoolAdmin ? claims.schoolId : null;
  const school = useDoc(schoolId ? `schools/${schoolId}` : null);

  if (!isSchoolAdmin || !claims.schoolId) {
    return (
      <div className="page">
        <EmptyState emoji="🏫" title="School admins only">Ask your school admin to change school settings or approve teachers.</EmptyState>
      </div>
    );
  }

  return (
    <div className="page stack-lg">
      <PageHeader eyebrow="School admin" title={school.data?.name || 'Your school'} subtitle="Settings, theme, teachers, and school-wide data." />
      {school.error ? <ErrorNote error={school.error} /> : null}
      {school.loading ? (
        <Loading label="Loading your school…" />
      ) : !school.data ? (
        <EmptyState emoji="🏫" title="School not found">Try again in a minute. If it keeps happening, contact support.</EmptyState>
      ) : (
        <>
          <div className="grid-2">
            <SettingsCard key={school.data.id} school={school.data} />
            <JoinCodeCard school={school.data} />
          </div>
          <SchoolThemeCard key={`theme-${school.data.id}`} school={school.data} />
          <RewardCatalogCard key={`catalog-${school.data.id}`} school={school.data} />
          <TeachersCard schoolId={schoolId} myUid={user?.uid} />
          <ExportCard schoolId={schoolId} />
          <AuditCard schoolId={schoolId} />
        </>
      )}
    </div>
  );
}
