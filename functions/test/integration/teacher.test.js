'use strict';

// Teacher flow: new school -> classroom -> students + PINs -> student login ->
// assignment -> student plays it -> progress, summary, dashboard totals ->
// close-answer review accepted by the teacher.

const test = require('node:test');
const assert = require('node:assert/strict');
const { collection, addDoc, doc, updateDoc, getDocs, query, orderBy, serverTimestamp } = require('firebase/firestore');
const { clientPool, newTeacher, newClassroom, addStudents, until, drive, answerKey, listWhere, RUN } = require('./fixtures');

const client = clientPool();
test.after(() => client.closeAll());

const ctx = {};

test('teacher creates a school, becomes its admin, and gets teacher claims', { timeout: 60000 }, async () => {
  const tc = client();
  const t = await newTeacher(tc, 'flow');
  assert.equal(t.res.status, 'done');
  assert.equal(t.claims.role, 'teacher');
  assert.equal(t.claims.schoolAdmin, true);
  assert.equal(t.claims.schoolId, t.schoolId);
  const school = await tc.get(`schools/${t.schoolId}`);
  assert.deepEqual(school.adminUids, [t.uid]);
  const me = await tc.get(`schools/${t.schoolId}/teachers/${t.uid}`);
  assert.equal(me.status, 'approved');
  Object.assign(ctx, { tc, t });
});

test('classroom gets a classCodes roster doc; 5 students with PINs join it', { timeout: 90000 }, async () => {
  const { tc, t } = ctx;
  const cls = await newClassroom(tc, t);
  const cc = await tc.get(`classCodes/${cls.code}`);
  assert.equal(cc.classroomId, cls.classroomId);
  assert.equal(cc.className, cls.name);
  const roster = await addStudents(tc, t, cls, ['Ada', 'Ben', 'Cy', 'Dee', 'Eli'].map((n) => `${n} ${RUN.slice(-4)}`));
  assert.equal(roster.length, 5);
  const cc2 = await tc.get(`classCodes/${cls.code}`);
  assert.equal(cc2.roster.length, 5);
  // Roster doc carries aliases only.
  for (const r of cc2.roster) assert.deepEqual(Object.keys(r).sort(), ['avatar', 'displayName', 'id']);
  const cred = await tc.get(`students/${roster[0].id}/private/credentials`);
  assert.equal(cred.pin, roster[0].pin);
  Object.assign(ctx, { cls, roster });
});

test('student login: wrong PIN errors, rewriting the same request as pending retries it', { timeout: 60000 }, async () => {
  const { cls, roster } = ctx;
  const sc = client();
  const user = await sc.anon();
  const s = roster[0];
  const wrong = s.pin === '0000' ? '9999' : '0000';
  const bad = await sc.request('studentLogins', { code: cls.code, studentId: s.id, pin: wrong }, user.uid);
  assert.equal(bad.status, 'error');
  assert.match(bad.error, /PIN/);
  assert.equal((await sc.claims()).role, undefined);
  // Retry: same doc id, status back to 'pending'.
  const ok = await sc.request('studentLogins', { code: cls.code, studentId: s.id, pin: s.pin }, user.uid);
  assert.equal(ok.status, 'done', ok.error);
  assert.equal(ok.pin, undefined, 'PIN scrubbed from the request');
  const claims = await sc.claims();
  assert.equal(claims.role, 'student');
  assert.equal(claims.studentId, s.id);
  assert.equal(claims.classroomId, cls.classroomId);
  // A completed login can't be rewritten (only errored ones may retry).
  const { setDoc } = require('firebase/firestore');
  await assert.rejects(
    setDoc(doc(sc.db, `studentLogins/${user.uid}`), { code: cls.code, studentId: roster[1].id, pin: roster[1].pin, uid: user.uid, status: 'pending', createdAt: serverTimestamp() })
  );
  Object.assign(ctx, { sc, student: s });
});

test('assignment played through: progress completed, summary written, totals reconcile with events', { timeout: 240000 }, async () => {
  const { tc, t, cls, sc, student } = ctx;
  const aref = await addDoc(collection(tc.db, 'assignments'), {
    classroomId: cls.classroomId,
    teacherUid: t.uid,
    title: 'Warm-up quest',
    mode: 'practice',
    category: null,
    setId: null,
    difficulty: null,
    count: 3,
    personaId: null,
    dueAt: Date.now() + 7 * 86400000,
    targets: { type: 'class', ids: [] },
    createdAt: serverTimestamp(),
    archived: false
  });
  // The student sees the assignment (same class).
  const a = await sc.get(`assignments/${aref.id}`);
  assert.equal(a.title, 'Warm-up quest');

  const req = await sc.request('sessionRequests', { mode: 'practice', options: { assignmentId: aref.id, readingSpeed: 'fast' } });
  assert.equal(req.status, 'done', req.error);
  const sid = req.result.sessionId;
  let s = await sc.get(`sessions/${sid}`);
  assert.equal(s.assignmentId, aref.id);
  assert.equal(s.total, 3);
  await sc.command(sid, 'start', {}, student.id);

  // q0: buzz + correct answer; q1: buzz + a "close" answer (contains the answer); q2: skip.
  const plan = {};
  const closeGiven = {};
  s = await drive(sc, sid, student.id, async (st) => {
    if (st.status === 'READING_CLUE' && !plan[st.qIndex]) {
      plan[st.qIndex] = 'buzzed';
      if (st.qIndex === 2) {
        plan[st.qIndex] = 'skipped';
        return { type: 'skip' };
      }
      return { type: 'buzz', payload: { seenClueIndex: st.current.clues.length - 1 } };
    }
    if (st.status === 'AWAITING_ANSWER' && st.current.buzz?.actorId === student.id && plan[st.qIndex] === 'buzzed') {
      plan[st.qIndex] = 'answered';
      const key = await answerKey(st.current.questionId);
      if (st.qIndex === 0) return { type: 'answer', payload: { text: key.canonicalAnswer } };
      closeGiven.text = `maybe ${key.canonicalAnswer}`;
      closeGiven.questionId = st.current.questionId;
      return { type: 'answer', payload: { text: closeGiven.text } };
    }
    if (st.status === 'BONUS') return { type: 'skip' };
    return null;
  });
  assert.equal(s.status, 'COMPLETE');
  assert.equal(s.history.length, 3);
  assert.equal(s.history[0].attempts[0].result, 'correct');
  assert.equal(s.history[1].attempts[0].result, 'incorrect');
  assert.equal(s.history[1].attempts[0].flaggedClose, true, `"${closeGiven.text}" should be flagged close`);

  const summary = await sc.waitDoc(`sessionSummaries/${sid}_${student.id}`, (d) => !!d, 30000);
  assert.equal(summary.assignmentId, aref.id);
  assert.equal(summary.seen, 3);
  assert.equal(summary.answered, 2);
  assert.equal(summary.correct, 1);

  const progress = await tc.waitDoc(`assignments/${aref.id}/progress/${student.id}`, (d) => d?.completed === true, 30000);
  assert.equal(progress.sessions, 1);
  assert.equal(progress.bestAccuracy, 50);

  // Dashboard totals reconcile with the teacher-readable event log.
  const teacherSummary = await tc.get(`sessionSummaries/${sid}_${student.id}`);
  const evs = (await getDocs(query(collection(tc.db, `sessions/${sid}/events`), orderBy('__name__')))).docs.map((d) => d.data());
  const mine = evs.filter((e) => e.type === 'answer' && e.actor === student.id);
  assert.equal(new Set(mine.map((e) => e.data.questionId)).size, teacherSummary.answered);
  assert.equal(mine.filter((e) => e.data.result === 'correct').length, teacherSummary.correct);
  assert.equal(mine.filter((e) => e.data.close).length, 1);
  assert.ok(evs.some((e) => e.type === 'session_complete'));
  const classSummaries = await listWhere(tc, 'sessionSummaries', 'classroomId', cls.classroomId);
  assert.ok(classSummaries.some((x) => x.id === `${sid}_${student.id}`));
  Object.assign(ctx, { sid, closeGiven, summary });
});

test('teacher accepts the close answer: status accepted, student XP and summary go up', { timeout: 90000 }, async () => {
  const { tc, t, cls, sc, student, sid, closeGiven, summary } = ctx;
  const review = await until(async () => {
    const rows = await listWhere(tc, 'answerReviews', 'classroomId', cls.classroomId);
    return rows.find((r) => r.sessionId === sid && r.studentId === student.id);
  }, 30000, 500, 'answerReview');
  assert.equal(review.status, 'pending');
  assert.equal(review.given, closeGiven.text);
  assert.equal(review.questionId, closeGiven.questionId);
  assert.equal(review.teacherUid, t.uid);
  // Students can't see or decide reviews.
  await assert.rejects(sc.get(`answerReviews/${review.id}`));

  const before = await sc.get(`students/${student.id}`);
  // Teacher may only set decision fields, not points.
  await assert.rejects(updateDoc(doc(tc.db, `answerReviews/${review.id}`), { decision: 'accept', decidedBy: t.uid, potentialXp: 9999 }));
  await updateDoc(doc(tc.db, `answerReviews/${review.id}`), { decision: 'accept', decidedBy: t.uid, decidedAt: serverTimestamp() });
  const decided = await tc.waitDoc(`answerReviews/${review.id}`, (d) => d.status !== 'pending', 30000);
  assert.equal(decided.status, 'accepted');
  const after = await sc.waitDoc(`students/${student.id}`, (d) => (d.xp || 0) > (before.xp || 0), 30000);
  assert.equal(after.xp, (before.xp || 0) + review.potentialXp);
  const sum2 = await sc.get(`sessionSummaries/${sid}_${student.id}`);
  assert.equal(sum2.correct, summary.correct + 1);
  assert.equal(sum2.overturned, 1);
  // A decided review can't be flipped.
  await assert.rejects(updateDoc(doc(tc.db, `answerReviews/${review.id}`), { decision: 'reject', decidedBy: t.uid, decidedAt: serverTimestamp() }));
});
