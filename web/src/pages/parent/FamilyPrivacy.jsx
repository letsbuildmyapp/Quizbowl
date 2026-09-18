// Family privacy: consent per child and privacy requests (access, export, correction, deletion).
// Reads:  guardianLinks (parentUid == uid, status == 'active'), students/{id},
//         privacyRequests (uid == uid, orderBy createdAt desc)
// Writes: parentRequests via request() { type: 'consent', studentId, grant }
//         privacyRequests/{auto} { uid, requesterRole: 'parent', studentId, type, details, status: 'pending', createdAt: serverTimestamp() }
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { addDoc, collection, orderBy, query, serverTimestamp, where } from 'firebase/firestore';
import { db } from '../../firebase.js';
import { Avatar, Button, Card, Chip, ConfirmModal, EmptyState, ErrorNote, Field, Loading, PageHeader, useToast } from '../../components/ui.jsx';
import { useFamily } from '../../components/parent/family.js';
import { useAuth } from '../../hooks/useAuth.jsx';
import { useQuery } from '../../hooks/useFirestore.js';
import { request } from '../../lib/requests.js';
import { downloadFile, fmtDateTime, toMillis } from '../../lib/format.js';
import './parent.css';

const TYPES = [
  { id: 'access', label: 'See the data', text: 'Get a readable copy of what QuizQuest keeps about your child.' },
  { id: 'export', label: 'Download the data', text: 'Get a JSON file of your child’s QuizQuest data to save or share.' },
  { id: 'correction', label: 'Fix something', text: 'Tell us what is wrong and the QuizQuest team will review it.' },
  { id: 'deletion', label: 'Delete the data', text: 'The school and QuizQuest team review this. Once deleted, progress, badges, and cards are gone for good.' }
];
const TYPE_LABEL = Object.fromEntries(TYPES.map((t) => [t.id, t.label]));

const CONSENT = {
  granted: { tone: 'green', label: 'Approved' },
  pending: { tone: 'sun', label: 'Waiting for your OK' },
  revoked: { tone: 'gray', label: 'Withdrawn' },
  school: { tone: 'teal', label: 'Handled by the school' }
};

const STATUS = {
  pending: { tone: 'sun', label: 'Pending' },
  approved: { tone: 'teal', label: 'Approved, in progress' },
  done: { tone: 'green', label: 'Done' },
  rejected: { tone: 'coral', label: 'Not approved' },
  error: { tone: 'coral', label: 'Needs attention' }
};

function ConsentRow({ child }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState(null);
  const status = CONSENT[child.consent] || CONSENT.school;
  const name = child.displayName || 'Your child';
  const canGrant = child.consent === 'pending' || child.consent === 'revoked';
  const canRevoke = child.consent === 'granted' || child.consent === 'pending';

  const decide = async (grant) => {
    setBusy(true);
    setError(null);
    try {
      await request('parentRequests', { type: 'consent', studentId: child.id, grant });
      setConfirm(false);
      toast(grant ? `Consent saved for ${name}.` : `Consent withdrawn for ${name}.`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="stack" style={{ gap: 12 }}>
      <div className="row-between">
        <div className="row">
          <Avatar emoji={child.avatar} />
          <strong>{name}</strong>
          <Chip tone={status.tone}>{status.label}</Chip>
        </div>
        <div className="row">
          {canGrant ? (
            <Button variant="primary" onClick={() => decide(true)} loading={busy && !confirm}>
              Approve
            </Button>
          ) : null}
          {canRevoke ? (
            <Button variant="danger" onClick={() => setConfirm(true)} disabled={busy}>
              Withdraw consent
            </Button>
          ) : null}
        </div>
      </div>
      <ErrorNote error={error} />
      <ConfirmModal
        open={confirm}
        title={`Withdraw consent for ${name}?`}
        body={`You can approve again at any time. To remove saved data too, send a deletion request below.`}
        confirmLabel="Withdraw consent"
        danger
        busy={busy}
        onConfirm={() => decide(false)}
        onCancel={() => setConfirm(false)}
      />
    </li>
  );
}

function RequestForm({ kids }) {
  const { user } = useAuth();
  const toast = useToast();
  const [studentId, setStudentId] = useState('');
  const [type, setType] = useState('access');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState(null);
  const chosen = studentId || kids[0]?.id || '';
  const child = kids.find((k) => k.id === chosen);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await addDoc(collection(db, 'privacyRequests'), {
        uid: user.uid,
        requesterRole: 'parent',
        studentId: chosen,
        type,
        details: details.trim(),
        status: 'pending',
        createdAt: serverTimestamp()
      });
      setConfirm(false);
      setDetails('');
      toast('Request sent. Track it below.', { emoji: '📨' });
    } catch (e) {
      setError(e);
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  };

  const submit = (e) => {
    e.preventDefault();
    if (!chosen) return;
    if (type === 'correction' && !details.trim()) {
      setError('Tell us what needs fixing.');
      return;
    }
    if (type === 'deletion') setConfirm(true);
    else send();
  };

  return (
    <form className="stack-lg" onSubmit={submit}>
      {kids.length > 1 ? (
        <Field label="Child">
          {(id) => (
            <select id={id} className="select" value={chosen} onChange={(e) => setStudentId(e.target.value)}>
              {kids.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.displayName || 'Child'}
                </option>
              ))}
            </select>
          )}
        </Field>
      ) : null}
      <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="label" style={{ marginBottom: 8 }}>
          What would you like to do?
        </legend>
        <div className="fam-type-grid">
          {TYPES.map((t) => (
            <label key={t.id} className="fam-type">
              <input type="radio" name="privacy-type" value={t.id} checked={type === t.id} onChange={() => setType(t.id)} />
              <span>
                <strong>{t.label}</strong>
                <span className="muted">{t.text}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <Field label={type === 'correction' ? 'What needs fixing?' : 'Anything we should know? (optional)'}>
        {(id) => <textarea id={id} className="textarea" value={details} maxLength={2000} onChange={(e) => setDetails(e.target.value)} />}
      </Field>
      <ErrorNote error={error} />
      <div>
        <Button type="submit" variant={type === 'deletion' ? 'coral' : 'primary'} size="lg" loading={busy && !confirm} disabled={!chosen}>
          Send request
        </Button>
      </div>
      <ConfirmModal
        open={confirm}
        title={`Delete ${child?.displayName || 'your child'}'s data?`}
        body="The school and QuizQuest team will review this request. Once approved, deletion is permanent and progress, badges, and cards cannot be restored."
        confirmLabel="Send deletion request"
        danger
        busy={busy}
        onConfirm={send}
        onCancel={() => setConfirm(false)}
      />
    </form>
  );
}

function MyRequests({ kidsById }) {
  const { user } = useAuth();
  const reqs = useQuery(
    () => (user ? query(collection(db, 'privacyRequests'), where('uid', '==', user.uid), orderBy('createdAt', 'desc')) : null),
    [user?.uid]
  );
  if (reqs.loading) return <Loading label="Loading your requests…" />;
  if (reqs.error) return <ErrorNote error={reqs.error} />;
  if (!reqs.data.length) {
    return (
      <EmptyState emoji="📭" title="No requests yet">
        Requests you send show up here with their status.
      </EmptyState>
    );
  }
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Request</th>
            <th scope="col">Child</th>
            <th scope="col">Sent</th>
            <th scope="col">Status</th>
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {reqs.data.map((r) => {
            const st = STATUS[r.status] || STATUS.pending;
            const kid = kidsById[r.studentId];
            const exp = r.result?.export;
            return (
              <tr key={r.id}>
                <td style={{ fontWeight: 700 }}>{TYPE_LABEL[r.type] || r.type}</td>
                <td>{kid?.displayName || 'Removed profile'}</td>
                <td className="tabular">{toMillis(r.createdAt) ? fmtDateTime(r.createdAt) : 'Sending…'}</td>
                <td>
                  <Chip tone={st.tone}>{st.label}</Chip>
                  {r.error || r.result?.note ? <div className="caption" style={{ marginTop: 6 }}>{r.result?.note || 'Please try again or contact the school.'}</div> : null}
                </td>
                <td>
                  {r.status === 'done' && exp ? (
                    <Button
                     
                      onClick={() =>
                        downloadFile(
                          `quizquest-${(kid?.displayName || 'child').replace(/\W+/g, '-').toLowerCase()}-${r.id}.json`,
                          typeof exp === 'string' ? exp : JSON.stringify(exp, null, 2),
                          'application/json'
                        )
                      }
                    >
                      Download
                    </Button>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function FamilyPrivacy() {
  const { user } = useAuth();
  const family = useFamily(user?.uid);
  const kids = family.children.filter((c) => !c.loading && !c.missing && !c.error);
  const kidsById = Object.fromEntries(kids.map((k) => [k.id, k]));

  return (
    <div className="page page-narrow stack-xl">
      <PageHeader
        eyebrow="Privacy"
        title="Your family's data"
        subtitle="QuizQuest keeps a nickname, practice answers and scores, badges, and cards. No full names, no chat, no ads."
      />

      <Card className="stack-lg" aria-labelledby="consent-title">
        <div className="stack" style={{ gap: 6 }}>
          <h2 id="consent-title">Consent</h2>
          <p className="muted prose">
            Some schools ask parents to approve QuizQuest. <Link to="/privacy">Read the privacy notice</Link>
          </p>
        </div>
        {family.loading ? <Loading /> : null}
        <ErrorNote error={family.error} />
        {!family.loading && !kids.length ? <p className="muted">Link a child on the My Family page to manage consent.</p> : null}
        {kids.length ? (
          <ul className="stack-lg" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {kids.map((k) => (
              <ConsentRow key={k.id} child={k} />
            ))}
          </ul>
        ) : null}
      </Card>

      <Card className="stack-lg" aria-labelledby="request-title">
        <div className="stack" style={{ gap: 6 }}>
          <h2 id="request-title">Make a privacy request</h2>
          <p className="muted prose">Download files are ready here once the request is done.</p>
        </div>
        {kids.length ? <RequestForm kids={kids} /> : <p className="muted">Link a child first to make a request.</p>}
      </Card>

      <section className="stack" aria-labelledby="mine-title">
        <h2 id="mine-title">Your requests</h2>
        <MyRequests kidsById={kidsById} />
      </section>
    </div>
  );
}
