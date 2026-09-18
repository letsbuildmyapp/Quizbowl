// Content flags queue. Shows the reporter's role only, never who they are.
// Reads:  contentFlags (status == 'open' | 'resolved', orderBy createdAt desc, pages of 50)
// Writes: contentFlags/{id} { status: 'resolved', resolution, resolvedBy, resolvedAt: serverTimestamp() }
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, doc, orderBy, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { db } from '../../firebase.js';
import { Button, EmptyState, ErrorNote, Field, Loading, Modal, PageHeader, Segmented, useToast } from '../../components/ui.jsx';
import { LoadMore, ReqStatusChip, usePaged, when } from '../../components/admin/common.jsx';
import { useAuth } from '../../hooks/useAuth.jsx';
import './admin.css';

const ROLE_LABEL = { student: 'Student', teacher: 'Teacher', parent: 'Parent', admin: 'Admin' };

export default function Flags() {
  const { user } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState('open');
  const [resolving, setResolving] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const paged = usePaged(() => query(collection(db, 'contentFlags'), where('status', '==', tab), orderBy('createdAt', 'desc')), [tab]);

  const resolve = async () => {
    if (!note.trim()) {
      setError('Add a short note about what you did.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await updateDoc(doc(db, 'contentFlags', resolving.id), {
        status: 'resolved',
        resolution: note.trim(),
        resolvedBy: user.uid,
        resolvedAt: serverTimestamp()
      });
      paged.setRows((rows) => rows.filter((r) => r.id !== resolving.id));
      setResolving(null);
      setNote('');
      toast('Flag resolved');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page stack-xl">
      <PageHeader eyebrow="Content" title="Flags" subtitle="Reports about questions from teachers, students, and families." />
      <Segmented
        label="Flag status"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'open', label: 'Open' },
          { value: 'resolved', label: 'Resolved' }
        ]}
      />
      <ErrorNote error={paged.error} />
      {paged.loading ? (
        <Loading label="Loading flags…" />
      ) : !paged.rows.length ? (
        <EmptyState emoji={tab === 'open' ? '🎉' : '🗂️'} title={tab === 'open' ? 'No open flags' : 'No resolved flags yet'} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Question</th>
                <th scope="col">Reason</th>
                <th scope="col">Note</th>
                <th scope="col">Reported by</th>
                <th scope="col">Created</th>
                <th scope="col">{tab === 'open' ? <span className="sr-only">Actions</span> : 'Resolution'}</th>
              </tr>
            </thead>
            <tbody>
              {paged.rows.map((f) => (
                <tr key={f.id}>
                  <td>
                    {f.questionId ? (
                      <Link to={`/admin/content/${f.questionId}`} className="adm-mono">
                        {f.questionId}
                      </Link>
                    ) : (
                      <span className="muted">No question</span>
                    )}
                  </td>
                  <td style={{ fontWeight: 700 }}>{f.reason || 'Not given'}</td>
                  <td style={{ maxWidth: '40ch' }}>{f.note || <span className="muted">No note</span>}</td>
                  <td>{ROLE_LABEL[f.role] || f.role || 'Unknown'}</td>
                  <td className="tabular" style={{ whiteSpace: 'nowrap' }}>{when(f.createdAt)}</td>
                  <td>
                    {tab === 'open' ? (
                      <Button onClick={() => { setResolving(f); setNote(''); setError(null); }}>Resolve</Button>
                    ) : (
                      <div className="stack" style={{ gap: 4 }}>
                        <ReqStatusChip status="resolved" />
                        <span>{f.resolution}</span>
                        <span className="caption tabular">{when(f.resolvedAt)}</span>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <LoadMore paged={paged} />

      <Modal
        open={!!resolving}
        onClose={() => setResolving(null)}
        title="Resolve flag"
        footer={
          <>
            <Button onClick={() => setResolving(null)}>Cancel</Button>
            <Button variant="primary" onClick={resolve} loading={busy}>
              Mark resolved
            </Button>
          </>
        }
      >
        <div className="stack">
          <p className="prose">
            <strong>{resolving?.reason}</strong>
            {resolving?.note ? `: ${resolving.note}` : ''}
          </p>
          <Field label="What did you do?" hint="For example: fixed the clue wording, or checked and the answer is correct.">
            {(id) => <textarea id={id} className="textarea" value={note} onChange={(e) => setNote(e.target.value)} />}
          </Field>
          <ErrorNote error={error} />
        </div>
      </Modal>
    </div>
  );
}
