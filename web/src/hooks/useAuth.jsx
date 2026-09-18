import { createContext, useContext, useEffect, useState } from 'react';
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  signInWithPopup,
  createUserWithEmailAndPassword,
  signOut
} from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../firebase.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(auth, async (fbUser) => {
      setUser(fbUser);
      if (fbUser) {
        const ref = doc(db, 'users', fbUser.uid);
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          const isAnonymous = fbUser.isAnonymous;
          const seed = {
            displayName: isAnonymous ? 'Demo User' : (fbUser.displayName ?? fbUser.email),
            email: fbUser.email ?? null,
            role: isAnonymous ? 'teacher' : 'student',
            isDemo: isAnonymous,
            createdAt: serverTimestamp()
          };
          await setDoc(ref, seed);
          setProfile(seed);
        } else {
          setProfile(snap.data());
        }
      } else {
        setProfile(null);
      }
      setLoading(false);
    });
  }, []);

  const value = {
    user,
    profile,
    loading,
    signInWithGoogle: () => signInWithPopup(auth, new GoogleAuthProvider()),
    signInWithEmail: (email, password) => signInWithEmailAndPassword(auth, email, password),
    registerWithEmail: (email, password) => createUserWithEmailAndPassword(auth, email, password),
    signInAsDemo: () => signInAnonymously(auth),
    signOut: () => signOut(auth)
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
