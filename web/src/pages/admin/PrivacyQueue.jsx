// Privacy request queue. Deletion and correction requests need a decision; access and export run automatically.
// Reads:  privacyRequests (status == s, orderBy createdAt desc; or all by createdAt desc), students/{id} (alias)
// Writes: adminActions via request() { action: 'decidePrivacy', requestId, decision: 'approve'|'reject', note }
import { useState } from 'react';
import { collection, orderBy, query, where } from 'firebase/firestore';
import { db } from '../../firebase.js';
import { Avatar, Button, EmptyState, ErrorNote, Field, Loading, Modal, PageHeader, Segmented, useToast } from '../../components/ui.jsx';
import { LoadMore, PlatformOnly, ReqStatusChip, usePaged, when } from '../../components/admin/common.jsx';
import { useDoc } from '../../hooks/useFirestore.js';
import { request } from '../../lib/requests.js';
import './admin.css';

const TYPE_LABEL = { access: 'Access', export: 'Export', correction: 'Correction', deletion: 'Deletion' };
const FILTERS = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'done', label: 'Done' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'all', label: 'All' }
];

function StudentAlias({ id }) {
  const s = useDoc(id ? `students/${id}` : null);
  if (!id) return <span className="muted">None</span>;
  if (s.loading) return <span className="muted">Loading…</span>;
  if (s.error) return <span className="muted">Unavailable</span>;
  if (!s.data) return <span className="muted">Profile deleted</span>;
  return (
    <span className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
      <Avatar emoji={s.data.avatar} />
      {s.data.displayName || 'No alias'}
    </span>
  );
}

function PrivacyInner() {
  const toast = useToast();
  const [status, setStatus] = useState('pending');
  const [deciding, setDeciding] = useState(null); // { req, decision }
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const paged = usePaged(
    () =>
      status === 'all'
        ? query(collection(db, 'privacyRequests'), orderBy('createdAt', 'desc'))
        : query(collection(db, 'privacyRequests'), where('status', '==', status), orderBy('createdAt', 'desc')),
    [status]
  );

  const open = (req, decision) => {
    setDeciding({ req, decision });
    setNote('');
    setError(null);
  };

  const decide = async () => {
    const { req, decision } = deciding;
    if (decision === 'reject' && !note.trim()) {
      setError('Add a note explaining why.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await request('adminActions', { action: 'decidePrivacy', requestId: req.id, decision, note: note.trim() });
      toast(decision === 'approve' ? 'Request approved' : 'Request rejected');
      setDeciding(null);
      paged.reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const title = !deciding
    ? ''
    : deciding.req.type === 'deletion'
      ? deciding.decision === 'approve'
        ? 'Approve deletion?'
        : 'Reject deletion?'
      : deciding.decision === 'approve'
        ? 'Mark correction done?'
        : 'Reject correction?';

  return (
    <div className="page stack-xl">
      <PageHeader eyebrow="Platform" title="Privacy requests" subtitle="Access and export requests run automatically. Deletions and corrections need a decision here." />
      <Segmented label="Status" value={status} onChange={setStatus} options={FILTERS} />
      <ErrorNote error={paged.error} />
      {paged.loading ? (
        <Loading label="Loading requests…" />
      ) : !paged.rows.length ? (
        <EmptyState emoji="📭" title={status === 'pending' ? 'Nothing waiting' : 'No requests here'} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Type</th>
                <th scope="col">From</th>
                <th scope="col">Student</th>
                <th scope="col">Details</th>
                <th scope="col">Created</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {paged.rows.map((r) => {
                const needsDecision = r.status === 'pending' && (r.type === 'deletion' || r.type === 'correction');
                return (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 800 }}>{TYPE_LABEL[r.type] || r.type}</td>
                    <td>{r.requesterRole || 'Unknown'}</td>
                    <td>
                      <StudentAlias id={r.studentId} />
                    </td>
                    <td style={{ maxWidth: '36ch' }}>{r.details || <span className="muted">None</span>}</td>
                    <td className="tabular" style={{ whiteSpace: 'nowrap' }}>{when(r.createdAt)}</td>
                    <td>
                      <ReqStatusChip status={r.status} />
                      {r.error ? <div className="caption" style={{ marginTop: 6 }}>{r.error}</div> : null}
                    </td>
                    <td>
                      {needsDecision ? (
                        <div className="row" style={{ flexWrap: 'nowrap' }}>
                          <Button variant={r.type === 'deletion' ? 'coral' : 'primary'} onClick={() => open(r, 'approve')}>
                            {r.type === 'deletion' ? 'Approve' : 'Mark done'}
                          </Button>
                          <Button onClick={() => open(r, 'reject')}>Reject</Button>
                        </div>
                      ) : r.status === 'pending' ? (
                        <span className="caption">Processing automatically</span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <LoadMore paged={paged} />

      <Modal
        open={!!deciding}
        onClose={() => setDeciding(null)}
        title={title}
        footer={
          <>
            <Button onClick={() => setDeciding(null)}>Cancel</Button>
            <Button variant={deciding?.decision === 'approve' && deciding?.req.type === 'deletion' ? 'coral' : 'primary'} onClick={decide} loading={busy}>
              {deciding?.decision === 'approve' ? (deciding?.req.type === 'deletion' ? 'Approve deletion' : 'Mark done') : 'Reject request'}
            </Button>
          </>
        }
      >
        <div className="stack">
          {deciding?.req.type === 'deletion' && deciding?.decision === 'approve' ? (
            <div className="alert alert-error">Deletion is permanent. The student's progress, badges, and cards cannot be restored.</div>
          ) : null}
          {deciding?.req.details ? (
            <p className="prose">
              <strong>Request details:</strong> {deciding.req.details}
            </p>
          ) : null}
          <Field label={deciding?.decision === 'reject' ? 'Reason (shown to the requester)' : 'Note (optional)'}>
            {(id) => <textarea id={id} className="textarea" value={note} onChange={(e) => setNote(e.target.value)} />}
          </Field>
          <ErrorNote error={error} />
        </div>
      </Modal>
    </div>
  );
}

export default function PrivacyQueue() {
  return (
    <PlatformOnly>
      <PrivacyInner />
    </PlatformOnly>
  );
}
