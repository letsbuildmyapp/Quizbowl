'use strict';

// Privacy operations: access/export, correction, governed deletion, retention,
// and the weekly family summary.

const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { db, auth, now, claimsOf, audit, notify, hashId, DEFAULT_SCHOOL_SETTINGS } = require('./common');
const { weekKey, dayKey } = require('../engine/progression');
const { catalog } = require('../engine');

/** Who may file a privacy request about a student. */
async function canActFor(uid, role, student) {
  if (!student) return false;
  const claims = await claimsOf(uid);
  if (claims.platformAdmin) return true;
  if (role === 'parent') return claims.role === 'parent' && (claims.students || []).includes(student.id);
  if (role === 'teacher') {
    if (claims.role !== 'teacher') return false;
    if (claims.schoolAdmin && claims.schoolId === student.schoolId) return true;
    return student.teacherUid === uid;
  }
  return false;
}

async function queryAll(q) {
  const snap = await q.get();
  return snap.docs;
}

async function buildExport(studentId) {
  const studentSnap = await db.doc(`students/${studentId}`).get();
  const student = studentSnap.data() || {};
  const [summaries, deck, consent, links] = await Promise.all([
    queryAll(db.collection('sessionSummaries').where('studentId', '==', studentId)),
    queryAll(db.collection(`students/${studentId}/reviewDeck`)),
    db.doc(`consents/${studentId}`).get(),
    queryAll(db.collection('guardianLinks').where('studentId', '==', studentId))
  ]);
  const { recentQuestionIds, ...profile } = student;
  return {
    exportedAt: new Date().toISOString(),
    note: 'QuizQuest stores a teacher-chosen alias, practice results, rewards and preferences. No full names, contact details or chat.',
    profile: { id: studentId, ...profile },
    sessions: summaries.map((d) => d.data()),
    reviewDeck: deck.map((d) => d.data()),
    consent: consent.data() || null,
    linkedFamilyAccounts: links.length
  };
}

async function deleteQuery(q, onDoc) {
  const snap = await q.get();
  for (const d of snap.docs) {
    if (onDoc) await onDoc(d);
    await d.ref.delete();
  }
  return snap.size;
}

async function deleteSessionTree(sessionId) {
  const ref = db.doc(`sessions/${sessionId}`);
  await db.recursiveDelete(ref);
  await db.doc(`sessionSecrets/${sessionId}`).delete().catch(() => {});
}

/** Permanently remove a student and everything keyed to them. */
async function deleteStudentData(studentId) {
  const student = (await db.doc(`students/${studentId}`).get()).data();
  const counts = {};
  // Sessions: solo sessions go entirely; shared live battles are scrubbed.
  const sessions = await db.collection('sessions').where('participantIds', 'array-contains', studentId).get();
  counts.sessions = 0;
  for (const s of sessions.docs) {
    const d = s.data();
    if (d.mode === 'live_battle') {
      await s.ref.update({
        participants: d.participants.map((p) => (p.id === studentId ? { ...p, id: `removed-${hashId(studentId)}`, name: 'Removed player', avatar: '🙂' } : p)),
        participantIds: d.participantIds.filter((x) => x !== studentId)
      });
    } else {
      await deleteSessionTree(s.id);
    }
    counts.sessions++;
  }
  counts.summaries = await deleteQuery(db.collection('sessionSummaries').where('studentId', '==', studentId));
  counts.answerReviews = await deleteQuery(db.collection('answerReviews').where('studentId', '==', studentId));
  counts.notifications = await deleteQuery(db.collection('notifications').where('toStudentId', '==', studentId));
  counts.guardianLinks = await deleteQuery(db.collection('guardianLinks').where('studentId', '==', studentId), async (d) => {
    const parentUid = d.data().parentUid;
    const claims = await claimsOf(parentUid);
    const students = (claims.students || []).filter((x) => x !== studentId);
    const { setClaims } = require('./common');
    await setClaims(parentUid, { students });
  });
  counts.parentInvites = await deleteQuery(db.collection('parentInvites').where('studentId', '==', studentId));
  counts.assignmentProgress = await deleteQuery(db.collectionGroup('progress').where('studentId', '==', studentId));
  await db.doc(`consents/${studentId}`).delete().catch(() => {});
  await db.doc(`loginThrottle/${studentId}`).delete().catch(() => {});

  // Leaderboards: remove entries.
  if (student?.classroomId) {
    const boards = await db.collection('leaderboards').where('classroomId', '==', student.classroomId).get();
    for (const b of boards.docs) {
      const entries = (b.data().entries || []).filter((e) => e.studentId !== studentId);
      await b.ref.update({ entries });
    }
  }
  // Team quest contributions.
  const quests = student?.classroomId ? await db.collection('teamQuests').where('classroomId', '==', student.classroomId).get() : { docs: [] };
  for (const q of quests.docs) {
    const contributions = { ...(q.data().contributions || {}) };
    const names = { ...(q.data().names || {}) };
    if (contributions[studentId] != null || names[studentId] != null) {
      delete contributions[studentId];
      delete names[studentId];
      await q.ref.update({ contributions, names });
    }
  }

  // Signed-in devices lose access.
  const devices = (await db.doc(`students/${studentId}/private/devices`).get()).data()?.uids || [];
  for (const uid of devices) {
    await auth.deleteUser(uid).catch(() => {});
    await db.doc(`users/${uid}`).delete().catch(() => {});
  }
  await db.recursiveDelete(db.doc(`students/${studentId}`));
  return counts;
}

exports.onPrivacyRequest = onDocumentCreated('privacyRequests/{id}', async (event) => {
  const req = event.data.data();
  const ref = event.data.ref;
  const studentSnap = await db.doc(`students/${req.studentId}`).get();
  const student = studentSnap.exists ? { id: studentSnap.id, ...studentSnap.data() } : null;
  if (!(await canActFor(req.uid, req.requesterRole, student))) {
    await ref.update({ status: 'rejected', note: "You can only make requests for a student you're linked to." });
    return;
  }
  await ref.update({ schoolId: student.schoolId, classroomId: student.classroomId, studentName: student.displayName });
  const actor = { actorUid: req.uid, actorRole: req.requesterRole, target: `privacyRequests/${event.params.id}`, schoolId: student.schoolId };

  if (req.type === 'access' || req.type === 'export') {
    const data = await buildExport(req.studentId);
    await ref.update({ status: 'done', result: { export: JSON.stringify(data, null, 2) }, completedAt: now() });
    await audit(`privacy.${req.type}`, actor);
    return;
  }
  if (req.type === 'correction') {
    // Teachers make corrections on the roster; the request is tracked until they mark it done.
    if (student.teacherUid) await notify({ toUid: student.teacherUid, kind: 'privacy', title: 'Correction requested', body: `A correction was requested for ${student.displayName}.`, link: `/teach/students/${student.id}` });
    await audit('privacy.correction_requested', actor);
    return;
  }
  if (req.type === 'deletion') {
    const school = (await db.doc(`schools/${student.schoolId}`).get()).data();
    for (const uid of school?.adminUids || []) {
      await notify({ toUid: uid, kind: 'privacy', title: 'Deletion request', body: 'A student data deletion request needs a decision.', link: '/teach/school' });
    }
    await audit('privacy.deletion_requested', actor);
  }
});

exports.onPrivacyDecision = onDocumentUpdated('privacyRequests/{id}', async (event) => {
  const before = event.data.before.data();
  const req = event.data.after.data();
  if (before.status === req.status || req.status !== 'approved') return;
  const actor = { actorUid: req.decidedBy, actorRole: 'admin', target: `privacyRequests/${event.params.id}`, schoolId: req.schoolId || null };
  if (req.type === 'deletion') {
    const counts = await deleteStudentData(req.studentId);
    await event.data.after.ref.update({ status: 'done', completedAt: now(), result: { deleted: counts }, studentName: 'Deleted student' });
    await audit('privacy.deletion_completed', { ...actor, details: { subject: hashId(req.studentId), counts } });
    return;
  }
  await event.data.after.ref.update({ status: 'done', completedAt: now() });
  await audit(`privacy.${req.type}_completed`, actor);
});

// ---------------------------------------------------------------------------
// Retention: event-level game data is kept per school setting; aggregates stay.

exports.retentionSweep = onSchedule({ schedule: 'every day 03:15', timeZone: 'America/New_York' }, async () => {
  const schools = await db.collection('schools').get();
  let removed = 0;
  for (const s of schools.docs) {
    const days = Number(s.data().settings?.retentionDays) || DEFAULT_SCHOOL_SETTINGS.retentionDays;
    const cutoff = now() - days * 86400000;
    const old = await db.collection('sessions').where('schoolId', '==', s.id).where('createdAt', '<', cutoff).limit(200).get();
    for (const d of old.docs) {
      await deleteSessionTree(d.id);
      removed++;
    }
  }
  // Operational leftovers.
  const weekAgo = now() - 7 * 86400000;
  for (const col of ['studentLogins', 'sessionRequests', 'adminActions', 'parentRequests', 'contentImports']) {
    const snap = await db.collection(col).where('finishedAt', '<', weekAgo).limit(300).get();
    for (const d of snap.docs) await d.ref.delete();
  }
  await audit('retention.sweep', { actorRole: 'system', details: { sessionsRemoved: removed } });
});

// ---------------------------------------------------------------------------
// Weekly family summary: an encouraging note, never a ranking.

function summaryText(name, sums, student) {
  const seen = sums.reduce((s, x) => s + (x.seen || 0), 0);
  const answered = sums.reduce((s, x) => s + (x.answered || 0), 0);
  const correct = sums.reduce((s, x) => s + (x.correct || 0), 0);
  const topics = [...new Set(sums.flatMap((x) => x.topics || []))].slice(0, 5);
  const badges = sums.flatMap((x) => x.newBadges || []).map((b) => catalog.badges.find((c) => c.id === b)?.name).filter(Boolean);
  const lines = [
    `${name} practiced ${seen} quiz bowl questions this week${answered ? ` and got ${Math.round((correct / answered) * 100)}% of their answers right` : ''}.`,
    topics.length ? `Topics explored: ${topics.join(', ')}.` : null,
    badges.length ? `New badges: ${badges.join(', ')}.` : null,
    student?.streak?.current > 1 ? `Current streak: ${student.streak.current} days.` : null,
    'Ask them which clue they buzzed on earliest. Kids love telling that story.'
  ].filter(Boolean);
  return lines.join('\n');
}

exports.weeklyFamilySummary = onSchedule({ schedule: 'every sunday 17:00', timeZone: 'America/New_York' }, async () => {
  const wk = weekKey(now());
  const links = await db.collection('guardianLinks').where('status', '==', 'active').get();
  for (const l of links.docs) {
    const { parentUid, studentId } = l.data();
    const user = (await db.doc(`users/${parentUid}`).get()).data();
    const student = (await db.doc(`students/${studentId}`).get()).data();
    if (!student) continue;
    const sums = (await db.collection('sessionSummaries').where('studentId', '==', studentId).where('weekKey', '==', wk).get()).docs.map((d) => d.data());
    if (!sums.length) continue;
    const text = summaryText(student.displayName, sums, student);
    if (user?.prefs?.notifications?.weeklySummary !== false) {
      await notify({ toUid: parentUid, kind: 'weekly', title: `${student.displayName}'s week`, body: text.split('\n')[0], link: `/family/child/${studentId}` });
    }
    if (user?.prefs?.weeklyEmail && user.email) {
      // Delivered by the Firebase "Trigger Email" extension once it is installed.
      await db.collection('mail').add({ to: user.email, message: { subject: `${student.displayName}'s QuizQuest week`, text }, createdAt: now(), day: dayKey(now()) });
    }
  }
});

exports._internal = { deleteStudentData, buildExport, canActFor, summaryText };
