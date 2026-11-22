import { useCallback, useEffect, useState } from 'react';
import { onSnapshot } from 'firebase/firestore';

/**
 * Live Firestore query. `build` returns a query, a sortedQuery(...) descriptor, or null to skip.
 * Listener is released on unmount. `retry()` re-subscribes after an error.
 */
export function useQuery(build, deps = []) {
  const [state, setState] = useState({ data: [], loading: true, error: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const built = build();
    const q = built && typeof built.post === 'function' ? built.query : built;
    const post = built && typeof built.post === 'function' ? built.post : (x) => x;
    if (!q) { setState({ data: [], loading: false, error: null }); return undefined; }
    setState((s) => ({ ...s, loading: true }));
    return onSnapshot(
      q,
      (snap) => setState({
        data: post(snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }))),
        loading: false, error: null,
      }),
      (error) => { console.error('Firestore query failed:', error?.code, error?.message); setState({ data: [], loading: false, error }); },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, retry };
}
