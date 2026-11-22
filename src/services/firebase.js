import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const missing = Object.entries(firebaseConfig).filter(([, v]) => !v).map(([k]) => k);
if (missing.length) {
  // Most common cause of a blank page after deploying: the VITE_FIREBASE_* variables were not set on Netlify.
  throw new Error(`Firebase settings are missing from this build (${missing.join(', ')}).\n\n`
    + 'Fix: in Netlify go to Site configuration -> Environment variables and add every VITE_FIREBASE_* line from your .env file, '
    + 'then Deploys -> Trigger deploy -> Clear cache and deploy site.');
}
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// Cache data on the device: pages open instantly and keep working through short network drops.
function makeDb() {
  try {
    return initializeFirestore(app, { ignoreUndefinedProperties: true, localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  } catch {
    try { return initializeFirestore(app, { ignoreUndefinedProperties: true }); } catch { return getFirestore(app); }
  }
}
export const db = makeDb();
export const storage = getStorage(app);
