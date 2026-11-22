import { useEffect, useMemo, useState } from 'react';
import { useQuery } from './useQuery';
import { feedQuery } from '../services/feed';
import { notificationsQuery } from '../services/notifications';
import { toDate } from '../utils/format';

const ms = (ts) => toDate(ts)?.getTime() || 0;

/**
 * Community feed + personal notifications for one member, newest first, with the member's preferences applied.
 * An item is unread when it is newer than profile.notifSeenAt (feed) or not marked read (personal).
 */
export function useNotifications(profile) {
  const feed = useQuery(() => feedQuery(60), []);
  const personal = useQuery(() => notificationsQuery(profile.uid), [profile.uid]);
  const [now, setNow] = useState(Date.now());
  // Scheduled announcements appear when their time comes.
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(i); }, []);

  const prefs = profile.notifPrefs || {};
  const seenAt = ms(profile.notifSeenAt) || ms(profile.createdAt) || 0;

  const items = useMemo(() => {
    const f = feed.data
      .filter((n) => n.createdBy !== profile.uid && prefs[n.type] !== false && ms(n.visibleAt) <= now)
      .map((n) => ({ ...n, personal: false, at: ms(n.visibleAt), read: ms(n.visibleAt) <= seenAt }));
    const p = personal.data
      .filter((n) => prefs[n.type] !== false || n.type === 'testimonies')
      .map((n) => ({ ...n, personal: true, at: ms(n.createdAt) || now }));
    return [...f, ...p].sort((a, b) => b.at - a.at);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed.data, personal.data, seenAt, now, profile.uid, JSON.stringify(prefs)]);

  return {
    items,
    unread: items.filter((n) => !n.read).length,
    seenAt,
    loading: feed.loading || personal.loading,
    error: feed.error || personal.error,
  };
}
