
class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

function init() {
  const admin = require("firebase-admin");
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
  }
  return admin;
}

/** Verifies the Firebase sign-in token sent by the app and returns the member's uid. */
async function authUid(event) {
  const h = event.headers.authorization || event.headers.Authorization || "";
  const m = h.match(/^Bearer (.+)$/);
  if (!m) throw new HttpError(401, "functions/unauthenticated", "Sign-in required.");
  try { return (await init().auth().verifyIdToken(m[1])).uid; }
  catch { throw new HttpError(401, "functions/unauthenticated", "Please sign in again."); }
}

async function loadMeeting(id) {
  if (typeof id !== "string" || !id) throw new HttpError(400, "functions/invalid-argument", "meetingId is required.");
  const snap = await init().firestore().collection("meetings").doc(id).get();
  if (!snap.exists) throw new HttpError(404, "functions/not-found", "Meeting not found.");
  return snap.data();
}

const roomService = () => {
  const { RoomServiceClient } = require("livekit-server-sdk");
  return new RoomServiceClient(process.env.LIVEKIT_URL.replace(/^wss:/, "https:").replace(/^ws:/, "http:"), process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
};

const reply = (status, body) => ({ statusCode: status, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** Wraps a handler: POST only, JSON body, errors turned into clean JSON responses. */
const route = (fn) => async (event) => {
  if (event.httpMethod !== "POST") return reply(405, { error: "POST only." });
  try {
    const uid = await authUid(event);
    const body = event.body ? JSON.parse(event.body) : {};
    return reply(200, await fn({ uid, body }));
  } catch (e) {
    if (e instanceof HttpError) return reply(e.status, { error: e.message, code: e.code });
    console.error(e);
    return reply(500, { error: `Call service error: ${String(e.message || e).slice(0, 160)}`, code: "functions/internal" });
  }
};

module.exports = { init, HttpError, loadMeeting, roomService, route };
