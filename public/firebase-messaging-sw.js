// Service worker: phone push (Firebase Cloud Messaging) and taps on TLDS LIVE notifications.
// Firebase config is passed in the query string when the worker is registered (see src/services/notifications.js).
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');
const p = new URL(self.location).searchParams;
try {
  firebase.initializeApp({
    apiKey: p.get('apiKey'), projectId: p.get('projectId'),
    messagingSenderId: p.get('messagingSenderId'), appId: p.get('appId'),
  });
  firebase.messaging(); // push payloads with a "notification" block are displayed by the browser automatically
} catch (e) { /* push not configured: alerts shown by the app still work */ }

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// Alerts shown by the open app carry data.link; open (or focus) the app on that page.
self.addEventListener('notificationclick', (event) => {
  const link = event.notification.data && event.notification.data.link;
  if (!link || (event.notification.data && event.notification.data.FCM_MSG)) return;
  event.notification.close();
  const url = new URL(link, self.location.origin).href;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (new URL(c.url).origin === self.location.origin) { await c.focus(); if ('navigate' in c) c.navigate(url).catch(() => {}); return; }
    }
    await self.clients.openWindow(url);
  })());
});
