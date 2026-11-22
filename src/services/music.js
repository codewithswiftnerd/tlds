import { addDoc, collection, deleteDoc, doc, orderBy, query, serverTimestamp, setDoc } from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage';
import { db, storage } from './firebase';

export const libraryQuery = () => query(collection(db, 'musicTracks'), orderBy('createdAt', 'desc'));

/** Confirms a web link really is a playable audio file (not a YouTube / Spotify page). */
export function checkAudioUrl(url) {
  return new Promise((resolve, reject) => {
    const a = new Audio();
    const t = setTimeout(() => { a.src = ''; reject(new Error('timeout')); }, 10000);
    a.preload = 'metadata';
    a.onloadedmetadata = () => { clearTimeout(t); resolve(a.duration); };
    a.onerror = () => { clearTimeout(t); reject(new Error('unplayable')); };
    a.src = url;
  });
}

export async function addTrack(profile, { title, file, url }, onProgress) {
  const base = { title, addedBy: profile.uid, addedByName: profile.name, createdAt: serverTimestamp() };
  if (file) {
    const path = `music/${profile.uid}/${Date.now()}_${file.name.replace(/[^\w.-]/g, '_')}`;
    const r = ref(storage, path);
    await new Promise((res, rej) => {
      const t = uploadBytesResumable(r, file, { contentType: file.type });
      t.on('state_changed', (s) => onProgress?.(Math.round((s.bytesTransferred / s.totalBytes) * 100)), rej, res);
    });
    try { await addDoc(collection(db, 'musicTracks'), { ...base, url: await getDownloadURL(r), storagePath: path, source: 'upload' }); }
    catch (e) { await deleteObject(r).catch(() => {}); throw e; }
    return;
  }
  await addDoc(collection(db, 'musicTracks'), { ...base, url, source: 'link' });
}

export async function deleteTrack(t) {
  if (t.storagePath) await deleteObject(ref(storage, t.storagePath)).catch(() => {});
  await deleteDoc(doc(db, 'musicTracks', t.id));
}

/** The shared "what is playing" record for a meeting. Everyone plays it locally, kept in step by time. */
export const writeMusicState = (meetingId, uid, data) =>
  setDoc(doc(db, 'meetings', meetingId, 'music', 'state'), {
    trackId: null, title: '', url: '', playing: false, position: 0, startedAtMs: 0, loop: false,
    ...data, updatedBy: uid, updatedAt: serverTimestamp(),
  });
