# What changed in this update

## Before you deploy (required)
1. `firebase deploy --only firestore:rules,firestore:indexes,storage` (new rules for the feed, recording by
   moderators, host take-over, chat moderation and video posters).
2. `netlify deploy --build --prod` (the call functions changed: server-side mute and reactions).

## Recording
- Rebuilt recorder (`src/services/recorder.js`): audio-only or 720p video "speaker view" (screen share, active
  speaker camera or name card, with a title bar). Host or moderators can record.
- Saved to the device every 4 seconds (IndexedDB). A closed tab, crash or failed upload no longer loses the
  recording: a banner offers Upload / Save to device / Discard next time (`PendingRecordings.jsx`).
- WebM duration is written into the file so recordings are seekable (`webmDuration.js`).
- Upload no longer blocks leaving; it retries automatically and can fall back to "Save to device".
- Recording survives reconnects and host hand-over; REC badge only shows while the recorder is really present.
- Library: speed control, 15 s / 30 s skip, resume, lock-screen controls, share links, thumbnails, admin editing,
  "Show more" paging.

## Calls
- Automatic reconnect after a network drop; refresh rejoins without the "already in meeting" prompt.
- Host leaving hands over to a moderator; "Become host" when the host is gone; last host out ends the meeting.
- Server-side mute (single person and "mute everyone"), toasts when given or losing the floor.
- Reactions, device settings (mic/camera/speaker), flip camera, data saver, weak-network badge,
  screen share with tab audio, chat moderation and clickable links, downloadable notes, lower-hand,
  participant search, mobile-friendly control bar and menus.
- Fixed: a Leave pressed during a reconnect could be undone; modals stole focus on every re-render.

## Notifications
- Work on the free plan now: shared `feed` collection written by the app + `notifSeenAt` per member.
- Device alerts while the app is open; real push when Cloud Functions are deployed (functions rewritten to
  push-only, with dead-token cleanup and 15-minute reminders posted to the feed).

## Meetings, sign-in, app
- Weekly series, edit, cancel one or the rest of a series, copy link, Add to calendar (.ics), "In 10 min" labels,
  End button for host/admin, "who's already here" in the lobby, remembered mic/camera choice.
- Shared links survive sign-in/registration; missing profiles repair themselves instead of spinning forever;
  deactivated members see why they were signed out.
- Installable app (manifest + install prompt), Firestore on-device cache for faster loads on weak networks.
