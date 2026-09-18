// Question bank list with filters, status counts, and question set management.
// Reads:  questions (equality filters on status/category/setId/type, orderBy updatedAt desc, pages of 50),
//         count(questions where status == s), questionSets
// Writes: questionSets/{auto} { name, sourceOwner, license, rightsNote, usageWindowEnd|null, createdBy, createdAt: serverTimestamp() }
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { addDoc, collection, getCountFromServer, orderBy, query, serverTimestamp, where } from 'firebase/firestore';
import { db } from '../../firebase.js';
import { Button, ButtonLink, Card, EmptyState, ErrorNote, Field, Loading, Modal, PageHeader, useToast } from '../../components/ui.jsx';
import { LoadMore, QStatusChip, Q_STATUS_LABEL, usePaged, useQuestionSets, when } from '../../components/admin/common.jsx';
import { STATUSES } from '../../components/admin/questionModel.js';
import { useAuth } from '../../hooks/useAuth.jsx';
import { CATEGORIES, categoryMeta } from '../../lib/catalog.js';
import './admin.css';

function useStatusCounts(refreshKey) {
  const [counts, setCounts] = useState(null);
  useEffect(() => {
    let alive = true;
    Promise.all(STATUSES.map((s) => getCountFromServer(query(collection(db, 'questions'), where('status', '==', s))).then((r) => r.data().count)))
      .then((vals) => alive && setCounts(Object.fromEntries(STATUSES.map((s, i) => [s, vals[i]]))))
      .catch(() => alive && setCounts({}));
    return () => {
      alive = false;
    };
  }, [refreshKey]);
  return counts;
}

function SetsModal({ open, onClose, sets }) {
  const { user } = useAuth();
  const toast = useToast();
  const blank = { name: '', sourceOwner: '', license: '', rightsNote: '', usageWindowEnd: '' };
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const missing = ['name', 'sourceOwner', 'license'].filter((k) => !form[k].trim());

  const create = async (e) => {
    e.preventDefault();
    if (missing.length) {
      setError('Name, source owner, and license are required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const end = form.usageWindowEnd ? new Date(`${form.usageWindowEnd}T23:59:59`).getTime() : null;
      await addDoc(collection(db, 'questionSets'), {
        name: form.name.trim(),
        sourceOwner: form.sourceOwner.trim(),
        license: form.license.trim(),
        rightsNote: form.rightsNote.trim(),
        usageWindowEnd: end,
        createdBy: user.uid,
        createdAt: serverTimestamp()
      });
      setForm(blank);
      toast('Question set created');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const sorted = [...sets.data].sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  return (
    <Modal open={open} onClose={onClose} title="Question sets" wide>
      <div className="stack-lg">
        {sets.loading ? <Loading /> : null}
        <ErrorNote error={sets.error} />
        {!sets.loading && !sorted.length ? <p className="muted">No sets yet. Create the first one below.</p> : null}
        {sorted.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Source owner</th>
                  <th scope="col">License</th>
                  <th scope="col">Usage ends</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <strong>{s.name || s.id}</strong>
                      {s.rightsNote ? <div className="caption">{s.rightsNote}</div> : null}
                    </td>
                    <td>{s.sourceOwner || <span className="muted">Missing</span>}</td>
                    <td>{s.license || <span className="muted">Missing</span>}</td>
                    <td className="tabular">{s.usageWindowEnd ? when(s.usageWindowEnd, false) : 'No end date'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <hr className="divider" />
        <form className="stack" onSubmit={create}>
          <h3>New question set</h3>
          <div className="grid-2">
            <Field label="Name">{(id) => <input id={id} className="input" value={form.name} onChange={set('name')} />}</Field>
            <Field label="Source owner" hint="Who owns the rights to these questions.">
              {(id) => <input id={id} className="input" value={form.sourceOwner} onChange={set('sourceOwner')} />}
            </Field>
            <Field label="License">{(id) => <input id={id} className="input" value={form.license} onChange={set('license')} />}</Field>
            <Field label="Usage window ends" hint="Leave empty if there is no end date.">
              {(id) => <input id={id} className="input" type="date" value={form.usageWindowEnd} onChange={set('usageWindowEnd')} />}
            </Field>
          </div>
          <Field label="Rights note">{(id) => <textarea id={id} className="textarea" value={form.rightsNote} onChange={set('rightsNote')} />}</Field>
          <ErrorNote error={error} />
          <div>
            <Button type="submit" variant="primary" loading={busy}>
              Create set
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  );
}

function matchesText(q, needle) {
  if (!needle) return true;
  const hay = [q.canonicalAnswer, q.promptLeadin, ...(q.clues || []).map((c) => c.text), ...(q.parts || []).flatMap((p) => [p.text, p.canonicalAnswer])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return hay.includes(needle);
}

export default function Content() {
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [setId, setSetId] = useState('');
  const [type, setType] = useState('');
  const [search, setSearch] = useState('');
  const [setsOpen, setSetsOpen] = useState(false);
  const sets = useQuestionSets();
  const setName = useMemo(() => Object.fromEntries(sets.data.map((s) => [s.id, s.name || s.id])), [sets.data]);
  const counts = useStatusCounts(0);

  const paged = usePaged(() => {
    const cons = [];
    if (status) cons.push(where('status', '==', status));
    if (category) cons.push(where('category', '==', category));
    if (setId) cons.push(where('setId', '==', setId));
    if (type) cons.push(where('type', '==', type));
    return query(collection(db, 'questions'), ...cons, orderBy('updatedAt', 'desc'));
  }, [status, category, setId, type]);

  const needle = search.trim().toLowerCase();
  const rows = paged.rows.filter((q) => matchesText(q, needle));
  const total = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : null;

  return (
    <div className="page stack-xl">
      <PageHeader
        eyebrow="Content"
        title="Question bank"
        actions={
          <>
            <ButtonLink to="/admin/content/new?type=tossup" variant="primary">
              New tossup
            </ButtonLink>
            <ButtonLink to="/admin/content/new?type=bonus">New bonus</ButtonLink>
            <ButtonLink to="/admin/content/import">Import</ButtonLink>
            <Button onClick={() => setSetsOpen(true)}>Manage question sets</Button>
          </>
        }
      />

      <div className="adm-counts" role="group" aria-label="Filter by status">
        <button type="button" className="adm-count-btn" aria-pressed={status === ''} onClick={() => setStatus('')}>
          All <span className="tabular">{total ?? '…'}</span>
        </button>
        {STATUSES.map((s) => (
          <button key={s} type="button" className="adm-count-btn" aria-pressed={status === s} onClick={() => setStatus(s)}>
            {Q_STATUS_LABEL[s] || s} <span className="tabular">{counts ? counts[s] ?? 0 : '…'}</span>
          </button>
        ))}
      </div>

      <Card className="adm-filters" as="div">
        <Field label="Category">
          {(id) => (
            <select id={id} className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All categories</option>
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.emoji} {c.id}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Question set">
          {(id) => (
            <select id={id} className="select" value={setId} onChange={(e) => setSetId(e.target.value)}>
              <option value="">All sets</option>
              {sets.data.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name || s.id}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Type">
          {(id) => (
            <select id={id} className="select" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">Tossups and bonuses</option>
              <option value="tossup">Tossups</option>
              <option value="bonus">Bonuses</option>
            </select>
          )}
        </Field>
        <Field label="Search" hint="Answers and clue text in the loaded rows.">
          {(id) => <input id={id} className="input" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e.g. photosynthesis" />}
        </Field>
      </Card>

      <ErrorNote error={paged.error} />
      {paged.loading ? (
        <Loading label="Loading questions…" />
      ) : !rows.length ? (
        <EmptyState emoji="📝" title={paged.rows.length ? 'No loaded questions match that search' : 'No questions match these filters'}>
          {paged.rows.length && paged.hasMore ? 'Load more rows below or clear the search.' : 'Try other filters or create a new question.'}
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Answer or lead-in</th>
                <th scope="col">Type</th>
                <th scope="col">Category</th>
                <th scope="col">Set</th>
                <th scope="col">Status</th>
                <th scope="col" className="num">Diff.</th>
                <th scope="col" className="num">Ver.</th>
                <th scope="col">Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((q) => (
                <tr key={q.id}>
                  <td className="adm-cell-main">
                    <Link to={`/admin/content/${q.id}`}>{(q.type === 'bonus' ? q.promptLeadin : q.canonicalAnswer) || 'Untitled question'}</Link>
                    {q.subcategory ? <div className="caption">{q.subcategory}</div> : null}
                  </td>
                  <td>{q.type === 'bonus' ? 'Bonus' : 'Tossup'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <span aria-hidden>{categoryMeta(q.category).emoji} </span>
                    {q.category}
                  </td>
                  <td>{q.setId ? setName[q.setId] || q.setId : <span className="muted">No set</span>}</td>
                  <td>
                    <QStatusChip status={q.status} />
                  </td>
                  <td className="num">{q.difficulty ?? ''}</td>
                  <td className="num">{q.version ?? 1}</td>
                  <td className="tabular" style={{ whiteSpace: 'nowrap' }}>{when(q.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <LoadMore paged={paged} />

      <SetsModal open={setsOpen} onClose={() => setSetsOpen(false)} sets={sets} />
    </div>
  );
}
