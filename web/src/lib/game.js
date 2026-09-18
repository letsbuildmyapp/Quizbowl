// Client helpers for starting matches and small student actions.
import { addDoc, collection, deleteDoc, doc, increment, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebase.js';
import { request } from './requests.js';

/**
 * Ask the server to build a match. Returns the session id.
 * mode: 'practice' | 'score_attack' | 'versus' | 'daily' | 'review'
 * options: { category, difficulty, count, readingSpeed, untimed, personaId, specialty, assignmentId, rematchOf }
 */
export async function startSession(mode, options = {}) {
  const clean = Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined && v !== '' && v !== null));
  const res = await request('sessionRequests', { mode, options: clean }, { timeoutMs: 45000 });
  return res.sessionId;
}

/** Save a finished question to the student's Review Deck (from a SCORED session state). */
export async function saveToReviewDeck(studentId, current) {
  const o = current.outcome;
  await setDoc(doc(db, `students/${studentId}/reviewDeck/${current.questionId}`), {
    questionId: current.questionId,
    category: current.category,
    subcategory: current.subcategory || null,
    clues: o.allClues,
    canonicalAnswer: o.canonicalAnswer,
    acceptedAnswers: o.acceptedAnswers || [],
    explanation: o.explanation || '',
    savedAt: Date.now()
  });
  await updateDoc(doc(db, `students/${studentId}`), { reviewDeckCount: increment(1) });
}

export async function removeFromReviewDeck(studentId, questionId) {
  await deleteDoc(doc(db, `students/${studentId}/reviewDeck/${questionId}`));
  await updateDoc(doc(db, `students/${studentId}`), { reviewDeckCount: increment(-1) });
}

/** "Report a problem with this question" (goes to content admins). */
export async function flagQuestion(questionId, reason, note, role) {
  await addDoc(collection(db, 'contentFlags'), {
    questionId,
    reason,
    note: String(note || '').slice(0, 1000),
    uid: auth.currentUser.uid,
    role,
    status: 'open',
    createdAt: serverTimestamp()
  });
}

export const MODE_LABELS = {
  practice: 'Learn & Practice',
  score_attack: 'Solo Score Attack',
  versus: 'Battle the Computer',
  live_battle: 'Live Team Battle',
  daily: "Today's Quest",
  review: 'Review Deck'
};
