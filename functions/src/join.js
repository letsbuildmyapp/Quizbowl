'use strict';

// Self-join: a student with the class code picks a nickname and a PIN and is
// added to the roster right away. Guards: the class can switch it off, a class
// size cap, a per-code rate limit, and a nickname filter. Teachers can rename
// or remove anyone afterwards.

const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const catalog = require('../shared/catalog.json');
const { db, FieldValue, UserError, now, setClaims, fulfil, audit, notify, bumpMetric, DEFAULT_SCHOOL_SETTINGS } = require('./common');

const MAX_CLASS_SIZE = 60;
const JOIN_WINDOW_MS = 10 * 60 * 1000;
const JOINS_PER_WINDOW = 12;
const NAME_MAX = 20;

// Keep nicknames kid-appropriate. Teachers can still rename anyone.
const BLOCKED = [
  'fuck', 'shit', 'bitch', 'cunt', 'dick', 'piss', 'porn', 'sex', 'nigg', 'fag', 'rape', 'nazi', 'hitler',
  'penis', 'vagina', 'boob', 'anal', 'slut', 'whore', 'damn', 'ass', 'butt', 'crap', 'kill', 'die', 'drug',
  'teacher', 'admin', 'quizquest'
];

function cleanName(raw) {
  const name = String(raw || '')
    .replace(/[^A-Za-z0-9 .'-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);
  if (name.length < 2) throw new UserError('Pick a nickname with at least 2 letters.');
  const flat = name.toLowerCase().replace(/[^a-z]/g, '');
  if (BLOCKED.some((w) => flat.includes(w))) throw new UserError('Pick a different nickname, then try again.');
  return name;
}

function becamePending(event) {
  const before = event.data.before.exists ? event.data.before.data() : null;
  const after = event.data.after.exists ? event.data.after.data() : null;
  return !!after && after.status === 'pending' && (!before || before.status !== 'pending');
}

async function checkRate(code) {
  const ref = db.doc(`joinThrottle/${code}`);
  const allowed = await db.runTransaction(async (tx) => {
    const cur = (await tx.get(ref)).data();
    const t = now();
    if (!cur || t - cur.windowStart > JOIN_WINDOW_MS) {
      tx.set(ref, { windowStart: t, count: 1 });
      return true;
    }
    if (cur.count >= JOINS_PER_WINDOW) return false;
    tx.update(ref, { count: cur.count + 1 });
    return true;
  });
  if (!allowed) throw new UserError('Lots of people are joining right now. Try again in a few minutes.');
}

exports.onJoinRequest = onDocumentWritten('joinRequests/{uid}', (event) =>
  becamePending(event) &&
  fulfil(event.data.after, async (data, ref) => {
    const uid = event.params.uid;
    const code = String(data.code || '').toUpperCase().trim();
    const pin = String(data.pin || '');
    await ref.update({ pin: FieldValue.delete() });
    if (!/^[0-9]{4}$/.test(pin)) throw new UserError('Pick a 4-digit PIN (numbers only).');
    const name = cleanName(data.name);

    const cc = (await db.doc(`classCodes/${code}`).get()).data();
    if (!cc) throw new UserError("That class code doesn't match any class. Check with your teacher.");
    if (cc.expiresAt && cc.expiresAt < now()) throw new UserError('That class code has expired. Ask your teacher for a new one.');

    const classSnap = await db.doc(`classrooms/${cc.classroomId}`).get();
    const classroom = classSnap.data();
    if (!classroom) throw new UserError('That class was not found.');
    if (classroom.settings?.selfJoin === false) {
      throw new UserError('Your teacher adds students to this class. Ask them to add you.');
    }
    if ((cc.roster || []).length >= MAX_CLASS_SIZE) throw new UserError('This class is full. Ask your teacher for help.');
    await checkRate(code);

    const school = (await db.doc(`schools/${classroom.schoolId}`).get()).data() || {};
    const consentMode = { ...DEFAULT_SCHOOL_SETTINGS, ...(school.settings || {}) }.consentMode;
    const taken = new Set((cc.roster || []).map((r) => r.displayName.toLowerCase()));
    let displayName = name;
    for (let i = 2; taken.has(displayName.toLowerCase()) && i < 40; i++) displayName = `${name} ${i}`;

    const avatar = catalog.avatars[Math.floor(Math.random() * catalog.avatars.length)];
    const studentRef = db.collection('students').doc();
    await studentRef.set({
      classroomId: cc.classroomId,
      schoolId: classroom.schoolId,
      teacherUid: classroom.teacherUid,
      displayName,
      avatar,
      teamId: null,
      active: true,
      consent: consentMode === 'parent' ? 'pending' : 'school',
      joinedWithCode: true,
      createdAt: now()
    });
    await db.doc(`students/${studentRef.id}/private/credentials`).set({ pin });
    await db.doc(`students/${studentRef.id}/private/devices`).set({ uids: FieldValue.arrayUnion(uid), lastLoginAt: now() }, { merge: true });
    await setClaims(uid, { role: 'student', studentId: studentRef.id, classroomId: cc.classroomId, schoolId: classroom.schoolId }, { replace: true });
    await notify({
      toUid: classroom.teacherUid,
      kind: 'join',
      title: 'New student joined',
      body: `${displayName} joined ${classroom.name || 'your class'} with the class code.`,
      link: '/teach/students'
    });
    await audit('roster.self_join', { actorRole: 'student', target: `students/${studentRef.id}`, schoolId: classroom.schoolId, details: { classroomId: cc.classroomId } });
    await bumpMetric({ selfJoins: 1 });
    return { studentId: studentRef.id, classroomId: cc.classroomId, displayName };
  })
);

exports._internal = { cleanName, MAX_CLASS_SIZE, JOINS_PER_WINDOW };
