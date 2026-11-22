const { HttpError, loadMeeting, lkApi, route } = require("../lib/livekit.cjs");

const isMic = (t) => t && (t.source === "MICROPHONE" || t.source === 2);

/** Mutes a participant's microphone at the media server (works even if their app ignores the request). */
async function muteMic(meetingId, identity) {
  let info;
  try { info = await lkApi("GetParticipant", meetingId, { identity }); } catch { return 0; /* not connected */ }
  let n = 0;
  for (const t of info.tracks || []) {
    if (!isMic(t) || t.muted) continue;
    try { await lkApi("MutePublishedTrack", meetingId, { identity, track_sid: t.sid, muted: true }); n += 1; } catch { /* track gone */ }
  }
  return n;
}

// Server-side enforcement for host / moderator actions on the media room.
exports.handler = route(async ({ ctx, uid: caller, body }) => {
  const { meetingId, action, uid } = body;
  const meeting = await loadMeeting(ctx, meetingId);
  const isHost = meeting.hostId === caller;
  const isMod = (meeting.moderatorUids || []).includes(caller);
  const protectedUids = new Set([meeting.hostId, ...(meeting.moderatorUids || [])]);

  if (action === "remove") {
    // Firestore rules already limit who can add to removedUids; require it before cutting the connection.
    if (!(isHost || isMod) || !uid || uid === meeting.hostId || !(meeting.removedUids || []).includes(uid)) throw new HttpError(403, "functions/permission-denied", "Not allowed.");
    try { await lkApi("RemoveParticipant", meetingId, { identity: uid }); } catch { /* already gone */ }
    return { ok: true };
  }
  if (action === "mute") {
    if (!(isHost || isMod) || !uid || protectedUids.has(uid)) throw new HttpError(403, "functions/permission-denied", "Not allowed.");
    return { ok: true, muted: await muteMic(meetingId, uid) };
  }
  if (action === "muteAll") {
    if (!(isHost || isMod)) throw new HttpError(403, "functions/permission-denied", "Not allowed.");
    let people = [];
    try { ({ participants: people = [] } = await lkApi("ListParticipants", meetingId, {})); } catch { /* empty room */ }
    let muted = 0;
    for (const p of people) {
      if (protectedUids.has(p.identity)) continue;
      if (!(p.tracks || []).some((t) => isMic(t) && !t.muted)) continue;
      muted += await muteMic(meetingId, p.identity);
    }
    return { ok: true, muted };
  }
  if (action === "end") {
    if (!(isHost || isMod) || meeting.status !== "ended") throw new HttpError(403, "functions/permission-denied", "Not allowed.");
    try { await lkApi("DeleteRoom", meetingId, {}); } catch { /* already closed */ }
    return { ok: true };
  }
  throw new HttpError(400, "functions/invalid-argument", "Unknown action.");
});
