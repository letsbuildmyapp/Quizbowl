// Audit log (server-written). Date range is a server query; action prefix filters the loaded rows.
// Reads:  auditEvents (at in [from, to], orderBy at desc, pages of 50)
// Writes: none
import { useState } from 'react';
import { collection, orderBy, query, where } from 'firebase/firestore';
import { db } from '../../firebase.js';
import { Button, Card, EmptyState, ErrorNote, Field, Loading, PageHeader } from '../../components/ui.jsx';
import { LoadMore, PlatformOnly, usePaged, when } from '../../components/admin/common.jsx';
import './admin.css';

function compact(v) {
  if (v == null) return '';
  try {
    const s = JSON.stringify(v);
    return s.length > 240 ? `${s.slice(0, 240)}…` : s;
  } catch {
    return String(v);
  }
}

function target(t) {
  if (t == null) return '';
  return typeof t === 'object' ? compact(t) : String(t);
}

function AuditInner() {
  const [prefix, setPrefix] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const paged = usePaged(() => {
    const cons = [];
    if (from) cons.push(where('at', '>=', new Date(`${from}T00:00:00`).getTime()));
    if (to) cons.push(where('at', '<=', new Date(`${to}T23:59:59.999`).getTime()));
    return query(collection(db, 'auditEvents'), ...cons, orderBy('at', 'desc'));
  }, [from, to]);

  const p = prefix.trim().toLowerCase();
  const rows = p ? paged.rows.filter((r) => (r.action || '').toLowerCase().startsWith(p)) : paged.rows;

  return (
    <div className="page stack-xl">
      <PageHeader eyebrow="Platform" title="Audit log" subtitle="Every privileged action, newest first." />
      <Card className="adm-filters" as="div">
        <Field label="Action starts with" hint="Filters the rows loaded below.">
          {(id) => <input id={id} className="input" value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="e.g. privacy." spellCheck={false} />}
        </Field>
        <Field label="From">{(id) => <input id={id} className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}</Field>
        <Field label="To">{(id) => <input id={id} className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />}</Field>
        <div>
          <Button onClick={() => { setPrefix(''); setFrom(''); setTo(''); }} disabled={!prefix && !from && !to}>
            Clear filters
          </Button>
        </div>
      </Card>

      <ErrorNote error={paged.error} />
      {paged.loading ? (
        <Loading label="Loading events…" />
      ) : !rows.length ? (
        <EmptyState emoji="🧾" title={paged.rows.length ? 'No loaded events match that action' : 'No events in this range'}>
          {paged.rows.length && paged.hasMore ? 'Load more events below to search further back.' : null}
        </EmptyState>
      ) : (
        <>
          {p ? (
            <p className="caption tabular">
              {rows.length} of {paged.rows.length} loaded events match.
            </p>
          ) : null}
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Actor role</th>
                  <th scope="col">Action</th>
                  <th scope="col">Target</th>
                  <th scope="col">Details</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td className="tabular" style={{ whiteSpace: 'nowrap' }}>{when(e.at)}</td>
                    <td>{e.actorRole || 'system'}</td>
                    <td className="adm-mono" style={{ fontWeight: 800 }}>{e.action}</td>
                    <td className="adm-mono">{target(e.target)}</td>
                    <td>
                      <pre className="adm-json">{compact(e.details)}</pre>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <LoadMore paged={paged} />
    </div>
  );
}

export default function Audit() {
  return (
    <PlatformOnly>
      <AuditInner />
    </PlatformOnly>
  );
}
