import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  isSignInWithEmailLink,
  onIdTokenChanged,
  sendSignInLinkToEmail,
  signInAnonymously,
  signInWithEmailAndPassword,
  signInWithEmailLink,
  signInWithPopup,
  signOut as fbSignOut,
  updateProfile
} from 'firebase/auth';
import { doc } from 'firebase/firestore';
import { ref as rtRef, onDisconnect, set as rtSet, serverTimestamp as rtNow } from 'firebase/database';
import { auth, db, rtdb } from '../firebase.js';
import { listen } from '../lib/listen.js';
import { request } from '../lib/requests.js';

const AuthContext = createContext(null);
const EMAIL_KEY = 'quizquest:emailForSignIn';

/**
 * Identity comes from Firebase Auth custom claims (set server-side).
 * role: 'student' | 'teacher' | 'teacher_pending' | 'parent' | null
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [claims, setClaims] = useState({});
  const [profile, setProfile] = useState(null);
  const [student, setStudent] = useState(null);
  // 'idle' | 'loading' | 'ready' | 'missing' (no doc) | 'error' (gave up)
  const [studentStatus, setStudentStatus] = useState('idle');
  const [loading, setLoading] = useState(true);
  const claimsVersion = useRef(null);

  useEffect(
    () =>
      onIdTokenChanged(auth, async (u) => {
        setUser(u);
        if (!u) {
          setClaims({});
          setProfile(null);
          setStudent(null);
          setLoading(false);
          return;
        }
        const token = await u.getIdTokenResult();
        setClaims(token.claims || {});
        setLoading(false);
      }),
    []
  );

  // Server bumps users/{uid}.claimsVersion after changing claims: refresh the token.
  useEffect(() => {
    if (!user) return undefined;
    claimsVersion.current = null;
    return listen(
      doc(db, 'users', user.uid),
      async (snap) => {
        const data = snap.data() || null;
        setProfile(data);
        const v = data?.claimsVersion ?? 0;
        if (claimsVersion.current !== null && v !== claimsVersion.current) {
          const token = await user.getIdTokenResult(true);
          setClaims(token.claims || {});
        }
        claimsVersion.current = v;
      },
      () => setProfile(null)
    );
  }, [user]);

  // Students: live profile doc. studentStatus lets the UI tell "still loading"
  // apart from "this profile is gone", so a kid never sits on a spinner forever.
  const studentId = claims.role === 'student' ? claims.studentId : null;
  useEffect(() => {
    if (!studentId) {
      setStudent(null);
      setStudentStatus('idle');
      return undefined;
    }
    setStudentStatus('loading');
    return listen(
      doc(db, 'students', studentId),
      (snap) => {
        setStudent(snap.exists() ? { id: snap.id, ...snap.data() } : null);
        setStudentStatus(snap.exists() ? 'ready' : 'missing');
      },
      () => {
        setStudent(null);
        setStudentStatus('error');
      }
    );
  }, [studentId]);

  // Presence (Realtime Database) so teachers can see who's online.
  useEffect(() => {
    if (!user || !rtdb || !claims.role) return undefined;
    const r = rtRef(rtdb, `presence/${user.uid}`);
    const payload = { online: true, role: claims.role, studentId: claims.studentId || null, classroomId: claims.classroomId || null, lastSeen: rtNow() };
    onDisconnect(r).set({ ...payload, online: false }).catch(() => {});
    rtSet(r, payload).catch(() => {});
    return () => {
      rtSet(r, { ...payload, online: false }).catch(() => {});
    };
  }, [user, claims.role, claims.studentId, claims.classroomId]);

  const refreshClaims = useCallback(async () => {
    if (!auth.currentUser) return {};
    const token = await auth.currentUser.getIdTokenResult(true);
    setClaims(token.claims || {});
    return token.claims || {};
  }, []);

  const studentSignIn = useCallback(
    async ({ code, studentId: sid, pin }) => {
      if (!auth.currentUser) await signInAnonymously(auth);
      const uid = auth.currentUser.uid;
      await request('studentLogins', { code: code.toUpperCase(), studentId: sid, pin }, { id: uid });
      return refreshClaims();
    },
    [refreshClaims]
  );

  /** Self-join: the class code plus a nickname and PIN the kid picks. */
  const studentJoin = useCallback(
    async ({ code, name, pin }) => {
      if (!auth.currentUser) await signInAnonymously(auth);
      const uid = auth.currentUser.uid;
      await request('joinRequests', { code: code.toUpperCase(), name, pin }, { id: uid });
      return refreshClaims();
    },
    [refreshClaims]
  );

  const value = useMemo(
    () => ({
      user,
      claims,
      role: claims.role || null,
      isStudent: claims.role === 'student',
      isTeacher: claims.role === 'teacher',
      isSchoolAdmin: claims.role === 'teacher' && !!claims.schoolAdmin,
      isParent: claims.role === 'parent',
      isContentAdmin: !!claims.contentAdmin,
      isPlatformAdmin: !!claims.platformAdmin,
      profile,
      student,
      studentStatus,
      loading,
      refreshClaims,
      studentSignIn,
      studentJoin,
      ensureAnonymous: async () => {
        if (!auth.currentUser) await signInAnonymously(auth);
        return auth.currentUser;
      },
      signInWithGoogle: () => signInWithPopup(auth, new GoogleAuthProvider()),
      signInWithEmail: (email, password) => signInWithEmailAndPassword(auth, email, password),
      registerWithEmail: async (email, password, displayName) => {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        if (displayName) await updateProfile(cred.user, { displayName });
        return cred;
      },
      sendMagicLink: async (email, next = '/family') => {
        const url = `${window.location.origin}/finish-signin?next=${encodeURIComponent(next)}`;
        await sendSignInLinkToEmail(auth, email, { url, handleCodeInApp: true });
        window.localStorage.setItem(EMAIL_KEY, email);
      },
      isMagicLink: (href) => isSignInWithEmailLink(auth, href),
      completeMagicLink: async (href, emailOverride) => {
        const email = emailOverride || window.localStorage.getItem(EMAIL_KEY);
        if (!email) throw new Error('need-email');
        const cred = await signInWithEmailLink(auth, email, href);
        window.localStorage.removeItem(EMAIL_KEY);
        return cred;
      },
      signOut: () => fbSignOut(auth)
    }),
    [user, claims, profile, student, studentStatus, loading, refreshClaims, studentSignIn, studentJoin]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** Where each role lands after sign-in. */
export function homeFor(auth) {
  if (auth.isStudent) return '/play';
  if (auth.isTeacher) return '/teach';
  if (auth.role === 'teacher_pending') return '/onboarding/teacher';
  if (auth.isParent) return '/family';
  if (auth.isPlatformAdmin || auth.isContentAdmin) return '/admin';
  if (auth.user && !auth.user.isAnonymous) return '/onboarding';
  return '/login';
}
