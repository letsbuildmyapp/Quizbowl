// onSnapshot that survives a transient failure.
//
// A listener opened in the moment the ID token is still catching up (right
// after sign-in, or after the server changes custom claims) gets a single
// permission-denied. Firestore then drops that listener for good, so the screen
// sits on its spinner or its last state until the kid reloads the page. Every
// live read in the app goes through here instead: refresh the token, resubscribe,
// and only give up after a few tries.
import { onSnapshot } from 'firebase/firestore';
import { auth } from '../firebase.js';

const RETRY_CODES = new Set(['permission-denied', 'unauthenticated', 'unavailable', 'internal', 'cancelled', 'aborted']);
const MAX_RETRIES = 4;

export function listen(target, onNext, onError) {
  let stopped = false;
  let unsub = () => {};
  let attempt = 0;

  const start = () => {
    if (stopped) return;
    unsub = onSnapshot(
      target,
      (snap) => {
        attempt = 0;
        onNext(snap);
      },
      async (err) => {
        if (stopped) return;
        if (!RETRY_CODES.has(err.code) || attempt >= MAX_RETRIES) {
          onError?.(err);
          return;
        }
        const wait = 250 * 2 ** attempt;
        attempt += 1;
        await auth.currentUser?.getIdToken(true).catch(() => {});
        setTimeout(start, wait);
      }
    );
  };

  start();
  return () => {
    stopped = true;
    unsub();
  };
}
