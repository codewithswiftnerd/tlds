import { addDoc, collection, deleteDoc, doc, limit, orderBy, query, serverTimestamp, updateDoc } from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage';
import { db, storage } from './firebase';
import { postFeed } from './feed';
import { removeRecording, putMeta } from './recordingStore';
import { explainError, withTimeout } from '../utils/errors';

export const recordingsQuery = (n) => query(collection(db, 'recordings'), orderBy('createdAt', 'desc'), ...(n ? [limit(n)] : []));

const extFor = (mime) => (mime.includes('mp4') ? (mime.startsWith('video') ? 'mp4' : 'm4a') : mime.includes('ogg') ? 'ogg' : 'webm');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const STALL_MS = 60 * 1000;

/** One upload attempt. Fails with code storage/no-response if no bytes move for a minute (instead of sitting at 0% forever). */
function put(path, blob, contentType, uid, onProgress) {
  const r = ref(storage, path);
  return new Promise((resolve, reject) => {
    const task = uploadBytesResumable(r, blob, { contentType, cacheControl: 'public, max-age=31536000', customMetadata: { uploadedBy: uid } });
    let sent = 0; let stalled = false;
    let watchdog = null;
    const arm = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => { stalled = true; task.cancel(); }, STALL_MS);
    };
    arm();
    task.on('state_changed', (s) => {
      if (s.bytesTransferred > sent) { sent = s.bytesTransferred; arm(); }
      onProgress?.(s.totalBytes ? Math.round((s.bytesTransferred / s.totalBytes) * 100) : 0);
    }, (e) => {
      clearTimeout(watchdog);
      if (stalled) {
        reject(Object.assign(new Error('upload stalled'), { code: sent ? 'storage/retry-limit-exceeded' : 'storage/no-response' }));
      } else reject(e);
    }, () => { clearTimeout(watchdog); resolve(r); });
  });
}

const FATAL = ['storage/unauthorized', 'storage/unauthenticated', 'storage/quota-exceeded', 'storage/canceled', 'storage/no-response',
  'storage/bucket-not-found', 'storage/project-not-found', 'storage/no-default-bucket', 'storage/invalid-default-bucket'];

/** Plain-words reason for a failed recording upload. */
export function uploadErrorMessage(e) {
  if (e?.code === 'storage/unauthorized') return 'Upload refused: your account is not allowed to add recordings for this meeting (or the Storage rules are not published yet).';
  return `Upload failed. ${explainError(e)} The recording is still safe on this device.`;
}

/**
 * Uploads a finished recording (with automatic retries), writes its library entry, tells members, and only
 * then deletes the copy kept on this device. If the library write fails the uploaded files are removed again.
 * meta: { meetingId, meetingTitle, description, hostName, createdBy }
 */
export async function uploadRecording({ deviceId, blob, mimeType, durationSec, mediaType, poster, meta, profile }, onProgress) {
  const stamp = Date.now();
  const base = `recordings/${meta.meetingId}/${stamp}`;
  let mediaRef = null, posterRef = null, lastErr = null;

  for (let attempt = 0; attempt < 4 && !mediaRef; attempt += 1) {
    if (attempt) await wait([0, 3000, 8000, 20000][attempt]);
    try { mediaRef = await put(`${base}.${extFor(mimeType)}`, blob, mimeType, profile.uid, onProgress); }
    catch (e) {
      lastErr = e;
      if (FATAL.includes(e?.code)) break;
    }
  }
  if (!mediaRef) throw lastErr || new Error('upload failed');

  if (poster) { try { posterRef = await put(`${base}.jpg`, poster, 'image/jpeg', profile.uid); } catch { posterRef = null; } }

  try {
    const url = await getDownloadURL(mediaRef);
    const posterUrl = posterRef ? await getDownloadURL(posterRef) : null;
    const added = await withTimeout(addDoc(collection(db, 'recordings'), {
      meetingId: meta.meetingId, meetingTitle: meta.meetingTitle || 'Meeting recording', description: meta.description || '',
      hostName: meta.hostName || profile.name, url, storagePath: mediaRef.fullPath, contentType: mimeType,
      posterUrl, posterPath: posterRef?.fullPath || null,
      mediaType, durationSec, size: blob.size, recordedAt: meta.startedAt || stamp,
      createdBy: profile.uid, createdAt: serverTimestamp(),
    }), 45000);
    postFeed(profile, { type: 'recordings', title: `New recording: ${meta.meetingTitle || 'Meeting'}`, body: meta.hostName ? `Hosted by ${meta.hostName}` : '', link: `/recordings?play=${added.id}`, refId: added.id });
  } catch (e) {
    await deleteObject(mediaRef).catch(() => {});
    if (posterRef) await deleteObject(posterRef).catch(() => {});
    throw e;
  }
  if (deviceId) {
    await putMeta({ id: deviceId, ...meta, status: 'uploaded' }).catch(() => {});
    await removeRecording(deviceId).catch(() => {});
  }
}

/** Saves a copy to the device's Downloads folder (fallback when the upload keeps failing). */
export function saveToDevice(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export const fileNameFor = (title, mimeType, when = Date.now()) =>
  `${(title || 'recording').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'recording'}-${new Date(when).toISOString().slice(0, 10)}.${extFor(mimeType || 'audio/webm')}`;

export const updateRecording = (id, data) => updateDoc(doc(db, 'recordings', id), data);

/** Deletes the files first, then the library entry (a missing file is fine). */
export async function deleteRecording(rec) {
  for (const p of [rec.storagePath, rec.posterPath].filter(Boolean)) {
    try { await deleteObject(ref(storage, p)); }
    catch (e) { if (e.code !== 'storage/object-not-found') throw e; }
  }
  await deleteDoc(doc(db, 'recordings', rec.id));
}
