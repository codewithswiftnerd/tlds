const { init, HttpError, loadMeeting, roomService, route } = require("./_lib");

// Join pass for the media room. Checks: signed in, active account, meeting live, not removed, room not full.
exports.handler = route(async ({ uid, body }) => {
  const meeting = await loadMeeting(body.meetingId);
  const userSnap = await init().firestore().collection("users").doc(uid).get();
  const project = init().app().options.credential?.projectId || process.env.GCLOUD_PROJECT || "unknown";
  if (!userSnap.exists) {
    console.error("No users/%s document in project %s", uid, project);
    throw new HttpError(403, "functions/permission-denied", `Could not find your member profile (call service is reading project "${project}"). Check FIREBASE_SERVICE_ACCOUNT belongs to the same Firebase project as the app.`);
  }
  if (userSnap.data().disabled === true) throw new HttpError(403, "functions/permission-denied", "Your account has been deactivated by an administrator.");
  if (meeting.status !== "live") throw new HttpError(412, "functions/failed-precondition", "This meeting is not live.");
  if ((meeting.removedUids || []).includes(uid)) throw new HttpError(403, "functions/permission-denied", "You were removed from this meeting.");

  const max = parseInt(process.env.MAX_PARTICIPANTS || "150", 10);
  try {
    const people = await roomService().listParticipants(body.meetingId);
    if (people.length >= max && !people.some((p) => p.identity === uid)) throw new HttpError(429, "functions/resource-exhausted", "This meeting is full.");
  } catch (e) { if (e instanceof HttpError) throw e; /* room not created yet: fine */ }

  const { AccessToken } = require("livekit-server-sdk");
  const at = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, { identity: uid, name: userSnap.data().name || "Member", ttl: "6h" });
  at.addGrant({ roomJoin: true, room: body.meetingId, canPublish: true, canSubscribe: true, canPublishData: false });
  return { token: await at.toJwt(), url: process.env.LIVEKIT_URL };
});
