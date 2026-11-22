import { addDoc, collection, deleteDoc, doc, orderBy, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { sortedQuery } from '../utils/sortedQuery';
import { deleteObject, getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage';
import { db, storage } from './firebase';
import { postFeed } from './feed';
import { notifyMember } from './notifications';

export const TESTIMONY_CATEGORIES = ['Healing', 'Provision', 'Salvation', 'Breakthrough', 'Answered prayer', 'Other'];
const col = () => collection(db, 'testimonies');

// Sorted in the app (sortedQuery), so these work without composite indexes in Firebase.
export const approvedQuery = (n) => sortedQuery(query(col(), where('status', '==', 'approved')), 'createdAt', 'desc', n || 0);
export const mineQuery = (uid) => sortedQuery(query(col(), where('authorId', '==', uid)), 'createdAt', 'desc');
export const pendingQuery = () => sortedQuery(query(col(), where('status', '==', 'pending')), 'createdAt', 'desc');
export const allQuery = () => query(col(), orderBy('createdAt', 'desc'));

export async function submitTestimony(profile, { title, body, category, file }, onProgress) {
  let media = {};
  if (file) {
    const path = `testimonies/${profile.uid}/${Date.now()}_${file.name.replace(/[^\w.-]/g, '_')}`;
    const r = ref(storage, path);
    await new Promise((res, rej) => {
      const t = uploadBytesResumable(r, file, { contentType: file.type });
      t.on('state_changed', (s) => onProgress?.(Math.round((s.bytesTransferred / s.totalBytes) * 100)), rej, res);
    });
    media = { mediaUrl: await getDownloadURL(r), storagePath: path, mediaType: file.type.startsWith('video') ? 'video' : 'audio' };
  }
  try {
    await addDoc(col(), {
      title, body, category, authorId: profile.uid, authorName: profile.name,
      status: 'pending', createdAt: serverTimestamp(), ...media,
    });
  } catch (e) {
    if (media.storagePath) await deleteObject(ref(storage, media.storagePath)).catch(() => {});
    throw e;
  }
}

/** Approve or reject. Tells the author (personal notification) and, when approved, the whole community (feed). */
export async function reviewTestimony(t, admin, status, rejectReason = '', { announce = true } = {}) {
  await updateDoc(doc(db, 'testimonies', t.id), { status, reviewedBy: admin.uid, reviewedAt: serverTimestamp(), rejectReason });
  if (t.authorId && t.authorId !== admin.uid) {
    notifyMember(t.authorId, status === 'approved'
      ? { type: 'testimonies', title: 'Your testimony was published', body: t.title || '', link: '/testimonies' }
      : { type: 'testimonies', title: 'Your testimony was not published', body: rejectReason || 'Please contact an administrator for details.', link: '/testimonies' }).catch(() => {});
  }
  if (status === 'approved' && announce) postFeed(admin, { type: 'testimonies', title: `New testimony: ${t.title || 'Untitled'}`, body: t.authorName ? `Shared by ${t.authorName}` : '', link: '/testimonies', refId: t.id });
}

export async function deleteTestimony(t) {
  if (t.storagePath) await deleteObject(ref(storage, t.storagePath)).catch(() => {});
  await deleteDoc(doc(db, 'testimonies', t.id));
}
