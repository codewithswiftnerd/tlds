import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
  sendPasswordResetEmail, updatePassword, reauthenticateWithCredential, EmailAuthProvider,
} from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { auth, db } from './firebase';

export function friendlyAuthError(e) {
  const map = {
    'auth/invalid-credential': 'Incorrect email or password.',
    'auth/wrong-password': 'Incorrect email or password.',
    'auth/user-not-found': 'Incorrect email or password.',
    'auth/email-already-in-use': 'An account with this email already exists.',
    'auth/weak-password': 'Password must be at least 6 characters.',
    'auth/invalid-email': 'Please enter a valid email address.',
    'auth/too-many-requests': 'Too many attempts. Please wait a moment and try again.',
    'auth/network-request-failed': 'Network error. Check your connection and try again.',
    'auth/requires-recent-login': 'Please sign in again and retry.',
  };
  return map[e?.code] || 'Something went wrong. Please try again.';
}

export const login = (email, password) => signInWithEmailAndPassword(auth, email.trim(), password);
export const logout = () => signOut(auth);
export const resetPassword = (email) => sendPasswordResetEmail(auth, email.trim());

/** True while register() is creating the profile, so AuthContext does not try to repair it at the same time. */
export const registering = { current: false };

export async function register(form) {
  registering.current = true;
  try { await doRegister(form); } finally { registering.current = false; }
}

async function doRegister({ firstName, lastName, email, phone, location, password }) {
  const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
  const uid = cred.user.uid;
  const userRef = doc(db, 'users', uid);
  const bootstrapRef = doc(db, 'system', 'bootstrap');
  const data = {
    firstName: firstName.trim(), lastName: lastName.trim(),
    name: `${firstName.trim()} ${lastName.trim()}`.trim(),
    email: email.trim(), phone: phone.trim(), location: location.trim(),
    role: 'member', disabled: false, createdAt: serverTimestamp(),
  };
  let first = false;
  try {
    const b = await getDoc(bootstrapRef);
    first = !b.exists() || b.data().adminClaimed !== true;
  } catch { first = false; }
  if (first) {
    try {
      const batch = writeBatch(db);
      batch.set(userRef, { ...data, role: 'admin' });
      batch.set(bootstrapRef, { adminClaimed: true, claimedBy: uid, claimedAt: serverTimestamp() });
      await batch.commit();
      return;
    } catch { /* someone claimed it first: fall back to a normal member */ }
  }
  await setDoc(userRef, data);
}

export async function saveProfile(uid, { name, phone, location }) {
  const parts = name.trim().split(/\s+/);
  await updateDoc(doc(db, 'users', uid), {
    name: name.trim(), firstName: parts[0] || '', lastName: parts.slice(1).join(' '),
    phone: phone.trim(), location: location.trim(),
  });
}

export async function changePassword(current, next) {
  const u = auth.currentUser;
  await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, current));
  await updatePassword(u, next);
}

/** Repairs an account whose profile document was never written (e.g. the browser closed mid-registration). */
export async function ensureProfile(u) {
  const ref = doc(db, 'users', u.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return;
  const name = (u.displayName || u.email?.split('@')[0] || 'Member').trim();
  const [first, ...rest] = name.split(/\s+/);
  await setDoc(ref, {
    firstName: first || name, lastName: rest.join(' '), name, email: u.email || '', phone: '', location: '',
    role: 'member', disabled: false, createdAt: serverTimestamp(),
  });
}
