import {
  addDoc, collection, deleteDoc, doc, query, serverTimestamp, Timestamp, updateDoc, where, writeBatch,
} from 'firebase/firestore';
import { sortedQuery } from '../utils/sortedQuery';
import { db } from './firebase';
import { postFeed } from './feed';
import { toDate } from '../utils/format';

const col = () => collection(db, 'meetings');

export const liveMeetingsQuery = () => query(col(), where('status', '==', 'live'));
// Sorted in the app (sortedQuery), so these work without composite indexes in Firebase.
export const upcomingMeetingsQuery = (n = 50) => sortedQuery(query(col(), where('status', '==', 'scheduled')), 'scheduledFor', 'asc', n);
export const pastMeetingsQuery = (n = 15) => sortedQuery(query(col(), where('status', '==', 'ended')), 'endedAt', 'desc', n);

const floorDefaults = { currentSpeakerUid: null, everyoneMuted: false, removedUids: [], moderatorUids: [], recording: false, recordingBy: null };

/** Schedules one meeting, or a weekly series (repeatWeeks > 1 creates that many meetings, one week apart). */
export async function scheduleMeeting(profile, { title, description, duration, when, speakingMode, repeatWeeks = 1 }) {
  const n = Math.max(1, Math.min(26, Number(repeatWeeks) || 1));
  const seriesId = n > 1 ? `s${Date.now().toString(36)}` : null;
  const batch = writeBatch(db);
  for (let i = 0; i < n; i += 1) {
    const at = new Date(when.getTime());
    at.setDate(at.getDate() + 7 * i); // calendar weeks, so the local time survives daylight-saving changes
    batch.set(doc(col()), {
      title, description, duration, status: 'scheduled',
      scheduledFor: Timestamp.fromDate(at),
      hostId: profile.uid, hostName: profile.name, seriesId,
      speakingMode, ...floorDefaults, createdAt: serverTimestamp(),
    });
  }
  await batch.commit();
  const first = when.toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  postFeed(profile, { type: 'meetings', title: `New meeting: ${title}`, body: n > 1 ? `Weekly from ${first} (${n} weeks)` : first, link: '/meetings' });
}

export const updateMeeting = (id, { title, description, duration, when, speakingMode }) => updateDoc(doc(db, 'meetings', id), {
  title, description, duration, speakingMode, scheduledFor: Timestamp.fromDate(when), reminderSent: false,
});

export async function startMeetingNow(profile, title) {
  const t = title || `${profile.firstName || profile.name}'s meeting`;
  const ref = await addDoc(col(), {
    title: t, description: '', status: 'live',
    hostId: profile.uid, hostName: profile.name, speakingMode: 'open', ...floorDefaults,
    startedAt: serverTimestamp(), createdAt: serverTimestamp(),
  });
  postFeed(profile, { type: 'meetings', title: `Live now: ${t}`, body: `Hosted by ${profile.name}`, link: `/meetings/${ref.id}`, refId: ref.id });
  return ref.id;
}

/** Goes live; the person starting becomes the host. */
export async function goLive(m, profile) {
  await updateDoc(doc(db, 'meetings', m.id), {
    status: 'live', hostId: profile.uid, hostName: profile.name, startedAt: serverTimestamp(),
  });
  postFeed(profile, { type: 'meetings', title: `Live now: ${m.title}`, body: `Hosted by ${profile.name}`, link: `/meetings/${m.id}`, refId: m.id });
}
export const endMeeting = (id) => updateDoc(doc(db, 'meetings', id), { status: 'ended', endedAt: serverTimestamp() });
export const deleteMeeting = (id) => deleteDoc(doc(db, 'meetings', id));

export const meetingLink = (id) => `${window.location.origin}/meetings/${id}`;

/** Downloads an .ics file so members can add the meeting to their phone or computer calendar. */
export function downloadIcs(m) {
  const start = toDate(m.scheduledFor);
  if (!start) return;
  const mins = parseDurationMinutes(m.duration) || 60;
  const end = new Date(start.getTime() + mins * 60000);
  const f = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = (s = '') => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (c) => `\\${c}`);
  const url = meetingLink(m.id);
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//TLDS LIVE//Meetings//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT', `UID:${m.id}@tlds-live`, `DTSTAMP:${f(new Date())}`, `DTSTART:${f(start)}`, `DTEND:${f(end)}`,
    `SUMMARY:${esc(m.title)}`, `DESCRIPTION:${esc(`${m.description ? `${m.description}\n\n` : ''}Join: ${url}`)}`, `URL:${url}`, `LOCATION:${esc(url)}`,
    'BEGIN:VALARM', 'TRIGGER:-PT15M', 'ACTION:DISPLAY', `DESCRIPTION:${esc(m.title)}`, 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  a.download = `${m.title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'meeting'}.ics`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

/** "1 hour", "90 min", "1h 30m", "2 hrs" -> minutes */
export function parseDurationMinutes(s = '') {
  const t = String(s).toLowerCase();
  const h = t.match(/(\d+(?:\.\d+)?)\s*h/); const m = t.match(/(\d+)\s*m/);
  if (h || m) return Math.round((h ? parseFloat(h[1]) * 60 : 0) + (m ? parseInt(m[1], 10) : 0));
  const n = parseFloat(t); return Number.isFinite(n) ? Math.round(n) : 0;
}
