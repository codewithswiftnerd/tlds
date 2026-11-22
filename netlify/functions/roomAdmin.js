const { HttpError, loadMeeting, roomService, route } = require("./_lib");

// Server-side enforcement for host / moderator actions on the media room.
exports.handler = route(async ({ uid: caller, body }) => {
  const { meetingId, action, uid } = body;
  const meeting = await loadMeeting(meetingId);
  const isHost = meeting.hostId === caller;
  const isMod = (meeting.moderatorUids || []).includes(caller);
  if (action === "remove") {
    // Firestore rules already limit who can add to removedUids; require it before cutting the connection.
    if (!(isHost || isMod) || !uid || uid === meeting.hostId || !(meeting.removedUids || []).includes(uid)) throw new HttpError(403, "functions/permission-denied", "Not allowed.");
    try { await roomService().removeParticipant(meetingId, uid); } catch { /* already gone */ }
    return { ok: true };
  }
  if (action === "end") {
    if (!isHost || meeting.status !== "ended") throw new HttpError(403, "functions/permission-denied", "Not allowed.");
    try { await roomService().deleteRoom(meetingId); } catch { /* already closed */ }
    return { ok: true };
  }
  throw new HttpError(400, "functions/invalid-argument", "Unknown action.");
});
