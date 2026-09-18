'use strict';

// Privacy: parent link via a teacher invite, export, governed deletion approved
// by the school admin, and the audit trail.

const test = require('node:test');
const assert = require('node:assert/strict');
const { collection, doc, setDoc, addDoc, getDocs, query, where, serverTimestamp, increment, updateDoc } = require('firebase/firestore');
const { clientPool, classFixture, loginStudent, quickPractice, randomCode, uniq, until, listWhere, admin } = require('./fixtures');
const { waitFor } = require('./client');

const client = clientPool();
test.after(() => client.closeAll());

const ctx = {};

test('setup: student plays and saves a review card; parent links with a teacher invite', { timeout: 120000 }, async () => {
  const fx = await classFixture(client, { students: ['Pia', 'Quin'], tag: 'privacy' });
  const kid = fx.roster[0];
  const sc = client();
  await loginStudent(sc, fx.cls.code, kid);
  // An open team quest the student contributes to (records their alias in quest.names).
  const questRef = await addDoc(collection(fx.tc.db, 'teamQuests'), {
    classroomId: fx.cls.classroomId,
    teamId: null,
    title: 'Answer 100 questions',
    category: null,
    metric: 'answered',
    target: 100,
    startsAt: Date.now() - 86400000,
    endsAt: Date.now() + 7 * 86400000,
    progress: 0,
    contributions: {},
    createdBy: fx.teacher.uid,
    createdAt: serverTimestamp()
  });
  const played = await quickPractice(sc, kid.id, { answerText: 'no idea at all' });
  const quest = await fx.tc.waitDoc(`teamQuests/${questRef.id}`, (d) => d.progress >= 1, 30000);
  assert.equal(quest.contributions[kid.id], 1);
  assert.equal(quest.names[kid.id], kid.name);
  // Save the question to the Review Deck the way lib/game.js does.
  const h = played.session.history[0];
  await setDoc(doc(sc.db, `students/${kid.id}/reviewDeck/${h.questionId}`), {
    questionId: h.questionId,
    category: h.category,
    subcategory: h.subcategory,
    clues: h.allClues,
    canonicalAnswer: h.canonicalAnswer,
    acceptedAnswers: [],
    explanation: h.explanation,
    savedAt: serverTimestamp()
  });
  await updateDoc(doc(sc.db, `students/${kid.id}`), { reviewDeckCount: increment(1) });

  const code = randomCode(8);
  await setDoc(doc(fx.tc.db, `parentInvites/${code}`), { studentId: kid.id, classroomId: fx.cls.classroomId, teacherUid: fx.teacher.uid, expiresAt: Date.now() + 14 * 86400000, usedBy: null, createdAt: serverTimestamp() });
  const p = client();
  const parent = await p.register(`${uniq('family')}@example.com`, 'parentpass123');
  const linked = await p.request('parentRequests', { type: 'link', code });
  assert.equal(linked.status, 'done', linked.error);
  assert.equal(linked.result.studentId, kid.id);
  assert.deepEqual((await p.claims()).students, [kid.id]);
  const invite = await fx.tc.get(`parentInvites/${code}`);
  assert.equal(invite.usedBy, parent.uid);
  Object.assign(ctx, { fx, kid, sc, played, p, parent, code, questRef });
});

async function privacyRequest(p, studentId, type) {
  const ref = await addDoc(collection(p.db, 'privacyRequests'), {
    uid: p.auth.currentUser.uid,
    requesterRole: 'parent',
    studentId,
    type,
    details: '',
    status: 'pending',
    createdAt: serverTimestamp()
  });
  return ref;
}

test('parent export returns JSON with the alias and sessions', { timeout: 60000 }, async () => {
  const { p, kid, played } = ctx;
  const ref = await privacyRequest(p, kid.id, 'export');
  const done = await waitFor(ref, (d) => d && d.status !== 'pending', 30000);
  assert.equal(done.status, 'done');
  const data = JSON.parse(done.result.export);
  assert.equal(data.profile.id, kid.id);
  assert.equal(data.profile.displayName, kid.name);
  assert.ok(data.sessions.some((s) => s.sessionId === played.sessionId));
  assert.equal(data.reviewDeck.length, 1);
  assert.equal(data.linkedFamilyAccounts, 1);
  assert.equal(data.profile.recentQuestionIds, undefined, 'internal fields stay out of the export');

  // A teacher at another school can file the request (rules can't see the student's school)
  // but the server rejects it without exporting anything.
  const other = await classFixture(client, { students: ['Ozzy'], tag: 'privacy-other' });
  const xref = await addDoc(collection(other.tc.db, 'privacyRequests'), { uid: other.teacher.uid, requesterRole: 'teacher', studentId: kid.id, type: 'export', details: '', status: 'pending', createdAt: serverTimestamp() });
  const rejected = await waitFor(xref, (d) => d && d.status !== 'pending', 30000);
  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.result, undefined);
  assert.equal(rejected.studentName, undefined);
  ctx.other = other;
});

test('deletion: pending until the school admin approves, then everything is gone and audited', { timeout: 120000 }, async () => {
  const { fx, p, parent, kid, played, code, questRef } = ctx;
  const ref = await privacyRequest(p, kid.id, 'deletion');
  // The trigger stamps school/class ids and leaves the request pending for a decision.
  const pending = await waitFor(ref, (d) => d && d.schoolId, 30000);
  assert.equal(pending.status, 'pending');
  assert.equal(pending.schoolId, fx.teacher.schoolId);
  // Nothing deleted yet.
  assert.ok(await p.get(`students/${kid.id}`));

  // The parent can't approve their own request; another school's admin can't either.
  const self = await p.request('adminActions', { action: 'decidePrivacy', requestId: ref.id, decision: 'approve' });
  assert.equal(self.status, 'error');
  const other = ctx.other;
  const cross = await other.tc.request('adminActions', { action: 'decidePrivacy', requestId: ref.id, decision: 'approve' });
  assert.equal(cross.status, 'error');
  await assert.rejects(other.tc.get(`privacyRequests/${ref.id}`));
  assert.equal((await fx.tc.get(`privacyRequests/${ref.id}`)).status, 'pending');

  // School admin (the fixture teacher created the school) approves.
  const decided = await fx.tc.request('adminActions', { action: 'decidePrivacy', requestId: ref.id, decision: 'approve' });
  assert.equal(decided.status, 'done', decided.error);
  const finished = await fx.tc.waitDoc(`privacyRequests/${ref.id}`, (d) => d.status === 'done', 60000);
  assert.equal(finished.studentName, 'Deleted student');
  assert.ok(finished.result.deleted.summaries >= 1);

  const pa = client();
  await pa.email('admin@quizquest.test', 'quizquest123');
  assert.equal(await pa.get(`students/${kid.id}`), undefined, 'student doc gone');
  assert.equal(await pa.get(`sessionSummaries/${played.sessionId}_${kid.id}`), undefined, 'summary gone');
  assert.equal((await listWhere(pa, 'sessionSummaries', 'studentId', kid.id)).length, 0);
  assert.equal(await pa.get(`guardianLinks/${parent.uid}_${kid.id}`), undefined, 'guardian link gone');
  assert.equal(await pa.get(`sessions/${played.sessionId}`), undefined, 'solo session gone');
  // Server-only / student-only subcollections: check with the Admin SDK.
  const db = admin();
  assert.equal((await db.collection(`students/${kid.id}/reviewDeck`).get()).size, 0, 'review deck gone');
  assert.equal((await db.doc(`students/${kid.id}/private/credentials`).get()).exists, false);
  assert.equal((await db.doc(`sessionSecrets/${played.sessionId}`).get()).exists, false);
  assert.equal((await db.doc(`parentInvites/${code}`).get()).exists, false);
  // Leaderboard entry removed; classmates untouched.
  const lb = await pa.get(`leaderboards/${fx.cls.classroomId}_${played.summary.weekKey}`);
  assert.ok(!lb.entries.some((e) => e.studentId === kid.id));
  assert.ok(await pa.get(`students/${fx.roster[1].id}`));
  // Team quest keeps its aggregate progress but no longer names or credits the child.
  const quest = await fx.tc.get(`teamQuests/${questRef.id}`);
  assert.equal(quest.contributions[kid.id], undefined);
  assert.equal((quest.names || {})[kid.id], undefined, 'child alias scrubbed from team quest');

  // Parent claims drop the child; the parent can no longer read anything about them.
  const claims = await until(async () => {
    const c = await p.claims();
    return (c.students || []).includes(kid.id) ? null : c;
  }, 20000, 500, 'parent claims refresh');
  assert.deepEqual(claims.students, []);
  await assert.rejects(p.get(`sessionSummaries/${played.sessionId}_${kid.id}`));

  // Audit trail, readable by the platform admin; no child name in it.
  const events = await getDocs(query(collection(pa.db, 'auditEvents'), where('target', '==', `privacyRequests/${ref.id}`)));
  const completed = events.docs.map((d) => d.data()).find((e) => e.action === 'privacy.deletion_completed');
  assert.ok(completed, 'privacy.deletion_completed audited');
  assert.equal(completed.schoolId, fx.teacher.schoolId);
  assert.ok(!JSON.stringify(completed).includes(kid.name), 'no child alias in audit details');
  assert.ok(events.docs.some((d) => d.data().action === 'privacy.deletion_requested'));
});
