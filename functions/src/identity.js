'use strict';

// Identity, roles, consent and admin actions. Each handler fulfils a request
// document the client created (see docs/DATA_MODEL.md).

const { onDocumentCreated, onDocumentWritten } = require('firebase-functions/v2/firestore');
const { db, auth, FieldValue, UserError, now, toMillis, setClaims, claimsOf, fulfil, audit, bumpMetric, randomCode, notify, DEFAULT_SCHOOL_SETTINGS } = require('./common');

const MAX_PIN_FAILS = 5;

/** Only act when a request newly enters 'pending' (not on our own follow-up writes). */
function becamePending(event) {
  const before = event.data.before.exists ? event.data.before.data() : null;
  const after = event.data.after.exists ? event.data.after.data() : null;
  return !!after && after.status === 'pending' && (!before || before.status !== 'pending');
}
const LOCK_MS = 10 * 60 * 1000;

// ---------------------------------------------------------------------------
// Students: class code + pick your name + 4-digit PIN. The device signs in
// anonymously and gets student claims; data is keyed by the student profile.

// Written (not just created): a device can retry after an error by rewriting its request.
exports.onStudentLogin = onDocumentWritten('studentLogins/{uid}', (event) =>
  becamePending(event) &&
  fulfil(event.data.after, async (data, ref) => {
    const uid = event.params.uid;
    const code = String(data.code || '').toUpperCase().trim();
    const studentId = String(data.studentId || '');
    const pin = String(data.pin || '');
    // Never keep the PIN in the request document.
    await ref.update({ pin: FieldValue.delete() });

    const codeSnap = await db.doc(`classCodes/${code}`).get();
    if (!codeSnap.exists) throw new UserError("That class code doesn't match any class. Check with your teacher.");
    const cc = codeSnap.data();
    if (cc.expiresAt && cc.expiresAt < now()) throw new UserError('That class code has expired. Ask your teacher for a new one.');

    const studentRef = db.doc(`students/${studentId}`);
    const [studentSnap, credSnap] = await Promise.all([studentRef.get(), db.doc(`students/${studentId}/private/credentials`).get()]);
    const student = studentSnap.data();
    if (!student || student.classroomId !== cc.classroomId || student.active === false) {
      throw new UserError("We couldn't find you in that class. Ask your teacher.");
    }

    const throttleRef = db.doc(`loginThrottle/${studentId}`);
    const throttle = (await throttleRef.get()).data() || { fails: 0, lockedUntil: 0 };
    if (throttle.lockedUntil > now()) {
      throw new UserError('Too many tries. Take a short break and try again in a few minutes, or ask your teacher.');
    }
    if (!credSnap.exists || credSnap.data().pin !== pin) {
      const fails = (throttle.fails || 0) + 1;
      await throttleRef.set({ fails: fails >= MAX_PIN_FAILS ? 0 : fails, lockedUntil: fails >= MAX_PIN_FAILS ? now() + LOCK_MS : 0 });
      await bumpMetric({ deniedAccess: 1 });
      throw new UserError("That PIN didn't match. Try again, or ask your teacher if you forgot it.");
    }
    await throttleRef.delete().catch(() => {});

    await setClaims(uid, { role: 'student', studentId, classroomId: student.classroomId, schoolId: student.schoolId }, { replace: true });
    await db.doc(`students/${studentId}/private/devices`).set({ uids: FieldValue.arrayUnion(uid), lastLoginAt: now() }, { merge: true });
    return { studentId, classroomId: student.classroomId };
  })
);

// ---------------------------------------------------------------------------
// Teachers: create a school (becomes its admin) or join one with a code (pending approval).

exports.onTeacherRequest = onDocumentWritten('teacherRequests/{uid}', (event) =>
  becamePending(event) &&
  fulfil(event.data.after, async (data) => {
    const uid = event.params.uid;
    const claims = await claimsOf(uid);
    if (!claims._email) throw new UserError('Sign in with an email account to set up a teacher account.');
    if (claims.role === 'student' || claims.role === 'parent') throw new UserError('This account is already set up for a different role. Use a separate teacher account.');
    if (claims.role === 'teacher') return { schoolId: claims.schoolId, status: 'approved' };
    const displayName = String(data.displayName || '').trim().slice(0, 80) || claims._email.split('@')[0];

    if (data.schoolName) {
      const name = String(data.schoolName).trim().slice(0, 120);
      if (!name) throw new UserError('Enter your school name.');
      const schoolRef = db.collection('schools').doc();
      await schoolRef.set({ name, adminUids: [uid], teacherJoinCode: randomCode(8), settings: { ...DEFAULT_SCHOOL_SETTINGS }, createdAt: now(), createdBy: uid });
      await schoolRef.collection('teachers').doc(uid).set({ displayName, email: claims._email, status: 'approved', isAdmin: true, requestedAt: now(), approvedAt: now() });
      await db.doc(`users/${uid}`).set({ displayName, email: claims._email, schoolId: schoolRef.id, createdAt: now() }, { merge: true });
      await setClaims(uid, { role: 'teacher', schoolId: schoolRef.id, schoolAdmin: true });
      await audit('school.created', { actorUid: uid, actorRole: 'teacher', target: `schools/${schoolRef.id}`, schoolId: schoolRef.id });
      return { schoolId: schoolRef.id, status: 'approved' };
    }

    const code = String(data.schoolJoinCode || '').toUpperCase().trim();
    if (!code) throw new UserError('Enter a school name or a school join code.');
    const match = await db.collection('schools').where('teacherJoinCode', '==', code).limit(1).get();
    if (match.empty) throw new UserError("That school code doesn't match. Ask your school's QuizQuest admin.");
    const school = match.docs[0];
    await school.ref.collection('teachers').doc(uid).set({ displayName, email: claims._email, status: 'pending', isAdmin: false, requestedAt: now() });
    await db.doc(`users/${uid}`).set({ displayName, email: claims._email, schoolId: school.id, createdAt: now() }, { merge: true });
    await setClaims(uid, { role: 'teacher_pending', schoolId: school.id });
    for (const adminUid of school.data().adminUids || []) {
      await notify({ toUid: adminUid, kind: 'teacher_request', title: 'New teacher request', body: `${displayName} asked to join your school.`, link: '/teach/school' });
    }
    await audit('school.teacher_requested', { actorUid: uid, actorRole: 'teacher_pending', target: `schools/${school.id}/teachers/${uid}`, schoolId: school.id });
    return { schoolId: school.id, status: 'pending' };
  })
);

// ---------------------------------------------------------------------------
// Parents: link with a teacher-issued invite code; grant or revoke consent.

exports.onParentRequest = onDocumentCreated('parentRequests/{id}', (event) =>
  fulfil(event.data, async (data) => {
    const uid = data.uid;
    const claims = await claimsOf(uid);
    if (!claims._email) throw new UserError('Sign in with your email first.');

    if (data.type === 'link') {
      if (claims.role && claims.role !== 'parent') throw new UserError('This account is set up for school use. Use a personal email for your family account.');
      const code = String(data.code || '').toUpperCase().trim();
      const inviteRef = db.doc(`parentInvites/${code}`);
      const invite = (await inviteRef.get()).data();
      if (!invite) throw new UserError("That family code doesn't match. Check the code from your child's teacher.");
      if (invite.expiresAt && invite.expiresAt < now()) throw new UserError('That family code has expired. Ask the teacher for a new one.');
      if (invite.usedBy && invite.usedBy !== uid) throw new UserError('That family code was already used. Ask the teacher for a new one.');
      const student = (await db.doc(`students/${invite.studentId}`).get()).data();
      if (!student) throw new UserError('That student is no longer in QuizQuest.');
      await db.doc(`guardianLinks/${uid}_${invite.studentId}`).set({ parentUid: uid, studentId: invite.studentId, classroomId: invite.classroomId, status: 'active', createdAt: now() });
      await inviteRef.update({ usedBy: uid, usedAt: now() });
      const students = Array.from(new Set([...(claims.students || []), invite.studentId]));
      await db.doc(`users/${uid}`).set({ email: claims._email, prefs: { weeklyEmail: false, notifications: { badges: true, weeklySummary: true } }, createdAt: now() }, { merge: true });
      await setClaims(uid, { role: 'parent', students });
      await audit('guardian.linked', { actorUid: uid, actorRole: 'parent', target: `students/${invite.studentId}`, schoolId: student.schoolId });
      return { studentId: invite.studentId, displayName: student.displayName };
    }

    if (data.type === 'consent') {
      const studentId = String(data.studentId || '');
      if (!(claims.students || []).includes(studentId)) throw new UserError('You can only manage consent for your linked child.');
      const grant = !!data.grant;
      await db.doc(`consents/${studentId}`).set({ status: grant ? 'granted' : 'revoked', parentUid: uid, version: 1, at: now() });
      const studentRef = db.doc(`students/${studentId}`);
      const student = (await studentRef.get()).data() || {};
      await studentRef.update({ consent: grant ? 'granted' : 'revoked' });
      await audit(grant ? 'consent.granted' : 'consent.revoked', { actorUid: uid, actorRole: 'parent', target: `students/${studentId}`, schoolId: student.schoolId });
      if (student.teacherUid) {
        await notify({ toUid: student.teacherUid, kind: 'consent', title: grant ? 'Family consent granted' : 'Family consent revoked', body: `${student.displayName}'s family ${grant ? 'approved' : 'revoked'} QuizQuest.`, link: `/teach/students/${studentId}` });
      }
      return { status: grant ? 'granted' : 'revoked' };
    }
    throw new UserError('Unknown request.');
  })
);

// ---------------------------------------------------------------------------
// Admin actions that change claims or cross ownership boundaries.

async function requireSchoolAdmin(uid, schoolId) {
  const claims = await claimsOf(uid);
  if (claims.platformAdmin) return claims;
  if (claims.role !== 'teacher' || !claims.schoolAdmin || claims.schoolId !== schoolId) throw new UserError('Only a school admin can do that.');
  return claims;
}

async function requirePlatformAdmin(uid) {
  const claims = await claimsOf(uid);
  if (!claims.platformAdmin) throw new UserError('Only a platform admin can do that.');
  return claims;
}

const actions = {
  async approveTeacher(data, uid) {
    await requireSchoolAdmin(uid, data.schoolId);
    const ref = db.doc(`schools/${data.schoolId}/teachers/${data.teacherUid}`);
    if (!(await ref.get()).exists) throw new UserError('Teacher not found.');
    await ref.update({ status: 'approved', approvedAt: now(), approvedBy: uid });
    await setClaims(data.teacherUid, { role: 'teacher', schoolId: data.schoolId });
    await notify({ toUid: data.teacherUid, kind: 'approved', title: "You're approved", body: 'Your school admin approved your QuizQuest teacher account.', link: '/teach' });
    await audit('school.teacher_approved', { actorUid: uid, actorRole: 'schoolAdmin', target: `schools/${data.schoolId}/teachers/${data.teacherUid}`, schoolId: data.schoolId });
    return { ok: true };
  },

  async suspendTeacher(data, uid) {
    await requireSchoolAdmin(uid, data.schoolId);
    if (data.teacherUid === uid) throw new UserError("You can't suspend yourself.");
    const ref = db.doc(`schools/${data.schoolId}/teachers/${data.teacherUid}`);
    await ref.update({ status: 'suspended', suspendedAt: now(), suspendedBy: uid });
    await setClaims(data.teacherUid, { role: 'teacher_pending', schoolId: data.schoolId, schoolAdmin: null });
    await db.doc(`schools/${data.schoolId}`).update({ adminUids: FieldValue.arrayRemove(data.teacherUid) });
    await audit('school.teacher_suspended', { actorUid: uid, actorRole: 'schoolAdmin', target: `schools/${data.schoolId}/teachers/${data.teacherUid}`, schoolId: data.schoolId });
    return { ok: true };
  },

  async joinChallenge(data, uid) {
    const claims = await claimsOf(uid);
    if (claims.role !== 'teacher') throw new UserError('Only teachers can join challenges.');
    const classroom = (await db.doc(`classrooms/${data.classroomId}`).get()).data();
    if (!classroom || classroom.teacherUid !== uid) throw new UserError('Pick one of your classes.');
    const code = String(data.code || '').toUpperCase().trim();
    const snap = await db.collection('challenges').where('inviteCode', '==', code).limit(1).get();
    if (snap.empty) throw new UserError("That challenge code doesn't match.");
    const ch = snap.docs[0];
    const c = ch.data();
    if (c.endsAt < now()) throw new UserError('That challenge has ended.');
    if (!c.schoolIds.includes(classroom.schoolId)) {
      const [host, mine] = await Promise.all([db.doc(`schools/${c.hostSchoolId}`).get(), db.doc(`schools/${classroom.schoolId}`).get()]);
      if (!host.data()?.settings?.allowCrossSchoolChallenges || !mine.data()?.settings?.allowCrossSchoolChallenges) {
        throw new UserError('Both schools need to allow cross-school challenges in their school settings.');
      }
    }
    const school = (await db.doc(`schools/${classroom.schoolId}`).get()).data() || {};
    await ch.ref.update({
      schoolIds: FieldValue.arrayUnion(classroom.schoolId),
      classroomIds: FieldValue.arrayUnion(data.classroomId),
      [`standings.${data.classroomId}`]: { className: classroom.name, schoolName: school.name || '', points: 0, correct: 0 }
    });
    await audit('challenge.joined', { actorUid: uid, actorRole: 'teacher', target: `challenges/${ch.id}`, schoolId: classroom.schoolId });
    return { challengeId: ch.id, name: c.name };
  },

  async setContentAdmin(data, uid) {
    await requirePlatformAdmin(uid);
    await setClaims(data.targetUid, { contentAdmin: data.value ? true : null });
    await audit('admin.content_admin', { actorUid: uid, actorRole: 'platformAdmin', target: `users/${data.targetUid}`, details: { value: !!data.value } });
    return { ok: true };
  },

  async setPlatformAdmin(data, uid) {
    await requirePlatformAdmin(uid);
    if (data.targetUid === uid && !data.value) throw new UserError("You can't remove your own admin access.");
    await setClaims(data.targetUid, { platformAdmin: data.value ? true : null });
    await audit('admin.platform_admin', { actorUid: uid, actorRole: 'platformAdmin', target: `users/${data.targetUid}`, details: { value: !!data.value } });
    return { ok: true };
  },

  async suspendUser(data, uid) {
    await requirePlatformAdmin(uid);
    if (data.targetUid === uid) throw new UserError("You can't suspend yourself.");
    await auth.updateUser(data.targetUid, { disabled: true });
    await auth.revokeRefreshTokens(data.targetUid);
    await db.doc(`users/${data.targetUid}`).set({ suspended: true }, { merge: true });
    await audit('admin.user_suspended', { actorUid: uid, actorRole: 'platformAdmin', target: `users/${data.targetUid}` });
    return { ok: true };
  },

  async unsuspendUser(data, uid) {
    await requirePlatformAdmin(uid);
    await auth.updateUser(data.targetUid, { disabled: false });
    await db.doc(`users/${data.targetUid}`).set({ suspended: false }, { merge: true });
    await audit('admin.user_unsuspended', { actorUid: uid, actorRole: 'platformAdmin', target: `users/${data.targetUid}` });
    return { ok: true };
  },

  async decidePrivacy(data, uid) {
    const ref = db.doc(`privacyRequests/${data.requestId}`);
    const req = (await ref.get()).data();
    if (!req) throw new UserError('Request not found.');
    const student = (await db.doc(`students/${req.studentId}`).get()).data();
    const claims = await claimsOf(uid);
    const allowed = claims.platformAdmin || (claims.schoolAdmin && claims.role === 'teacher' && student && claims.schoolId === student.schoolId);
    if (!allowed) throw new UserError('Only a school admin or platform admin can decide privacy requests.');
    const note = String(data.note || '').slice(0, 500);
    if (data.decision === 'reject') {
      await ref.update({ status: 'rejected', decidedBy: uid, decidedAt: now(), note });
      await audit('privacy.rejected', { actorUid: uid, actorRole: claims.platformAdmin ? 'platformAdmin' : 'schoolAdmin', target: `privacyRequests/${data.requestId}`, schoolId: student?.schoolId || null, details: { type: req.type } });
      return { status: 'rejected' };
    }
    await ref.update({ status: 'approved', decidedBy: uid, decidedAt: now(), note });
    // The privacy trigger performs the approved work (deletion/correction bookkeeping).
    return { status: 'approved' };
  }
};

exports.onAdminAction = onDocumentCreated('adminActions/{id}', (event) =>
  fulfil(event.data, async (data) => {
    const fn = actions[data.action];
    if (!fn) throw new UserError('Unknown action.');
    if (!data.uid) throw new UserError('Sign in first.');
    return fn(data, data.uid);
  })
);

exports._internal = { actions, toMillis };
