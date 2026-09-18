// Pilot requests from the public landing page form.
// Reads:  pilotRequests (orderBy createdAt desc, pages of 50)
// Writes: pilotRequests/{id} { contacted: true }
import { useState } from 'react';
import { collection, doc, orderBy, query, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase.js';
import { Button, Chip, EmptyState, ErrorNote, Loading, PageHeader, Segmented, useToast } from '../../components/ui.jsx';
import { LoadMore, PlatformOnly, usePaged, when } from '../../components/admin/common.jsx';
import './admin.css';

function PilotsInner() {
  const toast = useToast();
  const [show, setShow] = useState('new');
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);
  const paged = usePaged(() => query(collection(db, 'pilotRequests'), orderBy('createdAt', 'desc')), []);
  const rows = show === 'new' ? paged.rows.filter((r) => !r.contacted) : paged.rows;

  const markContacted = async (r) => {
    setBusyId(r.id);
    setError(null);
    try {
      await updateDoc(doc(db, 'pilotRequests', r.id), { contacted: true });
      paged.setRows((list) => list.map((x) => (x.id === r.id ? { ...x, contacted: true } : x)));
      toast('Marked as contacted');
    } catch (e) {
      setError(e);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="page stack-xl">
      <PageHeader eyebrow="Platform" title="Pilot requests" subtitle="Schools and teachers who asked to try QuizQuest." />
      <Segmented
        label="Show"
        value={show}
        onChange={setShow}
        options={[
          { value: 'new', label: 'Not contacted' },
          { value: 'all', label: 'All' }
        ]}
      />
      <ErrorNote error={paged.error || error} />
      {paged.loading ? (
        <Loading label="Loading requests…" />
      ) : !rows.length ? (
        <EmptyState emoji="📬" title={show === 'new' ? 'Everyone has been contacted' : 'No pilot requests yet'} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Role</th>
                <th scope="col">School</th>
                <th scope="col">Email</th>
                <th scope="col" className="num">Students</th>
                <th scope="col">Message</th>
                <th scope="col">Created</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 800 }}>{r.name || 'No name'}</td>
                  <td>{r.role || 'Not given'}</td>
                  <td>{r.school || 'Not given'}</td>
                  <td className="adm-mono">{r.email ? <a href={`mailto:${r.email}`}>{r.email}</a> : 'None'}</td>
                  <td className="num">{r.students ?? ''}</td>
                  <td style={{ maxWidth: '40ch' }}>{r.message || <span className="muted">No message</span>}</td>
                  <td className="tabular" style={{ whiteSpace: 'nowrap' }}>{when(r.createdAt)}</td>
                  <td>
                    {r.contacted ? (
                      <Chip tone="green">Contacted</Chip>
                    ) : (
                      <Button onClick={() => markContacted(r)} loading={busyId === r.id}>
                        Mark contacted
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <LoadMore paged={paged} />
    </div>
  );
}

export default function Pilots() {
  return (
    <PlatformOnly>
      <PilotsInner />
    </PlatformOnly>
  );
}
