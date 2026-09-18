'use strict';

// Client-SDK helpers for integration tests against the running emulator suite
// (firebase emulators:start + node scripts/seed.js --reset --emulator).

const { initializeApp, deleteApp } = require('firebase/app');
const { getAuth, connectAuthEmulator, signInAnonymously, signInWithEmailAndPassword, createUserWithEmailAndPassword } = require('firebase/auth');
const { getFirestore, connectFirestoreEmulator, doc, setDoc, getDoc, onSnapshot, serverTimestamp, collection, addDoc } = require('firebase/firestore');

const PROJECT = 'quizbowl-d984f';
let n = 0;

function makeClient() {
  const app = initializeApp({ apiKey: 'demo-key', projectId: PROJECT, authDomain: `${PROJECT}.firebaseapp.com` }, `client-${++n}-${Date.now()}`);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  return {
    app,
    auth,
    db,
    doc: (p) => doc(db, p),
    async close() {
      await deleteApp(app);
    },
    async anon() {
      await signInAnonymously(auth);
      return auth.currentUser;
    },
    async email(email, password) {
      await signInWithEmailAndPassword(auth, email, password);
      return auth.currentUser;
    },
    async register(email, password) {
      await createUserWithEmailAndPassword(auth, email, password);
      return auth.currentUser;
    },
    async claims() {
      const t = await auth.currentUser.getIdTokenResult(true);
      return t.claims;
    },
    async request(col, payload, id) {
      const data = { ...payload, uid: auth.currentUser.uid, status: 'pending', createdAt: serverTimestamp() };
      let ref;
      if (id) {
        ref = doc(db, col, id);
        await setDoc(ref, data);
      } else ref = await addDoc(collection(db, col), data);
      return waitFor(ref, (d) => d && d.status !== 'pending', 30000);
    },
    async command(sessionId, type, payload = {}, actorId) {
      const role = (await auth.currentUser.getIdTokenResult()).claims.role;
      const ref = doc(collection(db, `sessions/${sessionId}/commands`));
      await setDoc(ref, { type, payload, at: serverTimestamp(), uid: auth.currentUser.uid, actorId, role });
      return ref;
    },
    get: async (p) => (await getDoc(doc(db, p))).data(),
    set: (p, d) => setDoc(doc(db, p), d),
    waitDoc: (p, pred, ms) => waitFor(doc(db, p), pred, ms)
  };
}

function waitFor(ref, pred, ms = 20000) {
  return new Promise((resolve, reject) => {
    let unsub = () => {};
    const timer = setTimeout(() => {
      unsub();
      reject(new Error(`timeout waiting for ${ref.path}`));
    }, ms);
    unsub = onSnapshot(
      ref,
      (snap) => {
        const d = snap.data();
        if (pred(d)) {
          clearTimeout(timer);
          unsub();
          resolve(d);
        }
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function studentLogin(c, name = 'Meridian', pin = '1111', code = 'QUEST1') {
  const user = await c.anon();
  const cc = await c.get(`classCodes/${code}`);
  const entry = cc.roster.find((r) => r.displayName === name);
  const res = await c.request('studentLogins', { code, studentId: entry.id, pin }, user.uid);
  const claims = await c.claims();
  return { res, claims, studentId: entry.id };
}

module.exports = { makeClient, waitFor, sleep, studentLogin, PROJECT };
