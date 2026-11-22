import { addDoc, arrayUnion, collection, doc, query, serverTimestamp, updateDoc, where, writeBatch } from 'firebase/firestore';
import { sortedQuery } from '../utils/sortedQuery';
import { getToken, getMessaging, isSupported, onMessage } from 'firebase/messaging';
import { db, firebaseConfig, app } from './firebase';
import { writeFeed } from './feed';

/** Personal notifications (e.g. "your testimony was published"). Community news lives in the feed (services/feed.js). */
export const notificationsQuery = (uid, n = 40) =>
  sortedQuery(query(collection(db, 'notifications'), where('userId', '==', uid)), 'createdAt', 'desc', n);

export const markRead = (id) => updateDoc(doc(db, 'notifications', id), { read: true });
export async function markAllRead(items) {
  const unread = items.filter((n) => n.personal && !n.read);
  if (!unread.length) return;
  const batch = writeBatch(db);
  unread.forEach((n) => batch.update(doc(db, 'notifications', n.id), { read: true }));
  await batch.commit();
}
/** Everything in the community feed up to now counts as seen. */
export const markFeedSeen = (uid) => updateDoc(doc(db, 'users', uid), { notifSeenAt: serverTimestamp() });
export const savePrefs = (uid, notifPrefs) => updateDoc(doc(db, 'users', uid), { notifPrefs });

/** Admin only (rules): a notification for one member. */
export const notifyMember = (userId, { type, title, body = '', link = '/' }) =>
  addDoc(collection(db, 'notifications'), { userId, type, title, body, link, read: false, createdAt: serverTimestamp() });

/** Admin message to every member (in-app for everyone; phone push too when Cloud Functions are deployed). */
export const broadcast = (profile, title, body) => writeFeed(profile, { type: 'admin', title, body, link: '/notifications' });

export const NOTIF_TYPES = {
  announcements: 'New announcements',
  meetings: 'Meetings going live and new meetings',
  recordings: 'New recordings',
  testimonies: 'Testimonies',
  admin: 'Messages from administrators',
};

// ── Device alerts ─────────────────────────────────────────────
export const alertsSupported = () => typeof window !== 'undefined' && 'Notification' in window;
export const pushSupported = async () => alertsSupported() && 'serviceWorker' in navigator && (await isSupported().catch(() => false));
const pushConfigured = () => !!import.meta.env.VITE_FIREBASE_VAPID_KEY;

async function swRegistration() {
  const params = new URLSearchParams({
    apiKey: firebaseConfig.apiKey, projectId: firebaseConfig.projectId,
    messagingSenderId: firebaseConfig.messagingSenderId, appId: firebaseConfig.appId,
  });
  return navigator.serviceWorker.register(`/firebase-messaging-sw.js?${params}`);
}

async function getPushToken() {
  const reg = await swRegistration();
  return getToken(getMessaging(app), { vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY, serviceWorkerRegistration: reg });
}

/**
 * Only called from an explicit tap. Turns on alerts on this device: system notifications while the app is
 * open in the background, plus real push (even when closed) if push is configured and Cloud Functions are deployed.
 */
export async function enableAlerts(uid) {
  if (!alertsSupported()) throw new Error('This browser does not support notifications. On iPhone, add TLDS LIVE to your Home Screen first (Share → Add to Home Screen).');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications were not allowed. You can allow them in your browser\'s site settings.');
  if ('serviceWorker' in navigator) await swRegistration().catch(() => {}); // needed to show alerts on Android
  if (pushConfigured() && (await pushSupported())) {
    try { await updateDoc(doc(db, 'users', uid), { fcmTokens: arrayUnion(await getPushToken()) }); return 'push'; }
    catch (e) { console.warn('push token failed', e); }
  }
  return 'local';
}

/** If permission was already granted, refresh the push token and show foreground messages. Returns an unsubscribe. */
export async function startPush(uid, onForeground) {
  if (!alertsSupported() || Notification.permission !== 'granted') return () => {};
  if ('serviceWorker' in navigator) await swRegistration().catch(() => {});
  if (!pushConfigured() || !(await pushSupported())) return () => {};
  try {
    const token = await getPushToken();
    await updateDoc(doc(db, 'users', uid), { fcmTokens: arrayUnion(token) });
  } catch { /* non-fatal */ }
  return onMessage(getMessaging(app), (m) => onForeground?.(m.notification?.title || 'New notification'));
}

/** System notification while the app is open in a background tab. `tag` stops duplicates with real push. */
export async function showDeviceAlert({ title, body, link, tag }) {
  if (!alertsSupported() || Notification.permission !== 'granted') return;
  const opts = { body, tag, icon: '/images/favicon-192.png', badge: '/images/favicon-48.png', data: { link } };
  try {
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
    if (reg) { await reg.showNotification(title, opts); return; }
    const n = new Notification(title, opts);
    n.onclick = () => { window.focus(); if (link) window.location.assign(link); n.close(); };
  } catch { /* some mobile browsers only allow notifications from a service worker */ }
}
