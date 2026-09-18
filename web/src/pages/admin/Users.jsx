// Look up a user by exact email or uid and change admin roles or suspension.
// Reads:  users (email == x, limit 5) or users/{uid}, schools/{schoolId}
// Writes: adminActions via request() { action: 'setContentAdmin'|'setPlatformAdmin'|'suspendUser'|'unsuspendUser', targetUid, value }
import { useEffect, useState } from 'react';
import { collection, doc, getDoc, getDocs, limit, query, where } from 'firebase/firestore';
import { db } from '../../firebase.js';
import { Button, Card, Chip, ConfirmModal, EmptyState, ErrorNote, Field, PageHeader, useToast } from '../../components/ui.jsx';
import { PlatformOnly, when } from '../../components/admin/common.jsx';
import { useAuth } from '../../hooks/useAuth.jsx';
import { request } from '../../lib/requests.js';
import './admin.css';

const ROLE_LABEL = { teacher: 'Teacher', teacher_pending: 'Teacher (pending)', parent: 'Parent', student: 'Student' };

const ACTIONS = [
  { key: 'grant-content', action: 'setContentAdmin', value: true, label: 'Grant content admin', title: 'Make this user a content admin?', body: 'They will be able to create, review, and publish questions.', show: (u) => u.contentAdmin !== true },
  { key: 'remove-content', action: 'setContentAdmin', value: false, label: 'Remove content admin', title: 'Remove content admin?', body: 'They will lose access to the question bank.', danger: true, show: (u) => u.contentAdmin !== false },
  { key: 'grant-platform', action: 'setPlatformAdmin', value: true, label: 'Grant platform admin', title: 'Make this user a platform admin?', body: 'They will see every school, the audit log, the privacy queue, and analytics.', show: (u) => u.platformAdmin !== true },
  { key: 'remove-platform', action: 'setPlatformAdmin', value: false, label: 'Remove platform admin', title: 'Remove platform admin?', body: 'They will lose access to platform tools.', danger: true, self: true, show: (u) => u.platformAdmin !== false },
  { key: 'suspend', action: 'suspendUser', value: true, label: 'Suspend account', title: 'Suspend this account?', body: 'They will be blocked from QuizQuest until unsuspended.', danger: true, self: true, show: (u) => u.suspended !== true },
  { key: 'unsuspend', action: 'unsuspendUser', value: false, label: 'Unsuspend account', title: 'Unsuspend this account?', body: 'They will be able to sign in again.', show: (u) => u.suspended !== false }
];

const flag = (v) => (v === true ? 'Yes' : v === false ? 'No' : 'Unknown');

function UserCard({ u, onChanged }) {
  const { user } = useAuth();
  const toast = useToast();
  const [school, setSchool] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const isSelf = u.id === user.uid;

  useEffect(() => {
    if (!u.schoolId) return undefined;
    let alive = true;
    setSchool(null);
    getDoc(doc(db, 'schools', u.schoolId))
      .then((s) => alive && setSchool(s.exists() ? s.data().name || u.schoolId : 'Removed school'))
      .catch(() => alive && setSchool(u.schoolId));
    return () => {
      alive = false;
    };
  }, [u.schoolId]);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await request('adminActions', { action: confirm.action, targetUid: u.id, value: confirm.value });
      toast('Done');
      setConfirm(null);
      onChanged?.();
    } catch (e) {
      setError(e);
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="stack-lg">
      <div className="row-between">
        <div className="stack" style={{ gap: 4 }}>
          <h2>{u.displayName || 'No name'}</h2>
          <span className="adm-mono">{u.email || 'No email'}</span>
        </div>
        <div className="row">
          <Chip>{ROLE_LABEL[u.role] || u.role || 'No role'}</Chip>
          {u.suspended ? <Chip tone="coral">Suspended</Chip> : null}
          {isSelf ? <Chip tone="gray">You</Chip> : null}
        </div>
      </div>
      <dl className="adm-dl">
        <dt>User ID</dt>
        <dd className="adm-mono">{u.id}</dd>
        <dt>School</dt>
        <dd>{u.schoolId ? school || 'Loading…' : 'None'}</dd>
        <dt>Created</dt>
        <dd className="tabular">{when(u.createdAt)}</dd>
        <dt>Content admin</dt>
        <dd>{flag(u.contentAdmin)}</dd>
        <dt>Platform admin</dt>
        <dd>{flag(u.platformAdmin)}</dd>
      </dl>
      <div className="row">
        {ACTIONS.filter((a) => a.show(u)).map((a) => (
          <Button key={a.key} variant={a.danger ? 'danger' : 'default'} onClick={() => setConfirm(a)} disabled={(a.self && isSelf) || busy}>
            {a.label}
          </Button>
        ))}
      </div>
      {isSelf ? <p className="caption">You can't remove your own platform admin role or suspend yourself.</p> : null}
      <ErrorNote error={error} />
      <ConfirmModal
        open={!!confirm}
        title={confirm?.title}
        body={`${confirm?.body} Target: ${u.email || u.id}.`}
        confirmLabel={confirm?.label}
        danger={confirm?.danger}
        busy={busy}
        onConfirm={run}
        onCancel={() => setConfirm(null)}
      />
    </Card>
  );
}

function UsersInner() {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const search = async (e) => {
    e?.preventDefault();
    const t = term.trim();
    if (!t) return;
    setBusy(true);
    setError(null);
    try {
      if (t.includes('@')) {
        let snap = await getDocs(query(collection(db, 'users'), where('email', '==', t), limit(5)));
        if (snap.empty && t !== t.toLowerCase()) snap = await getDocs(query(collection(db, 'users'), where('email', '==', t.toLowerCase()), limit(5)));
        setResults(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } else {
        const d = await getDoc(doc(db, 'users', t));
        setResults(d.exists() ? [{ id: d.id, ...d.data() }] : []);
      }
    } catch (err) {
      setError(err);
      setResults(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page page-narrow stack-xl">
      <PageHeader eyebrow="Platform" title="Users" subtitle="Find an account by exact email or user ID." />
      <Card>
        <form className="stack" onSubmit={search}>
          <Field label="Email or user ID">
            {(id) => <input id={id} className="input" value={term} onChange={(e) => setTerm(e.target.value)} autoComplete="off" spellCheck={false} placeholder="name@school.org" />}
          </Field>
          <div>
            <Button type="submit" variant="primary" loading={busy}>
              Look up
            </Button>
          </div>
        </form>
      </Card>
      <ErrorNote error={error} />
      {results && !results.length ? (
        <EmptyState emoji="🔍" title="No account found">
          Check the spelling. Email lookups need the exact address.
        </EmptyState>
      ) : null}
      {results?.map((u) => (
        <UserCard key={u.id} u={u} onChanged={search} />
      ))}
    </div>
  );
}

export default function Users() {
  return (
    <PlatformOnly>
      <UsersInner />
    </PlatformOnly>
  );
}
