import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../services/firebase';
import { ensureProfile, registering } from '../services/auth';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined);       // undefined = still resolving
  const [profile, setProfile] = useState(undefined); // undefined = still loading

  useEffect(() => {
    let unsubProfile = () => {};
    let repair = null;
    const unsub = onAuthStateChanged(auth, (u) => {
      unsubProfile(); clearTimeout(repair);
      setUser(u);
      if (!u) { setProfile(null); return; }
      setProfile(undefined);
      unsubProfile = onSnapshot(doc(db, 'users', u.uid), (snap) => {
        if (!snap.exists()) {
          // Just registered: the profile write is still in flight. If it never arrives, create a basic one.
          clearTimeout(repair);
          repair = setTimeout(() => { if (!registering.current) ensureProfile(u).catch((e) => console.error('profile repair failed', e)); }, 6000);
          return;
        }
        clearTimeout(repair);
        const p = { uid: u.uid, ...snap.data({ serverTimestamps: 'estimate' }) };
        if (p.disabled) {
          sessionStorage.setItem('tlds-signout-reason', 'Your account has been deactivated. Please contact an administrator.');
          signOut(auth); return;
        }
        setProfile(p);
      }, (err) => {
        console.error('profile listener failed', err);
        sessionStorage.setItem('tlds-signout-reason', err?.code === 'permission-denied'
          ? 'Your profile could not be loaded (permission denied). Please contact an administrator.'
          : 'Your profile could not be loaded. Check your connection and sign in again.');
        signOut(auth);
      });
    });
    return () => { unsub(); unsubProfile(); clearTimeout(repair); };
  }, []);

  const value = useMemo(() => ({
    user, profile,
    loading: user === undefined || (user && profile === undefined),
    isAdmin: profile?.role === 'admin',
    canHost: profile?.role === 'admin' || profile?.role === 'host',
  }), [user, profile]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
