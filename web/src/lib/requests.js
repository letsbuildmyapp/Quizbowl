// Privileged actions go through "request documents": the client creates a doc,
// a Firestore trigger does the work and writes status/result back.
// See docs/DATA_MODEL.md for why (no callable functions in this GCP org).
import { addDoc, collection, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { listen } from './listen.js';
import { auth, db } from '../firebase.js';

export async function submitRequest(collectionName, payload, id) {
  const data = { ...payload, uid: auth.currentUser?.uid ?? null, status: 'pending', createdAt: serverTimestamp() };
  if (id) {
    await setDoc(doc(db, collectionName, id), data);
    return id;
  }
  const ref = await addDoc(collection(db, collectionName), data);
  return ref.id;
}

export function waitForResult(collectionName, id, { timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    let unsub = () => {};
    const timer = setTimeout(() => {
      unsub();
      reject(new Error('This is taking longer than usual. Check your connection and try again.'));
    }, timeoutMs);
    unsub = listen(
      doc(db, collectionName, id),
      (snap) => {
        const d = snap.data();
        if (!d || d.status === 'pending') return;
        clearTimeout(timer);
        unsub();
        if (d.status === 'error') reject(new Error(d.error || 'Something went wrong.'));
        else resolve(d.result ?? d);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export async function request(collectionName, payload, opts = {}) {
  const id = await submitRequest(collectionName, payload, opts.id);
  return waitForResult(collectionName, id, opts);
}

export function randomId(len = 20) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

/** Human-friendly codes without look-alike characters. */
export function randomCode(len = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}
