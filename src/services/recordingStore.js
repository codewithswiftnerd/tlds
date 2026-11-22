/**
 * Recordings are written to this device (IndexedDB) a few seconds at a time while they are being made.
 * If the tab crashes, the phone dies or the upload fails, the recording is still here and can be
 * uploaded later from any page of the app (see components/recordings/PendingRecordings.jsx).
 */
const DB_NAME = 'tlds-recordings';
let dbPromise = null;

function open() {
  if (!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB unavailable'));
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks', { keyPath: ['recId', 'seq'] });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { dbPromise = null; reject(req.error); };
      req.onblocked = () => { dbPromise = null; reject(new Error('IndexedDB blocked')); };
    });
  }
  return dbPromise;
}

function tx(store, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    let result;
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('aborted'));
    const s = t.objectStore(store);
    const r = fn(s);
    if (r && 'onsuccess' in r) r.onsuccess = () => { result = r.result; };
  }));
}

export const putMeta = (meta) => tx('meta', 'readwrite', (s) => s.put({ ...meta, updatedAt: Date.now() }));
export const getMeta = (id) => tx('meta', 'readonly', (s) => s.get(id));
export const listMeta = () => tx('meta', 'readonly', (s) => s.getAll()).then((l) => l || []);
export const addChunk = (recId, seq, blob) => tx('chunks', 'readwrite', (s) => s.put({ recId, seq, blob }));

export async function getChunks(recId) {
  const rows = await tx('chunks', 'readonly', (s) => s.getAll(IDBKeyRange.bound([recId, 0], [recId, Number.MAX_SAFE_INTEGER])));
  return (rows || []).sort((a, b) => a.seq - b.seq).map((r) => r.blob);
}

export async function removeRecording(recId) {
  await tx('chunks', 'readwrite', (s) => s.delete(IDBKeyRange.bound([recId, 0], [recId, Number.MAX_SAFE_INTEGER])));
  await tx('meta', 'readwrite', (s) => s.delete(recId));
}

/** Asks the browser not to evict our data under storage pressure (best effort). */
export const requestPersistence = () => navigator.storage?.persist?.().catch(() => false);

/** Recordings on this device that never reached the library. A live one in another tab keeps its heartbeat fresh. */
export async function unsavedRecordings(uid) {
  try {
    const all = await listMeta();
    const stale = Date.now() - 30000;
    return all
      .filter((m) => m.createdBy === uid && m.status !== 'uploaded' && (m.status !== 'recording' || m.updatedAt < stale))
      .sort((a, b) => b.startedAt - a.startedAt);
  } catch {
    return [];
  }
}
