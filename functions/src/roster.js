'use strict';

// Keeps classCodes/{CODE} (what the student sign-in screen reads) in sync with
// classrooms and their rosters, and enforces join-code uniqueness.

const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { db, now, randomCode, audit, notify } = require('./common');

async function syncClassCode(classroomId) {
  const classSnap = await db.doc(`classrooms/${classroomId}`).get();
  const classroom = classSnap.data();
  if (!classroom?.joinCode) return;
  const code = String(classroom.joinCode).toUpperCase();
  const codeRef = db.doc(`classCodes/${code}`);
  const existing = (await codeRef.get()).data();
  if (existing && existing.classroomId !== classroomId) {
    // Collision: give this classroom a fresh code (this write re-triggers the sync).
    await classSnap.ref.update({ joinCode: randomCode(6) });
    return;
  }
  const students = await db.collection('students').where('classroomId', '==', classroomId).get();
  const roster = students.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((s) => s.active !== false)
    .map((s) => ({ id: s.id, displayName: s.displayName, avatar: s.avatar || '🙂' }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  await codeRef.set({
    classroomId,
    className: classroom.name || 'Class',
    expiresAt: classroom.joinCodeExpiresAt || null,
    selfJoin: classroom.settings?.selfJoin !== false,
    roster,
    updatedAt: now()
  });
}

exports.onClassroomWritten = onDocumentWritten('classrooms/{classroomId}', async (event) => {
  const before = event.data.before.data();
  const after = event.data.after.data();
  const { classroomId } = event.params;
  if (before?.joinCode && before.joinCode !== after?.joinCode) {
    const old = db.doc(`classCodes/${String(before.joinCode).toUpperCase()}`);
    const oldData = (await old.get()).data();
    if (oldData?.classroomId === classroomId) await old.delete();
  }
  if (!after) return;
  if (
    !before ||
    before.joinCode !== after.joinCode ||
    before.joinCodeExpiresAt !== after.joinCodeExpiresAt ||
    before.name !== after.name ||
    before.settings?.selfJoin !== after.settings?.selfJoin
  ) {
    await syncClassCode(classroomId);
  }
  if (before && JSON.stringify(before.settings) !== JSON.stringify(after.settings)) {
    await audit('classroom.settings_changed', { actorUid: after.teacherUid, actorRole: 'teacher', target: `classrooms/${classroomId}`, schoolId: after.schoolId });
  }
});

exports.onStudentWritten = onDocumentWritten('students/{studentId}', async (event) => {
  const before = event.data.before.data();
  const after = event.data.after.data();
  const classroomId = after?.classroomId || before?.classroomId;
  if (!classroomId) return;
  const rosterChanged =
    !before || !after || before.displayName !== after.displayName || before.avatar !== after.avatar || before.active !== after.active || before.classroomId !== after.classroomId;
  if (rosterChanged) await syncClassCode(classroomId);
  if (before?.classroomId && after?.classroomId && before.classroomId !== after.classroomId) await syncClassCode(before.classroomId);

  // A new nickname request: let the teacher know.
  if (after?.nicknameRequest?.status === 'pending' && before?.nicknameRequest?.name !== after.nicknameRequest.name && after.teacherUid) {
    await notify({ toUid: after.teacherUid, kind: 'nickname', title: 'Nickname request', body: `${after.displayName} asked to be called "${after.nicknameRequest.name}".`, link: '/teach/students' });
  }
});

exports._internal = { syncClassCode };
