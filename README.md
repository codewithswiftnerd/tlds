# TLDS LIVE (React)

Vite + React + Firebase (Auth, Firestore, Storage) with LiveKit audio/video meetings, hosted on Netlify.
It uses the same Firebase project as the old app (`.env`), so existing accounts and data keep working.

## Run
```
npm install
npm run dev          # local
npm run build        # production build -> dist/
```

## Deploy (free Firebase plan)
Calls run on **Netlify Functions** (`netlify/functions/`); Firebase keeps login, data, files and rules.

1. LiveKit: create a project at cloud.livekit.io, then Settings -> Keys. Note the wss:// URL, API key and API secret.
2. **Publish the rules and indexes (required after this update):**
   `firebase deploy --only firestore:rules,firestore:indexes,storage`
3. Netlify: `npm i -g netlify-cli`, `netlify login`, `netlify init`. In the Netlify dashboard,
   Site configuration -> Environment variables, add: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`,
   `MAX_PARTICIPANTS` (150).
4. Publish: `netlify deploy --build --prod`. Use the https link it prints on every device.
5. Existing testimonies: Admin -> Testimonies -> **Publish them all** (once).

Firebase Storage note: projects created after October 2024 need the Blaze plan for Storage. Older projects keep
their free bucket (5 GB). Audio recordings are about 30 MB per hour; video about 450 MB per hour.

## What works on the free plan
Everything in the app, including **in-app notifications**: new announcements, meetings going live, new meetings,
new recordings, new testimonies, admin messages, and personal notices ("your testimony was published").
Members can also turn on **alerts on their device** (Notifications -> Turn on); these show while TLDS LIVE is open
in a tab or installed app.

With Blaze (optional) you additionally get **push to phones even when the app is closed**, 15-minute meeting
reminders and email. Set `VITE_FIREBASE_VAPID_KEY` (Firebase console -> Project settings -> Cloud Messaging ->
Web Push certificates), then `cd functions && npm install && firebase deploy --only functions`.
If you deployed the old functions before, Firebase will ask to delete the ones that no longer exist
(onAnnouncementCreated, getRoomToken, ...): answer yes.

## Recording
- Host or any moderator: the record button -> **Audio only** or **Video and audio**.
- Video is a 720p "speaker view": the shared screen when someone presents, otherwise the active speaker's camera,
  otherwise a name card, with a title bar. Audio is everyone's microphone (and shared-tab sound) mixed together.
- The recording is made on the recorder's device and saved to that device **every few seconds while recording**.
  If the tab closes, the phone dies or the upload fails, nothing is lost: next time that person opens TLDS LIVE
  on the same device, a banner offers **Upload to library**, **Save to device** or discard.
- Uploads retry automatically. Files are made seekable (correct duration) before upload.
- Only one person records at a time; everyone sees the REC badge.
- Record from a computer when you can (Chrome or Edge work best, especially for video). On a phone, keep the app
  open in front: phones pause background tabs.
- Music played in the meeting is not included in the recording.

## Meetings
- **Roles.** Host: ends the meeting, appoints moderators, hands over host. Moderators: mute, give speaking turns,
  remove people, mute everyone, switch open/moderated microphones, record.
- **Host leaves without ending:** a moderator becomes host automatically. If none, a moderator or admin in the
  meeting sees **Become host**. If the host is the last person to leave, the meeting ends by itself.
- **Mute** is enforced at the media server too (works even against an old or modified app).
- **Dropped connection:** the app reconnects by itself (about 50 seconds of retries) and keeps any recording going.
- **Refreshing the page** rejoins straight away (no "already in the meeting" question for the same tab).
- **Reactions** (🙏 🙌 ❤️ 👏 🔥 😂), raise hand, chat (moderators can delete messages; links are clickable),
  shared notes (downloadable), music.
- **Audio and video settings:** choose microphone, camera and speaker; switch front/back camera on phones.
- **Data saver:** stops downloading other people's cameras (screen sharing still shows). Good for mobile data.
- Screen sharing can include the tab's sound (Chrome/Edge: tick "Share tab audio").
- Scheduling: weekly series (4/8/12/26 weeks), edit, cancel one or the rest of a series, copy link,
  **Add to calendar** (.ics with a 15-minute alarm). Shared meeting links take people straight into the meeting
  after they sign in.

## Recordings library
Search by title, speaker or month; playback speed (0.75x-2x); 15 s back / 30 s forward; resumes where you stopped;
lock-screen and headphone controls on phones; share links (`/recordings?play=<id>`); admins can edit titles and
descriptions. Video recordings show a thumbnail.

## Install as an app
Android/desktop Chrome or Edge: Home shows **Install TLDS LIVE**. iPhone: Share -> Add to Home Screen.

## Notes and limits
- Capacity depends on your LiveKit plan; 100+ participants with a handful on camera is the intended shape.
- Scheduled announcements are hidden from members in the app; Firestore rules do not enforce the publish time.
- `users` docs are readable only by the owner and admins; testimonies need `status: approved` to be public.
- Never put a service-account file in the repo or the browser.
