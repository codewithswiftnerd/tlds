import { useEffect, useState } from 'react';
import { onSnapshot } from 'firebase/firestore';

/** Live Firestore query. `build` returns a query (or null to skip). Listener is released on unmount. */
export function useQuery(build, deps = []) {
  const [state, setState] = useState({ data: [], loading: true, error: null });
  useEffect(() => {
    const q = build();
    if (!q) { setState({ data: [], loading: false, error: null }); return undefined; }
    setState((s) => ({ ...s, loading: true }));
    return onSnapshot(
      q,
      (snap) => setState({ data: snap.docs.map((d) => ({ id: d.id, ...d.data() })), loading: false, error: null }),
      (error) => { console.error(error); setState({ data: [], loading: false, error }); },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}
