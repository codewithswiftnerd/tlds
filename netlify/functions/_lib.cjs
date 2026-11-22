// Zero-dependency helpers: nothing to install or bundle, so nothing can crash on startup.
// Identity: the app sends the member's Firebase sign-in token. We use that SAME token to read Firestore over
// its REST API, so the database security rules apply to the caller exactly as they do in the browser.
const crypto = require("crypto");

class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const reply = (status, body) => ({ statusCode: status, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const b64u = (x) => Buffer.from(x).toString("base64url");

// ── LiveKit tokens (HS256 JWT) and server API ─────────────────
function livekitEnv() {
  const { LIVEKIT_URL: url, LIVEKIT_API_KEY: key, LIVEKIT_API_SECRET: secret } = process.env;
  if (!url || !key || !secret) throw new HttpError(500, "functions/internal", "LiveKit settings are missing in Netlify (LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET).");
  return { url, key, secret };
}
function lkToken(video, { identity, name, ttl = 3600 }) {
  const { key, secret } = livekitEnv();
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64u(JSON.stringify({ iss: key, sub: identity, name, nbf: now - 5, exp: now + ttl, video }));
  const sig = crypto.createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}
async function lkApi(method, room, payload) {
  const { url } = livekitEnv();
  const token = lkToken({ roomAdmin: true, roomCreate: true, roomList: true, room }, { identity: "tlds-server", name: "server", ttl: 60 });
  const res = await fetch(`${url.replace(/^wss:/, "https:").replace(/^ws:/, "http:")}/twirp/livekit.RoomService/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ room, ...payload }),
  });
  if (!res.ok) throw new Error(`LiveKit ${method} failed (${res.status})`);
  return res.json().catch(() => ({}));
}

// ── Firestore over REST, as the signed-in member ──────────────
function decode(v) {
  if ("stringValue" in v) return v.stringValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("nullValue" in v) return null;
  if ("timestampValue" in v) return v.timestampValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(decode);
  if ("mapValue" in v) return decodeFields(v.mapValue.fields || {});
  return undefined;
}
const decodeFields = (f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, decode(v)]));

async function getDoc(ctx, path) {
  const res = await fetch(`https://firestore.googleapis.com/v1/projects/${ctx.project}/databases/(default)/documents/${path}`, { headers: { Authorization: `Bearer ${ctx.token}` } });
  if (res.status === 404) return null;
  if (res.status === 401) throw new HttpError(401, "functions/unauthenticated", "Please sign in again.");
  if (res.status === 403) throw new HttpError(403, "functions/permission-denied", "The database refused this request. Publish the latest firestore.rules in Firebase.");
  if (!res.ok) throw new HttpError(502, "functions/internal", `Database error (${res.status}).`);
  return decodeFields((await res.json()).fields || {});
}

async function loadMeeting(ctx, id) {
  if (typeof id !== "string" || !id || id.includes("/")) throw new HttpError(400, "functions/invalid-argument", "meetingId is required.");
  const m = await getDoc(ctx, `meetings/${encodeURIComponent(id)}`);
  if (!m) throw new HttpError(404, "functions/not-found", "Meeting not found.");
  return m;
}

/** Wraps a handler: POST only, reads the member's token, turns every failure into a readable JSON reply. */
const route = (fn) => async (event) => {
  if (event.httpMethod !== "POST") return reply(405, { error: "POST only." });
  try {
    const m = (event.headers.authorization || event.headers.Authorization || "").match(/^Bearer (.+)$/);
    if (!m) throw new HttpError(401, "functions/unauthenticated", "Sign-in required.");
    let c;
    try { c = JSON.parse(Buffer.from(m[1].split(".")[1], "base64url").toString()); } catch { throw new HttpError(401, "functions/unauthenticated", "Please sign in again."); }
    const uid = c.user_id || c.sub, project = c.aud;
    if (!uid || !project || c.iss !== `https://securetoken.google.com/${project}` || c.exp * 1000 < Date.now()) throw new HttpError(401, "functions/unauthenticated", "Please sign in again.");
    const ctx = { token: m[1], project, uid };
    // Reading your own profile only succeeds for a genuine, unexpired token of that user. This is the identity check.
    const me = await getDoc(ctx, `users/${encodeURIComponent(uid)}`);
    if (!me) throw new HttpError(403, "functions/permission-denied", `Could not find your member profile (project "${project}").`);
    if (me.disabled === true) throw new HttpError(403, "functions/permission-denied", "Your account has been deactivated by an administrator.");
    const body = event.body ? JSON.parse(event.body) : {};
    return reply(200, await fn({ ctx, uid, me, body }));
  } catch (e) {
    if (e instanceof HttpError) return reply(e.status, { error: e.message, code: e.code });
    console.error(e);
    return reply(500, { error: `Call service error: ${String(e.message || e).slice(0, 160)}`, code: "functions/internal" });
  }
};

module.exports = { HttpError, loadMeeting, lkToken, lkApi, livekitEnv, route };
