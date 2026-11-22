const { HttpError, loadMeeting, lkToken, lkApi, livekitEnv, route } = require("../lib/livekit.cjs");

// Join pass for the media room. Checks: signed in, active account, meeting live, not removed, room not full.
exports.handler = route(async ({ ctx, uid, me, body }) => {
  const meeting = await loadMeeting(ctx, body.meetingId);
  if (meeting.status !== "live") throw new HttpError(412, "functions/failed-precondition", "This meeting is not live.");
  if ((meeting.removedUids || []).includes(uid)) throw new HttpError(403, "functions/permission-denied", "You were removed from this meeting.");

  const max = parseInt(process.env.MAX_PARTICIPANTS || "150", 10);
  try {
    const { participants = [] } = await lkApi("ListParticipants", body.meetingId, {});
    if (participants.length >= max && !participants.some((p) => p.identity === uid)) throw new HttpError(429, "functions/resource-exhausted", "This meeting is full.");
  } catch (e) { if (e instanceof HttpError) throw e; /* room not created yet: fine */ }

  const { url } = livekitEnv();
  const token = lkToken({ roomJoin: true, room: body.meetingId, canPublish: true, canSubscribe: true, canPublishData: true, canUpdateOwnMetadata: false }, { identity: uid, name: me.name || "Member", ttl: 6 * 3600 });
  return { token, url };
});
