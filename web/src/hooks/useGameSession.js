// Live game session client. The server is authoritative: this hook only
// renders the public session state, sends commands (with server timestamps
// stamped by Firestore), and keeps a heartbeat so scheduled events (clue
// reveals, computer buzzes, answer timeouts) are processed on time.
import { useCallback, useEffect, useRef, useState } from 'react';
import { collection, doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from '../firebase.js';
import { useAuth } from './useAuth.jsx';

const ACTIVE = new Set(['READING_CLUE', 'BUZZ_LOCKED', 'AWAITING_ANSWER', 'BONUS']);
const HEARTBEAT_MS = 800;

export function useGameSession(sessionId, { controller: controllerOverride } = {}) {
  const { claims, user } = useAuth();
  const [session, setSession] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastRejection, setLastRejection] = useState(null);
  const offsetRef = useRef(0); // serverNow ≈ Date.now() + offset
  const samples = useRef([]);

  const actorId = claims.role === 'student' ? claims.studentId : user?.uid;
  const role = claims.role;

  useEffect(() => {
    if (!sessionId) return undefined;
    setLoading(true);
    return onSnapshot(
      doc(db, 'sessions', sessionId),
      (snap) => {
        const d = snap.exists() ? { id: snap.id, ...snap.data() } : null;
        if (d?.clock) {
          // pub.clock is the server's processing time; it arrives ~tens of ms later.
          const sample = d.clock - Date.now() + 60;
          samples.current = [...samples.current.slice(-9), sample];
          const sorted = samples.current.slice().sort((a, b) => a - b);
          offsetRef.current = sorted[Math.floor(sorted.length * 0.75)] ?? sample;
        }
        setSession(d);
        setLoading(false);
      },
      (err) => {
        setError(err);
        setLoading(false);
      }
    );
  }, [sessionId]);

  const serverNow = useCallback(() => Date.now() + offsetRef.current, []);

  const send = useCallback(
    async (type, payload = {}, { watch = false } = {}) => {
      if (!sessionId || !auth.currentUser) return null;
      const ref = doc(collection(db, `sessions/${sessionId}/commands`));
      await setDoc(ref, { type, payload, at: serverTimestamp(), uid: auth.currentUser.uid, actorId, role });
      if (watch) {
        // Surface rejections (e.g. "someone else buzzed first").
        const unsub = onSnapshot(
          ref,
          (s) => {
            const d = s.data();
            if (d?.processed) {
              unsub();
              if (d.error) setLastRejection({ ...d.error, type, at: Date.now() });
            }
          },
          () => unsub()
        );
        setTimeout(() => unsub(), 15000);
      }
      return ref.id;
    },
    [sessionId, actorId, role]
  );

  const isController =
    controllerOverride ??
    (session ? (session.mode === 'live_battle' ? session.hostUid === user?.uid : session.ownerStudentId === actorId) : false);

  // Heartbeat while anything time-based is pending.
  const status = session?.status;
  useEffect(() => {
    if (!isController || !ACTIVE.has(status)) return undefined;
    // Always beat while active; switching away pauses solo play separately (below).
    const id = setInterval(() => send('sync').catch(() => {}), HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [isController, status, send]);

  // Solo play pauses when the tab is hidden and resumes when it comes back.
  useEffect(() => {
    if (!isController || !session || session.mode === 'live_battle') return undefined;
    const onVis = () => {
      if (document.visibilityState === 'hidden' && ACTIVE.has(session.status)) send('pause').catch(() => {});
      if (document.visibilityState === 'visible' && session.status === 'PAUSED') send('resume').catch(() => {});
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [isController, session, send]);

  const mySide = session?.participants?.find((p) => p.id === actorId)?.side ?? null;

  return { session, loading, error, send, serverNow, isController, actorId, mySide, lastRejection, clearRejection: () => setLastRejection(null) };
}

/** Re-render on an interval (for countdown bars). */
export function useTicker(active, ms = 100) {
  const [, setT] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => setT((t) => t + 1), ms);
    return () => clearInterval(id);
  }, [active, ms]);
}
