// Shared admin building blocks: role gate, status chips, CSS bar chart, paged queries.
import { useCallback, useEffect, useRef, useState } from 'react';
import { collection, getDocs, limit, query, startAfter } from 'firebase/firestore';
import { db } from '../../firebase.js';
import { useQuery } from '../../hooks/useFirestore.js';
import { Chip, EmptyState } from '../ui.jsx';
import { useAuth } from '../../hooks/useAuth.jsx';
import { fmtDate, fmtDateTime, toMillis } from '../../lib/format.js';

export function PlatformOnly({ children }) {
  const { isPlatformAdmin } = useAuth();
  if (isPlatformAdmin) return children;
  return (
    <div className="page">
      <EmptyState emoji="🔒" title="Platform admins only">
        This page is for platform admins. Content tools are under Content and Flags.
      </EmptyState>
    </div>
  );
}

const Q_STATUS = {
  draft: { tone: 'gray', label: 'Draft' },
  review: { tone: 'sun', label: 'In review' },
  approved: { tone: 'teal', label: 'Approved' },
  published: { tone: 'green', label: 'Published' },
  retired: { tone: 'coral', label: 'Retired' }
};
export const Q_STATUS_LABEL = Object.fromEntries(Object.entries(Q_STATUS).map(([k, v]) => [k, v.label]));

export function QStatusChip({ status }) {
  const s = Q_STATUS[status] || { tone: 'gray', label: status || 'Unknown' };
  return <Chip tone={s.tone}>{s.label}</Chip>;
}

const REQ_STATUS = {
  pending: { tone: 'sun', label: 'Pending' },
  approved: { tone: 'teal', label: 'Approved' },
  done: { tone: 'green', label: 'Done' },
  rejected: { tone: 'coral', label: 'Rejected' },
  error: { tone: 'coral', label: 'Error' },
  open: { tone: 'sun', label: 'Open' },
  resolved: { tone: 'green', label: 'Resolved' }
};
export function ReqStatusChip({ status }) {
  const s = REQ_STATUS[status] || { tone: 'gray', label: status || 'Unknown' };
  return <Chip tone={s.tone}>{s.label}</Chip>;
}

/** Date text with a readable fallback (never a dash). */
export function when(v, withTime = true, fallback = 'Not recorded') {
  if (!toMillis(v)) return fallback;
  return withTime ? fmtDateTime(v) : fmtDate(v, { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Vertical CSS bar chart. data: [{ key, label, value, display }]
 * Values of null render as an empty slot ("no data").
 */
export function BarChart({ data, color = 'var(--purple)', title, max: forcedMax }) {
  const values = data.map((d) => d.value).filter((v) => typeof v === 'number');
  const max = forcedMax || Math.max(1, ...values);
  const summary = data.map((d) => `${d.label}: ${d.value == null ? 'no data' : d.display ?? d.value}`).join(', ');
  return (
    <div className="adm-bars" role="img" aria-label={`${title}. ${summary}`}>
      {data.map((d) => (
        <div key={d.key || d.label} className="adm-bar-col">
          <span className="adm-bar-val tabular">{d.value == null ? '' : d.display ?? d.value}</span>
          <div className="adm-bar-track">
            {d.value == null ? (
              <span className="adm-bar-none">no data</span>
            ) : (
              <div className="adm-bar-fill" style={{ height: `${Math.max(2, (d.value / max) * 100)}%`, background: color }} />
            )}
          </div>
          <span className="adm-bar-label">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * One-shot paged query (getDocs). makeQuery returns a Query without limit, or null.
 * Returns { rows, loading, loadingMore, error, hasMore, loadMore, reload, setRows }.
 */
export function usePaged(makeQuery, deps, size = 50) {
  const [state, setState] = useState({ rows: [], loading: true, loadingMore: false, error: null, hasMore: false });
  const last = useRef(null);
  const token = useRef(0);
  const base = useRef(null);

  const run = useCallback(
    async (append) => {
      const q = base.current;
      const my = ++token.current;
      if (!q) {
        setState({ rows: [], loading: false, loadingMore: false, error: null, hasMore: false });
        return;
      }
      setState((s) => ({ ...s, loading: !append, loadingMore: !!append, error: null }));
      try {
        const parts = append && last.current ? [startAfter(last.current), limit(size)] : [limit(size)];
        const snap = await getDocs(query(q, ...parts));
        if (my !== token.current) return;
        last.current = snap.docs[snap.docs.length - 1] || last.current;
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setState((s) => ({
          rows: append ? [...s.rows, ...rows] : rows,
          loading: false,
          loadingMore: false,
          error: null,
          hasMore: snap.docs.length === size
        }));
      } catch (error) {
        if (my !== token.current) return;
        setState((s) => ({ ...s, loading: false, loadingMore: false, error }));
      }
    },
    [size]
  );

  useEffect(() => {
    base.current = makeQuery();
    last.current = null;
    run(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const setRows = useCallback((fn) => setState((s) => ({ ...s, rows: typeof fn === 'function' ? fn(s.rows) : fn })), []);
  return { ...state, loadMore: () => run(true), reload: () => { last.current = null; run(false); }, setRows };
}

export function LoadMore({ paged, label = 'Load 50 more' }) {
  if (!paged.hasMore) return null;
  return (
    <div className="row" style={{ justifyContent: 'center' }}>
      <button type="button" className="btn" onClick={paged.loadMore} disabled={paged.loadingMore} aria-busy={paged.loadingMore || undefined}>
        {paged.loadingMore ? 'Loading…' : label}
      </button>
    </div>
  );
}

/** Live list of question sets (small collection). */
export function useQuestionSets() {
  return useQuery(() => collection(db, 'questionSets'), []);
}
