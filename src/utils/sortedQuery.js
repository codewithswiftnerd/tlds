import { toDate } from './format';

const ms = (v) => toDate(v)?.getTime() ?? null;

/**
 * Sorts (and optionally trims) a query's results in the app instead of in Firestore.
 * A query with where(...) + orderBy(...) on different fields needs a composite index in Firebase;
 * doing the ordering here means the app works without any index being created.
 * Use with useQuery: useQuery(() => sortedQuery(q, 'createdAt', 'desc', 10), []).
 */
export function sortedQuery(query, field, dir = 'desc', n = 0) {
  return {
    query,
    post: (list) => {
      const now = Date.now(); // items still being saved have no server time yet: treat them as "now"
      const s = [...list].sort((a, b) => {
        const x = ms(a[field]) ?? now; const y = ms(b[field]) ?? now;
        return dir === 'asc' ? x - y : y - x;
      });
      return n ? s.slice(0, n) : s;
    },
  };
}
