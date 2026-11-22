import { addDoc, collection, deleteDoc, doc, orderBy, query, serverTimestamp, Timestamp, updateDoc } from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { db, storage } from './firebase';
import { toDate } from '../utils/format';
import { postFeed } from './feed';

export const CATEGORIES = ['General', 'Meetings', 'Teaching', 'Prayer', 'Events', 'Urgent'];
export const announcementsQuery = () => query(collection(db, 'announcements'), orderBy('createdAt', 'desc'));

/** Members only see announcements whose publish time has passed; pinned first. */
export function visibleAnnouncements(list, isAdmin) {
  const now = Date.now();
  return list
    .filter((a) => isAdmin || !a.publishAt || toDate(a.publishAt).getTime() <= now)
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
}

async function upload(file) {
  const path = `announcements/${Date.now()}_${Math.random().toString(36).slice(2, 7)}_${file.name.replace(/[^\w.-]/g, '_')}`;
  const r = ref(storage, path);
  await uploadBytes(r, file, { contentType: file.type });
  return { name: file.name, url: await getDownloadURL(r), path, type: file.type };
}

export async function saveAnnouncement(profile, existing, { title, body, category, pinned, publishAt, image, files }) {
  const imageObj = image ? await upload(image) : existing?.image || null;
  const newFiles = await Promise.all((files || []).map(upload));
  const data = {
    title, body, category, pinned,
    publishAt: publishAt ? Timestamp.fromDate(publishAt) : null,
    image: imageObj, attachments: [...(existing?.attachments || []), ...newFiles],
  };
  if (existing) return updateDoc(doc(db, 'announcements', existing.id), { ...data, updatedAt: serverTimestamp() });
  const ref = await addDoc(collection(db, 'announcements'), { ...data, authorId: profile.uid, authorName: profile.name, createdAt: serverTimestamp() });
  postFeed(profile, { type: 'announcements', title: title, body, link: '/announcements', refId: ref.id, visibleAt: publishAt && publishAt.getTime() > Date.now() ? publishAt : null });
  return ref;
}

export async function removeAttachment(a, path) {
  await updateDoc(doc(db, 'announcements', a.id), { attachments: a.attachments.filter((f) => f.path !== path) });
  await deleteObject(ref(storage, path)).catch(() => {});
}

export async function deleteAnnouncement(a) {
  const paths = [a.image?.path, ...(a.attachments || []).map((f) => f.path)].filter(Boolean);
  await Promise.all(paths.map((p) => deleteObject(ref(storage, p)).catch(() => {})));
  await deleteDoc(doc(db, 'announcements', a.id));
}
