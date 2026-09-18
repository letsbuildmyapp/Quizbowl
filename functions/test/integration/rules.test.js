'use strict';

// Authorization: what each role can and can't read/write, enforced by
// firestore.rules against the running emulator.

const test = require('node:test');
const assert = require('node:assert/strict');
const { collection, doc, setDoc, addDoc, updateDoc, getDoc, getDocs, query, where, deleteDoc, serverTimestamp, increment } = require('firebase/firestore');
const { clientPool, classFixture, loginStudent, quickPractice, listWhere, randomCode, uniq } = require('./fixtures');
const { weekKey } = require('../../engine/progression');

const client = clientPool();
test.after(() => client.closeAll());

const denied = (p) => assert.rejects(p, (e) => e.code === 'permission-denied', 'expected permission-denied');
const ctx = {};

test('setup: class A (3 students, one played a match) and an unrelated class B', { timeout: 180000 }, async () => {
  const A = await classFixture(client, { students: ['Ann', 'Bo', 'Cal'], tag: 'rulesA' });
  const B = await classFixture(client, { students: ['Zed'], tag: 'rulesB' });
  const s1 = client();
  await loginStudent(s1, A.cls.code, A.roster[0]);
  const s2 = client();
  await loginStudent(s2, A.cls.code, A.roster[1]);
  const played = await quickPractice(s2, A.roster[1].id);
  const zc = client();
  await loginStudent(zc, B.cls.code, B.roster[0]);
  Object.assign(ctx, { A, B, s1, s2, zc, played });
});

test('student: no other class, no other sessions, secrets, credentials or classmates summaries', { timeout: 60000 }, async () => {
  const { A, B, s1, played } = ctx;
  const me = A.roster[0];
  assert.equal((await s1.get(`students/${me.id}`)).displayName, me.name);
  await denied(s1.get(`students/${B.roster[0].id}`)); // another class
  await denied(s1.get(`students/${A.roster[1].id}`)); // a classmate's profile
  await denied(getDocs(query(collection(s1.db, 'students'), where('classroomId', '==', B.cls.classroomId))));
  await denied(s1.get(`classrooms/${B.cls.classroomId}`));
  await denied(s1.get(`sessions/${played.sessionId}`)); // not a participant
  await denied(getDocs(collection(s1.db, `sessions/${played.sessionId}/events`)));
  await denied(s1.get(`sessionSecrets/${played.sessionId}`));
  await denied(s1.get(`students/${me.id}/private/credentials`));
  await denied(s1.get(`students/${A.roster[1].id}/private/credentials`));
  await denied(s1.get(`sessionSummaries/${played.sessionId}_${A.roster[1].id}`)); // classmate's summary
  await denied(getDocs(query(collection(s1.db, 'sessionSummaries'), where('classroomId', '==', A.cls.classroomId))));
  // Own summary id that doesn't exist yet is a harmless get (the waiting screen relies on this).
  assert.equal(await s1.get(`sessionSummaries/nosuchsession_${me.id}`), undefined);
  // The player can read their own.
  assert.equal((await ctx.s2.get(`sessionSummaries/${played.sessionId}_${A.roster[1].id}`)).studentId, A.roster[1].id);
});

test('student: server fields and server collections are read-only; commands are stamped and scoped', { timeout: 60000 }, async () => {
  const { A, s1, s2, played } = ctx;
  const me = A.roster[0];
  const ref = doc(s1.db, `students/${me.id}`);
  await denied(updateDoc(ref, { xp: 99999 }));
  await denied(updateDoc(ref, { badges: ['champion'] }));
  await denied(updateDoc(ref, { 'stats.correct': 500 }));
  await denied(updateDoc(ref, { level: 50 }));
  await denied(updateDoc(ref, { displayName: 'Boss' }));
  await updateDoc(ref, { leaderboardOptOut: false, settings: { readAloud: true } }); // allowed prefs

  await denied(setDoc(doc(s1.db, 'sessions/forged-session'), { participantIds: [me.id], status: 'COMPLETE' }));
  await denied(setDoc(doc(s1.db, `sessionSummaries/forged_${me.id}`), { studentId: me.id, xpEarned: 1000 }));
  await denied(setDoc(doc(s1.db, `leaderboards/${A.cls.classroomId}_${weekKey(Date.now())}`), { entries: [] }));
  await denied(setDoc(doc(s1.db, `teamboards/${A.cls.classroomId}_${weekKey(Date.now())}`), { teams: [] }));
  await denied(setDoc(doc(s1.db, `assignments/${played.sessionId}/progress/${me.id}`), { completed: true }));
  await denied(addDoc(collection(s1.db, 'answerReviews'), { studentId: me.id, status: 'pending' }));
  // Session requests may not smuggle extra fields (e.g. a chosen studentId).
  await denied(addDoc(collection(s1.db, 'sessionRequests'), { mode: 'versus', options: {}, studentId: A.roster[1].id, uid: s1.auth.currentUser.uid, status: 'pending', createdAt: serverTimestamp() }));
  // Students can't host a live battle directly (rule allows; server must refuse).
  const lb = await s1.request('sessionRequests', { mode: 'live_battle', options: { classroomId: A.cls.classroomId } });
  assert.equal(lb.status, 'error');

  // A session of my own to command.
  const req = await s1.request('sessionRequests', { mode: 'practice', options: { count: 1 } });
  assert.equal(req.status, 'done', req.error);
  const sid = req.result.sessionId;
  const cmds = collection(s1.db, `sessions/${sid}/commands`);
  const base = { type: 'buzz', payload: {}, uid: s1.auth.currentUser.uid, actorId: me.id, role: 'student' };
  await denied(setDoc(doc(cmds), { ...base, at: new Date(0) })); // forged time
  await denied(setDoc(doc(cmds), { ...base, at: new Date(Date.now() + 60000) }));
  await denied(setDoc(doc(cmds), { ...base, at: serverTimestamp(), actorId: A.roster[1].id })); // someone else
  await denied(setDoc(doc(cmds), { ...base, at: serverTimestamp(), role: 'teacher' })); // wrong role
  await denied(setDoc(doc(cmds), { ...base, at: serverTimestamp(), uid: 'someone-else' }));
  await denied(setDoc(doc(cmds), { ...base, at: serverTimestamp(), type: 'award_points' }));
  await setDoc(doc(cmds), { ...base, type: 'sync', at: serverTimestamp() }); // well-formed is fine
  // A classmate can't command my session.
  await denied(s2.command(sid, 'start', {}, A.roster[1].id));
  await denied(setDoc(doc(s1.db, `sessions/${sid}`), { status: 'COMPLETE' }, { merge: true }));
});

test('parent: only the linked child and their summaries, nothing classmate-level', { timeout: 90000 }, async () => {
  const { A, played } = ctx;
  const child = A.roster[1]; // the one who played
  const code = randomCode(8);
  await setDoc(doc(A.tc.db, `parentInvites/${code}`), { studentId: child.id, classroomId: A.cls.classroomId, teacherUid: A.teacher.uid, expiresAt: Date.now() + 86400000, usedBy: null, createdAt: serverTimestamp() });
  const p = client();
  await p.register(`${uniq('parent')}@example.com`, 'parentpass123');
  // Before linking: nothing.
  await denied(p.get(`students/${child.id}`));
  const linked = await p.request('parentRequests', { type: 'link', code });
  assert.equal(linked.status, 'done', linked.error);
  const claims = await p.claims();
  assert.equal(claims.role, 'parent');
  assert.deepEqual(claims.students, [child.id]);

  assert.equal((await p.get(`students/${child.id}`)).displayName, child.name);
  assert.equal((await p.get(`sessionSummaries/${played.sessionId}_${child.id}`)).studentId, child.id);
  const sums = await listWhere(p, 'sessionSummaries', 'studentId', child.id);
  assert.ok(sums.length >= 1);
  assert.equal((await p.get(`guardianLinks/${p.auth.currentUser.uid}_${child.id}`)).status, 'active');

  await denied(p.get(`students/${A.roster[0].id}`)); // classmate
  await denied(p.get(`students/${child.id}/private/credentials`));
  await denied(getDocs(query(collection(p.db, 'students'), where('classroomId', '==', A.cls.classroomId))));
  await denied(getDocs(query(collection(p.db, 'sessionSummaries'), where('classroomId', '==', A.cls.classroomId))));
  await denied(p.get(`leaderboards/${A.cls.classroomId}_${played.summary.weekKey}`));
  await denied(p.get(`teamboards/${A.cls.classroomId}_${played.summary.weekKey}`));
  await denied(p.get(`sessions/${played.sessionId}`)); // class sessions
  await denied(getDocs(collection(p.db, `sessions/${played.sessionId}/events`)));
  await denied(p.get(`classrooms/${A.cls.classroomId}`));
  await denied(getDocs(query(collection(p.db, 'assignments'), where('classroomId', '==', A.cls.classroomId))));
  // Can't file privacy requests for someone else's child.
  await denied(addDoc(collection(p.db, 'privacyRequests'), { uid: p.auth.currentUser.uid, requesterRole: 'parent', studentId: A.roster[0].id, type: 'export', details: '', status: 'pending', createdAt: serverTimestamp() }));
  // Invite code is single use.
  const p2 = client();
  await p2.register(`${uniq('parent2')}@example.com`, 'parentpass123');
  const reuse = await p2.request('parentRequests', { type: 'link', code });
  assert.equal(reuse.status, 'error');
});

test("teacher: can't read another teacher's classroom, students, sessions or credentials", { timeout: 60000 }, async () => {
  const { A, B, played } = ctx;
  const other = B.tc; // a teacher at a different school
  await denied(other.get(`classrooms/${A.cls.classroomId}`));
  await denied(other.get(`students/${A.roster[0].id}`));
  await denied(other.get(`students/${A.roster[0].id}/private/credentials`));
  await denied(setDoc(doc(other.db, `students/${A.roster[0].id}/private/credentials`), { pin: '1234' }));
  await denied(other.get(`sessions/${played.sessionId}`));
  await denied(getDocs(collection(other.db, `sessions/${played.sessionId}/events`)));
  await denied(other.get(`sessionSummaries/${played.sessionId}_${A.roster[1].id}`));
  await denied(getDocs(query(collection(other.db, 'students'), where('classroomId', '==', A.cls.classroomId))));
  await denied(other.get(`leaderboards/${A.cls.classroomId}_${played.summary.weekKey}`));
  await denied(other.get(`schools/${A.teacher.schoolId}`));
  // Can't add students to someone else's class or move a class to another teacher.
  await denied(addDoc(collection(other.db, 'students'), { classroomId: A.cls.classroomId, schoolId: B.teacher.schoolId, teacherUid: B.teacher.uid, displayName: 'Mole', active: true }));
  await denied(updateDoc(doc(A.tc.db, `classrooms/${A.cls.classroomId}`), { teacherUid: B.teacher.uid }));
  // Can't host a live battle for another teacher's class.
  const lb = await other.request('sessionRequests', { mode: 'live_battle', options: { classroomId: A.cls.classroomId, teamA: { name: 'x', studentIds: [A.roster[0].id] }, teamB: { name: 'y', studentIds: [A.roster[1].id] }, count: 3 } });
  assert.equal(lb.status, 'error');
  // The owner can.
  assert.equal((await A.tc.get(`students/${A.roster[0].id}/private/credentials`)).pin, A.roster[0].pin);
  assert.equal((await A.tc.get(`sessions/${played.sessionId}`)).id, played.sessionId);
});

test('non-admin: no questions, sets, metrics, audit log, config', { timeout: 60000 }, async () => {
  const { A, s1 } = ctx;
  const t = A.tc;
  for (const c of [t, s1]) {
    await denied(getDocs(collection(c.db, 'questions')));
    await denied(c.get('questions/tu-sci-01'));
    await denied(getDocs(collection(c.db, 'questionSets')));
    await denied(getDocs(collection(c.db, 'metrics')));
    await denied(getDocs(collection(c.db, 'auditEvents')));
    await denied(c.get('config/opponents'));
    await denied(setDoc(doc(c.db, 'config/opponents'), { reactionFloorMs: { 0: 300, 1: 300, 2: 300, 3: 300 } }));
    await denied(addDoc(collection(c.db, 'questions'), { status: 'draft', type: 'tossup' }));
  }
  // A school admin reads their own school's audit trail only.
  const own = await listWhere(t, 'auditEvents', 'schoolId', A.teacher.schoolId);
  assert.ok(own.some((e) => e.action === 'school.created'));
  await denied(listWhere(t, 'auditEvents', 'schoolId', ctx.B.teacher.schoolId));
  // Teachers get aggregate content stats, not content.
  assert.ok((await t.get('contentStats/summary')).published);
  await denied(s1.get('contentStats/summary'));
});

test('content admin: no publishing without rights metadata, no skipping lifecycle steps', { timeout: 60000 }, async () => {
  const a = client();
  await a.email('admin@quizquest.test', 'quizquest123');
  const setRef = await addDoc(collection(a.db, 'questionSets'), { name: uniq('Rules set'), sourceOwner: 'QuizQuest tests', license: 'CC-BY-4.0', rightsNote: '', usageWindowEnd: null, createdBy: a.auth.currentUser.uid, createdAt: serverTimestamp() });
  const body = {
    type: 'tossup',
    category: 'Science',
    subcategory: 'Test',
    gradeBand: '4-5',
    difficulty: 1,
    promptLeadin: '',
    clues: [{ text: 'Rules test clue one about a zyzzyvaquark.', clueIndex: 0, difficultyWeight: 0.8 }, { text: 'For 10 points, name this made up rules particle.', clueIndex: 1, difficultyWeight: 0.2 }],
    powerClueIndex: 0,
    canonicalAnswer: `rulesparticle${Date.now()}`,
    acceptedAnswers: [],
    rejectedAnswers: [],
    approvedDistractors: [],
    explanation: '',
    version: 1,
    createdBy: a.auth.currentUser.uid
  };
  // Can't create straight into published.
  await denied(addDoc(collection(a.db, 'questions'), { ...body, status: 'published', setId: setRef.id, license: 'CC', sourceOwner: 'X' }));
  // Draft without rights metadata.
  const q = await addDoc(collection(a.db, 'questions'), { ...body, status: 'draft', setId: setRef.id });
  const move = (status, extra = {}) => updateDoc(q, { status, version: increment(1), updatedAt: serverTimestamp(), updatedBy: a.auth.currentUser.uid, ...extra });
  await denied(move('published', { license: 'CC-BY-4.0', sourceOwner: 'QuizQuest tests' })); // draft -> published skips steps
  await denied(move('approved')); // draft -> approved skips review
  await move('review');
  await denied(move('published', { license: 'CC-BY-4.0', sourceOwner: 'QuizQuest tests' })); // review -> published skips approval
  await move('approved');
  await denied(move('published')); // no license / sourceOwner
  await denied(move('published', { license: 'CC-BY-4.0' })); // no sourceOwner
  await denied(move('published', { license: '', sourceOwner: 'QuizQuest tests' })); // empty license
  await denied(move('published', { license: 'CC-BY-4.0', sourceOwner: 'QuizQuest tests', setId: null })); // no set
  await denied(updateDoc(q, { revertSeq: 5 })); // server-only field
  const cur = (await getDoc(q)).data();
  assert.equal(cur.status, 'approved');
  // Clean up: back to draft and delete (drafts are deletable).
  await move('draft');
  await deleteDoc(q);
  await deleteDoc(setRef);
});

test('class codes: anyone signed in can get a known code, nobody can list them', { timeout: 30000 }, async () => {
  const { A } = ctx;
  const anon = client();
  await anon.anon();
  const cc = await anon.get(`classCodes/${A.cls.code}`);
  assert.equal(cc.classroomId, A.cls.classroomId);
  await denied(getDocs(collection(anon.db, 'classCodes')));
  await denied(getDocs(query(collection(anon.db, 'classCodes'), where('classroomId', '==', A.cls.classroomId))));
  await denied(setDoc(doc(anon.db, `classCodes/${randomCode(6)}`), { classroomId: 'x', roster: [] }));
  const nobody = client(); // not signed in at all
  await denied(nobody.get(`classCodes/${A.cls.code}`));
  // Anonymous users can't become teachers or parents.
  await denied(setDoc(doc(anon.db, `teacherRequests/${anon.auth.currentUser.uid}`), { schoolName: 'x', uid: anon.auth.currentUser.uid, status: 'pending', createdAt: serverTimestamp() }));
});

test('pilot requests: unauthenticated create only with the exact schema, never readable', { timeout: 30000 }, async () => {
  const c = client(); // no sign-in
  const good = { name: 'Rules Test', role: 'teacher', school: 'Test Elementary', email: 'pilot@example.com', students: '25', message: 'integration test', createdAt: serverTimestamp() };
  await addDoc(collection(c.db, 'pilotRequests'), good);
  await denied(addDoc(collection(c.db, 'pilotRequests'), { ...good, contacted: true })); // extra field
  await denied(addDoc(collection(c.db, 'pilotRequests'), { ...good, email: 'not-an-email' }));
  await denied(addDoc(collection(c.db, 'pilotRequests'), { ...good, name: '' }));
  const { name, ...noName } = good;
  await denied(addDoc(collection(c.db, 'pilotRequests'), noName));
  await denied(addDoc(collection(c.db, 'pilotRequests'), { ...good, message: 'x'.repeat(3001) }));
  await denied(getDocs(collection(c.db, 'pilotRequests')));
  await denied(getDocs(collection(ctx.A.tc.db, 'pilotRequests')));
});

test('leaderboard visibility follows classroom settings.leaderboard (off / teams / class)', { timeout: 90000 }, async () => {
  const { A, s1, played } = ctx;
  const cid = A.cls.classroomId;
  const existing = `${cid}_${played.summary.weekKey}`; // written when roster[1] finished a match
  const future = `${cid}_2099-W01`; // doesn't exist
  const setMode = async (mode) => {
    const cls = await A.tc.get(`classrooms/${cid}`);
    await updateDoc(doc(A.tc.db, `classrooms/${cid}`), { settings: { ...cls.settings, leaderboard: mode } });
  };
  assert.ok((await A.tc.get(`leaderboards/${existing}`)).entries.length >= 1);

  await setMode('off');
  for (const id of [existing, future]) {
    await denied(s1.get(`leaderboards/${id}`));
    await denied(s1.get(`teamboards/${id}`));
  }
  await setMode('teams');
  for (const id of [existing, future]) await denied(s1.get(`leaderboards/${id}`));
  await getDoc(doc(s1.db, `teamboards/${existing}`));
  assert.equal((await getDoc(doc(s1.db, `teamboards/${future}`))).exists(), false); // allowed, just empty
  await setMode('class');
  const lb = await s1.get(`leaderboards/${existing}`);
  assert.ok(lb.entries.some((e) => e.studentId === A.roster[1].id));
  assert.equal((await getDoc(doc(s1.db, `leaderboards/${future}`))).exists(), false);
  assert.equal((await getDoc(doc(s1.db, `teamboards/${future}`))).exists(), false);
  // Another class's board is never visible, whatever its setting.
  await denied(s1.get(`leaderboards/${ctx.B.cls.classroomId}_${played.summary.weekKey}`));
  // The teacher always sees their own boards.
  await A.tc.get(`leaderboards/${future}`);
});
