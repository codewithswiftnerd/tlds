import { addDoc, collection, limit, orderBy, query, serverTimestamp, Timestamp } from 'firebase/firestore';
import { db } from './firebase';

/**
 * Community activity feed: one document per event (new announcement, meeting live, new recording...).
 * Every member reads the same feed, and "unread" is simply "newer than notifSeenAt" on their profile.
 * This needs no server, so notifications work on the free Firebase plan. With Cloud Functions deployed
 * (Blaze), functions/index.js additionally sends a phone push for each new feed item.
 */
export const feedQuery = (n = 60) => query(collection(db, 'feed'), orderBy('visibleAt', 'desc'), limit(n));

const clip = (s, n) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s || '');

export function writeFeed(profile, { type, title, body = '', link = '/', refId = '', visibleAt = null }) {
  return addDoc(collection(db, 'feed'), {
    type, title: clip(title, 200), body: clip(body, 400), link, refId,
    createdBy: profile.uid, createdByName: profile.name || '',
    createdAt: serverTimestamp(),
    visibleAt: visibleAt ? Timestamp.fromDate(visibleAt) : Timestamp.now(),
  });
}
/** Best effort: a failed feed write must never break the action that caused it. */
export const postFeed = (profile, item) => writeFeed(profile, item).catch((e) => { console.warn('feed write failed', e?.code || e); });
