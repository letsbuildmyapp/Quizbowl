import { useEffect, useState } from 'react';
import { doc } from 'firebase/firestore';
import { db } from '../firebase.js';
import { listen } from '../lib/listen.js';

/** Live document. path: string like 'students/abc' or null to skip. */
export function useDoc(path) {
  const [state, setState] = useState({ data: null, loading: !!path, error: null, exists: false });
  useEffect(() => {
    if (!path) {
      setState({ data: null, loading: false, error: null, exists: false });
      return undefined;
    }
    setState((s) => ({ ...s, loading: true }));
    return listen(
      doc(db, path),
      (snap) => setState({ data: snap.exists() ? { id: snap.id, ...snap.data() } : null, exists: snap.exists(), loading: false, error: null }),
      (error) => setState({ data: null, exists: false, loading: false, error })
    );
  }, [path]);
  return state;
}

/**
 * Live query. makeQuery: () => Query | null. deps: re-subscribe when these change.
 */
export function useQuery(makeQuery, deps) {
  const [state, setState] = useState({ data: [], loading: true, error: null });
  useEffect(() => {
    const q = makeQuery();
    if (!q) {
      setState({ data: [], loading: false, error: null });
      return undefined;
    }
    setState((s) => ({ ...s, loading: true }));
    return listen(
      q,
      (snap) => setState({ data: snap.docs.map((d) => ({ id: d.id, ...d.data() })), loading: false, error: null }),
      (error) => setState({ data: [], loading: false, error })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}
