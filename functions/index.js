const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onRequest } = require('firebase-functions/v2/https');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const express = require('express');

initializeApp();
const db = getFirestore();

// Callable: grade a quiz attempt server-side so answers can't be spoofed by the client.
exports.gradeAttempt = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }
  const { quizId, answers } = request.data ?? {};
  if (!quizId || !Array.isArray(answers)) {
    throw new HttpsError('invalid-argument', 'quizId and answers[] are required.');
  }

  const quizSnap = await db.doc(`quizzes/${quizId}`).get();
  if (!quizSnap.exists) throw new HttpsError('not-found', 'Quiz not found.');
  const questionIds = quizSnap.data().questionIds ?? [];

  const questions = await Promise.all(
    questionIds.map((id) => db.doc(`questionBank/${id}`).get())
  );

  let correct = 0;
  const graded = questions.map((qSnap, i) => {
    const q = qSnap.data() ?? {};
    const guess = (answers[i] ?? '').trim().toLowerCase();
    const target = (q.answer ?? '').trim().toLowerCase();
    const isCorrect = guess === target;
    if (isCorrect) correct += 1;
    return { questionId: qSnap.id, guess: answers[i] ?? '', correct: isCorrect };
  });

  const attemptRef = await db.collection(`quizzes/${quizId}/attempts`).add({
    studentUid: request.auth.uid,
    answers: graded,
    score: correct,
    total: questionIds.length,
    submittedAt: FieldValue.serverTimestamp()
  });

  return { attemptId: attemptRef.id, score: correct, total: questionIds.length };
});

// Firestore trigger: keep a rolling count of attempts on the parent quiz doc.
exports.onAttemptCreated = onDocumentCreated(
  'quizzes/{quizId}/attempts/{attemptId}',
  async (event) => {
    const quizId = event.params.quizId;
    await db.doc(`quizzes/${quizId}`).set(
      { attemptCount: FieldValue.increment(1) },
      { merge: true }
    );
  }
);

// Express HTTP API mounted at /api/** via firebase.json rewrites.
const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'quiz-bowl-api' });
});

app.get('/questions/random', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);
  const snap = await db.collection('questionBank').limit(limit).get();
  res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
});

exports.api = onRequest(app);
