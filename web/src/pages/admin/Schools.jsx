// Schools directory for platform admins.
// Reads:  schools, schools/{id}/teachers, count(classrooms where schoolId == id)
// Writes: none
import { useEffect, useState } from 'react';
import { collection, getCountFromServer, query, where } from 'firebase/firestore';
import { db } from '../../firebase.js';
import { Card, Chip, EmptyState, ErrorNote, Loading, Modal, PageHeader, Stat } from '../../components/ui.jsx';
import { PlatformOnly, when } from '../../components/admin/common.jsx';
import { useQuery } from '../../hooks/useFirestore.js';
import './admin.css';

const TEACHER = { approved: { tone: 'green', label: 'Approved' }, pending: { tone: 'sun', label: 'Pending' }, suspended: { tone: 'coral', label: 'Suspended' } };

function settingsSummary(s = {}) {
  const parts = [];
  parts.push(s.consentMode === 'parent' ? 'Parent consent' : 'School consent');
  if (s.retentionDays) parts.push(`${s.retentionDays}-day retention`);
  if (s.allowCrossSchoolChallenges) parts.push('Cross-school challenges on');
  if (s.timezone) parts.push(s.timezone);
  return parts.join(' · ');
}

function SchoolDetail({ school, onClose }) {
  const teachers = useQuery(() => (school ? collection(db, 'schools', school.id, 'teachers') : null), [school?.id]);
  const [classCount, setClassCount] = useState(null);
  const [countError, setCountError] = useState(null);

  useEffect(() => {
    if (!school) return undefined;
    let alive = true;
    setClassCount(null);
    setCountError(null);
    getCountFromServer(query(collection(db, 'classrooms'), where('schoolId', '==', school.id)))
      .then((r) => alive && setClassCount(r.data().count))
      .catch((e) => alive && setCountError(e));
    return () => {
      alive = false;
    };
  }, [school]);

  const sorted = [...teachers.data].sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));

  return (
    <Modal open={!!school} onClose={onClose} title={school?.name || 'School'} wide>
      <div className="stack-lg">
        <div className="adm-kpis">
          <Card>
            <Stat value={teachers.loading ? '…' : teachers.data.length} label="Teachers" />
          </Card>
          <Card>
            <Stat value={classCount == null ? (countError ? 'Unavailable' : '…') : classCount} label="Classrooms" />
          </Card>
          <Card>
            <Stat value={school?.adminUids?.length || 0} label="School admins" />
          </Card>
        </div>
        <p className="muted">{settingsSummary(school?.settings)}</p>
        {teachers.loading ? <Loading /> : null}
        <ErrorNote error={teachers.error} />
        {!teachers.loading && !sorted.length ? <p className="muted">No teachers yet.</p> : null}
        {sorted.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Teacher</th>
                  <th scope="col">Email</th>
                  <th scope="col">Status</th>
                  <th scope="col">Requested</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((t) => (
                  <tr key={t.id}>
                    <td style={{ fontWeight: 700 }}>
                      {t.displayName || 'No name'}
                      {t.isAdmin ? <span className="chip" style={{ marginLeft: 8 }}>Admin</span> : null}
                    </td>
                    <td className="adm-mono">{t.email || 'No email'}</td>
                    <td>
                      <Chip tone={TEACHER[t.status]?.tone || 'gray'}>{TEACHER[t.status]?.label || t.status || 'Unknown'}</Chip>
                    </td>
                    <td className="tabular">{when(t.requestedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function SchoolsInner() {
  const schools = useQuery(() => collection(db, 'schools'), []);
  const [open, setOpen] = useState(null);
  const sorted = [...schools.data].sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  return (
    <div className="page stack-xl">
      <PageHeader eyebrow="Platform" title="Schools" subtitle={schools.loading ? undefined : `${sorted.length} ${sorted.length === 1 ? 'school' : 'schools'}`} />
      <ErrorNote error={schools.error} />
      {schools.loading ? (
        <Loading label="Loading schools…" />
      ) : !sorted.length ? (
        <EmptyState emoji="🏫" title="No schools yet">
          Schools appear here when the first teacher signs up.
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">School</th>
                <th scope="col" className="num">Admins</th>
                <th scope="col">Settings</th>
                <th scope="col">Created</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((s) => (
                <tr key={s.id}>
                  <td>
                    <button type="button" className="btn btn-ghost" style={{ paddingLeft: 0, color: 'var(--purple)' }} onClick={() => setOpen(s)}>
                      {s.name || s.id}
                    </button>
                  </td>
                  <td className="num">{s.adminUids?.length || 0}</td>
                  <td className="caption">{settingsSummary(s.settings)}</td>
                  <td className="tabular" style={{ whiteSpace: 'nowrap' }}>{when(s.createdAt, false)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <SchoolDetail school={open} onClose={() => setOpen(null)} />
    </div>
  );
}

export default function Schools() {
  return (
    <PlatformOnly>
      <SchoolsInner />
    </PlatformOnly>
  );
}
