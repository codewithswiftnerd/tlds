/**
 * TLDS LIVE Cloud Functions (Node 20, 2nd gen). OPTIONAL: they need the Firebase Blaze plan.
 * The app works without them: in-app notifications come from the shared `feed` collection, which the app
 * writes itself. These functions only ADD:
 *  - phone/desktop push (FCM) for every new feed item and personal notification, even when the app is closed;
 *  - "starting in 15 minutes" reminders for scheduled meetings;
 *  - optional email (welcome + announcement blast) via SMTP (secrets SMTP_USER, SMTP_PASS).
 * Calls (LiveKit) run on Netlify Functions, see netlify/functions.
 */
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");
const nodemailer = require("nodemailer");

initializeApp();
const db = getFirestore();

const SMTP_USER = defineSecret("SMTP_USER");
const SMTP_PASS = defineSecret("SMTP_PASS");
const clip = (s, n = 140) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s || "");
const DEAD_TOKEN = new Set(["messaging/registration-token-not-registered", "messaging/invalid-registration-token", "messaging/invalid-argument"]);

/** Sends one push to a set of users (respecting their preferences) and removes tokens that no longer work. */
async function push(users, { type, title, body, link, tag }) {
  const owners = new Map();
  users
    .filter((u) => u.exists && u.data().disabled !== true && (u.data().notifPrefs || {})[type] !== false)
    .forEach((u) => (u.data().fcmTokens || []).forEach((t) => owners.set(t, u.ref)));
  const tokens = [...owners.keys()];
  for (let i = 0; i < tokens.length; i += 500) {
    const batch = tokens.slice(i, i + 500);
    try {
      const res = await getMessaging().sendEachForMulticast({
        tokens: batch,
        notification: { title: clip(title, 120), body: clip(body, 240) },
        webpush: {
          notification: { icon: "/images/favicon-192.png", badge: "/images/favicon-48.png", tag: tag || undefined },
          fcmOptions: { link: link || "/" },
        },
      });
      await Promise.all(res.responses.map((r, j) => (!r.success && DEAD_TOKEN.has(r.error && r.error.code)
        ? owners.get(batch[j]).update({ fcmTokens: FieldValue.arrayRemove(batch[j]) }).catch(() => {})
        : null)));
    } catch (e) { console.error("FCM send failed", e.message); }
  }
}

async function pushFeedItem(id, f) {
  const users = (await db.collection("users").get()).docs.filter((u) => u.id !== f.createdBy);
  await push(users, { type: f.type, title: f.title, body: f.body, link: f.link, tag: id });
}

// Every new community feed item -> push. Scheduled announcements wait for their time (see feedScheduler).
exports.onFeedCreated = onDocumentCreated("feed/{id}", async (event) => {
  const f = event.data && event.data.data();
  if (!f) return;
  const at = f.visibleAt && f.visibleAt.toMillis ? f.visibleAt.toMillis() : Date.now();
  if (at > Date.now() + 60 * 1000) { await event.data.ref.update({ pushPending: true }); return; }
  await pushFeedItem(event.params.id, f);
});

// Personal notifications (e.g. "your testimony was published") -> push to that one member.
exports.onNotificationCreated = onDocumentCreated("notifications/{id}", async (event) => {
  const n = event.data && event.data.data();
  if (!n || !n.userId) return;
  await push([await db.collection("users").doc(n.userId).get()], { type: n.type || "admin", title: n.title, body: n.body, link: n.link, tag: event.params.id });
});

// Every 5 minutes: push scheduled feed items whose time has come, and post 15-minute meeting reminders.
exports.feedScheduler = onSchedule("every 5 minutes", async () => {
  const now = Date.now();
  const due = await db.collection("feed").where("pushPending", "==", true).where("visibleAt", "<=", Timestamp.fromMillis(now)).get();
  for (const d of due.docs) {
    await d.ref.update({ pushPending: false });
    await pushFeedItem(d.id, d.data());
  }

  const soon = await db.collection("meetings").where("status", "==", "scheduled")
    .where("scheduledFor", ">=", Timestamp.fromMillis(now))
    .where("scheduledFor", "<=", Timestamp.fromMillis(now + 15 * 60 * 1000)).get();
  for (const d of soon.docs) {
    if (d.data().reminderSent) continue;
    await d.ref.update({ reminderSent: true });
    await db.collection("feed").add({
      type: "meetings", title: `Starting soon: ${d.data().title}`, body: "Begins in about 15 minutes.",
      link: `/meetings/${d.id}`, refId: d.id, createdBy: "system", createdByName: "TLDS LIVE",
      createdAt: FieldValue.serverTimestamp(), visibleAt: Timestamp.now(),
    });
  }
});

// ── Email (optional) ──────────────────────────────────────────
async function sendEmail(to, subject, text) {
  const user = SMTP_USER.value(), pass = SMTP_PASS.value();
  if (!user || !pass) return;
  const t = nodemailer.createTransport({ host: "smtp.gmail.com", port: 587, secure: false, auth: { user, pass } });
  await t.sendMail({ from: user, to, subject, text });
}

exports.sendWelcomeEmail = onDocumentCreated({ document: "users/{uid}", secrets: [SMTP_USER, SMTP_PASS] }, async (event) => {
  const d = event.data && event.data.data();
  if (!d || !d.email) return;
  await sendEmail(d.email, "Welcome to TLDS LIVE",
    `Hi ${d.firstName || "there"},\n\nWelcome to the Tree of Life Discipleship School members portal. ` +
    "You can now join live meetings, listen to recordings and connect with the community.\n\nGod bless you.\nTLDS LIVE");
});

exports.emailAnnouncement = onCall({ secrets: [SMTP_USER, SMTP_PASS] }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Sign-in required.");
  const caller = await db.collection("users").doc(req.auth.uid).get();
  if (!caller.exists || caller.data().role !== "admin") throw new HttpsError("permission-denied", "Only admins can send announcement emails.");
  const { title, body } = req.data || {};
  if (!title || !body) throw new HttpsError("invalid-argument", "title and body are required.");
  let sent = 0;
  for (const u of (await db.collection("users").get()).docs) {
    if (u.data().email && u.data().disabled !== true) { await sendEmail(u.data().email, `TLDS Announcement: ${title}`, body); sent++; }
  }
  return { sent };
});
