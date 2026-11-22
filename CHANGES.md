## Fixes: loading errors, vanishing announcements, stuck uploads, login photo

- **No more database indexes needed.** Meetings, testimonies and notifications are now sorted in the app
  instead of by Firestore, so these lists load even if the composite indexes were never created.
- **Error boxes say what went wrong.** "Could not load this section" now gives the reason, such as permission
  denied (rules not published), a missing index, or no connection, plus a **Try again** button.
- **Saving never spins forever.** Announcements and meetings show a clear error with the reason if the save is
  refused or the server doesn't answer within 45 seconds. Error messages stay on screen for 10 seconds.
- **Uploads no longer sit at 0%.** The Firebase SDK used to retry silently for up to 10 minutes, four times
  over. Now, if no data moves for 1 minute, the upload stops and says why (usually Storage not set up, or a
  wrong bucket name). The recording stays safe on the device.
- **Login page photo.** `public/images/login-hero.jpg` sits behind the green panel with a dark green overlay.
- **Removed old duplicate Netlify functions** (`_lib.js`, `getRoomToken.js`, `roomAdmin.js`, `_lib.cjs`).
  They were the CommonJS copies that broke the deploy. The live functions are `getRoomToken.cjs` and
  `roomAdmin.cjs` (using `netlify/lib/livekit.cjs`). The local `.netlify/` build folder is now git-ignored.
- See **FIREBASE-SETUP.md**: the Firestore and Storage rules must be published in the Firebase console.

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
