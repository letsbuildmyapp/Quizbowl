'use strict';

// Teacher-facing follow-ups: answer review decisions, assignment notifications,
// and privacy-safe analytics counters.

const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { db, FieldValue, now, claimsOf, audit, bumpMetric, notify } = require('./common');
const { levelForXp, titleForLevel, weekKey } = require('../engine/progression');

exports.onAnswerReviewDecided = onDocumentUpdated('answerReviews/{id}', async (event) => {
  const before = event.data.before.data();
  const r = event.data.after.data();
  if (!r || r.status !== 'pending' || !r.decision || before.decision === r.decision) return;
  const claims = await claimsOf(r.decidedBy);
  const classroom = (await db.doc(`classrooms/${r.classroomId}`).get()).data();
  if (claims.role !== 'teacher' || classroom?.teacherUid !== r.decidedBy) {
    await event.data.after.ref.update({ decision: null, decidedBy: null });
    return;
  }
  if (r.decision === 'accept') {
    const studentRef = db.doc(`students/${r.studentId}`);
    const summaryRef = db.doc(`sessionSummaries/${r.sessionId}_${r.studentId}`);
    await db.runTransaction(async (tx) => {
      const [st, sum] = await Promise.all([tx.get(studentRef), tx.get(summaryRef)]);
      if (st.exists) {
        const s = st.data();
        const xp = (s.xp || 0) + (r.potentialXp || 10);
        const level = levelForXp(xp);
        tx.update(studentRef, {
          xp,
          level,
          title: titleForLevel(level),
          'stats.correct': FieldValue.increment(1),
          [`stats.categories.${r.category}.correct`]: FieldValue.increment(1)
        });
      }
      if (sum.exists) {
        tx.update(summaryRef, {
          correct: FieldValue.increment(1),
          points: FieldValue.increment(r.potentialPoints || 10),
          xpEarned: FieldValue.increment(r.potentialXp || 10),
          [`byCategory.${r.category}.correct`]: FieldValue.increment(1),
          overturned: FieldValue.increment(1)
        });
      }
    });
    // Keep this week's class leaderboard in step with the restored XP.
    const summary = (await db.doc(`sessionSummaries/${r.sessionId}_${r.studentId}`).get()).data();
    if (summary?.weekKey) {
      const lbRef = db.doc(`leaderboards/${r.classroomId}_${summary.weekKey}`);
      await db.runTransaction(async (tx) => {
        const lb = (await tx.get(lbRef)).data();
        if (!lb) return;
        const entries = lb.entries.map((e) => (e.studentId === r.studentId ? { ...e, xp: e.xp + (r.potentialXp || 10), correct: e.correct + 1 } : e));
        entries.sort((a, b) => b.xp - a.xp);
        tx.update(lbRef, { entries, updatedAt: now() });
      });
    }
    // Suggest the accepted form to content admins.
    await db.doc(`questions/${r.questionId}`).update({ suggestedAnswers: FieldValue.arrayUnion(String(r.given || '').slice(0, 80)) }).catch(() => {});
    await notify({ toStudentId: r.studentId, kind: 'review', title: 'Your teacher accepted an answer', body: `"${r.given}" counts. +${r.potentialXp || 10} XP`, link: '/play/progress' });
  }
  await event.data.after.ref.update({ status: r.decision === 'accept' ? 'accepted' : 'rejected', decidedAt: now() });
  await audit(`answer_review.${r.decision}`, { actorUid: r.decidedBy, actorRole: 'teacher', target: `answerReviews/${event.params.id}`, schoolId: classroom?.schoolId || null });
});

exports.onAssignmentCreated = onDocumentCreated('assignments/{id}', async (event) => {
  const a = event.data.data();
  await bumpMetric({ assignmentsCreated: 1 });
  let studentIds = [];
  const t = a.targets || { type: 'class' };
  if (t.type === 'students') studentIds = t.ids || [];
  else {
    const q = db.collection('students').where('classroomId', '==', a.classroomId);
    const snap = await q.get();
    studentIds = snap.docs.filter((d) => d.data().active !== false && (t.type === 'class' || (t.ids || []).includes(d.data().teamId))).map((d) => d.id);
  }
  for (const id of studentIds) {
    await notify({ toStudentId: id, kind: 'assignment', title: 'New quest from your teacher', body: a.title || 'A new quest is ready.', link: '/play' });
  }
});

const ANALYTICS_TYPES = {
  report_view: 'reportViews',
  denied: 'deniedAccess',
  rematch_click: 'rematchClicks',
  map_select: 'mapSelections',
  cosmetic_preview: 'cosmeticPreviews',
  motion_pref: 'motionPreferenceChanges'
};

exports.onAnalyticsEvent = onDocumentCreated('analyticsEvents/{id}', async (event) => {
  const e = event.data.data() || {};
  const field = ANALYTICS_TYPES[e.type];
  if (field) await bumpMetric({ [field]: 1 });
  await event.data.ref.delete();
});

exports.onPrivacyRequestCounted = onDocumentCreated('privacyRequests/{id}', async () => {
  await bumpMetric({ privacyRequests: 1 });
});

exports._internal = { weekKey };
