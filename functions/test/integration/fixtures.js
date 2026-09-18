'use strict';

// Isolated fixtures for integration tests. Everything is created through the
// client SDK exactly like the web UI does (new teacher -> new school -> own
// classroom/students), with unique names per run, so tests never touch the
// shared demo-school data other people use on the same emulator.

const { collection, doc, setDoc, getDocs, query, where, serverTimestamp, addDoc } = require('firebase/firestore');

// Expected permission-denied writes would otherwise spam the output.
require('firebase/firestore').setLogLevel('silent');
const { makeClient, sleep } = require('./client');

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
let seq = 0;
const uniq = (p) => `${p}-${RUN}-${++seq}`;

/** Collects clients so each test file can close them in test.after. */
function clientPool() {
  const clients = [];
  const client = () => {
    const c = makeClient();
    clients.push(c);
    return c;
  };
  client.closeAll = async () => {
    for (const c of clients) await c.close().catch(() => {});
  };
  return client;
}

function randomCode(len = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

/** Poll until fn() returns a truthy value. */
async function until(fn, ms = 30000, every = 300, label = 'condition') {
  const deadline = Date.now() + ms;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await sleep(every);
  }
  throw new Error(`timeout waiting for ${label}`);
}

/** Register a fresh email account and create a school via teacherRequests (doc id = uid). */
async function newTeacher(c, tag = 'teacher') {
  const email = `${uniq(tag)}@quizquest.test`;
  const user = await c.register(email, 'teachpass123');
  const res = await c.request('teacherRequests', { displayName: `Test ${tag}`, schoolName: `School ${uniq(tag)}` }, user.uid);
  if (res.status !== 'done') throw new Error(`teacherRequests failed: ${res.error}`);
  const claims = await c.claims();
  return { uid: user.uid, email, schoolId: res.result.schoolId, claims, res };
}

/** Create a classroom the way TeacherPage.jsx does; waits for the classCodes roster doc. */
async function newClassroom(c, t, { name = uniq('Class'), settings = {} } = {}) {
  const joinCode = randomCode(6);
  const ref = await addDoc(collection(c.db, 'classrooms'), {
    schoolId: t.schoolId,
    teacherUid: t.uid,
    name,
    grade: '4-5',
    joinCode,
    joinCodeExpiresAt: Date.now() + 30 * 86400000,
    settings: {
      leaderboard: 'class',
      opponentMinTier: 0,
      opponentMaxTier: 3,
      rules: {},
      accessibility: { readingSpeed: 'medium', readAloud: false, reducedMotion: false, largeText: false },
      voiceAnswers: false,
      ...settings
    },
    dismissedSuggestions: [],
    createdAt: serverTimestamp()
  });
  // The trigger may reassign the code on a collision; read it back.
  const cc = await until(async () => {
    const cls = await c.get(`classrooms/${ref.id}`);
    const code = cls.joinCode;
    const snap = await c.get(`classCodes/${code}`).catch(() => null);
    return snap && snap.classroomId === ref.id ? { code, snap } : null;
  }, 30000, 300, 'classCodes doc');
  return { classroomId: ref.id, code: cc.code, name };
}

/** Add students the way students-parts.jsx createStudent does (profile, then PIN doc). */
async function addStudents(c, t, cls, names, { teamIds = [] } = {}) {
  const out = [];
  for (const [i, displayName] of names.entries()) {
    const ref = doc(collection(c.db, 'students'));
    await setDoc(ref, {
      classroomId: cls.classroomId,
      schoolId: t.schoolId,
      teacherUid: t.uid,
      displayName,
      avatar: '🙂',
      teamId: teamIds[i] || null,
      active: true,
      consent: 'school',
      createdAt: serverTimestamp()
    });
    const pin = String(1000 + Math.floor(Math.random() * 9000));
    await setDoc(doc(c.db, `students/${ref.id}/private/credentials`), { pin });
    out.push({ id: ref.id, name: displayName, pin });
  }
  await until(async () => {
    const cc = await c.get(`classCodes/${cls.code}`);
    return out.every((s) => cc.roster.some((r) => r.id === s.id));
  }, 30000, 300, 'roster sync');
  return out;
}

/** Sign a device in as a student (anonymous auth + studentLogins/{uid}). */
async function loginStudent(c, code, student) {
  const user = await c.anon();
  const res = await c.request('studentLogins', { code, studentId: student.id, pin: student.pin }, user.uid);
  if (res.status !== 'done') throw new Error(`student login failed: ${res.error}`);
  const claims = await c.claims();
  return { uid: user.uid, claims };
}

/** One teacher, one school, one classroom with named students. */
async function classFixture(client, { students = ['Ada', 'Ben'], settings, tag } = {}) {
  const tc = client();
  const teacher = await newTeacher(tc, tag);
  const cls = await newClassroom(tc, teacher, { settings });
  const roster = await addStudents(tc, teacher, cls, students.map((n) => `${n} ${RUN.slice(-4)}`));
  return { tc, teacher, cls, roster };
}

/** Query helper: docs of a collection filtered by field == value, as data objects with id. */
async function listWhere(c, col, field, value) {
  const snap = await getDocs(query(collection(c.db, col), where(field, '==', value)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function listAll(c, col) {
  const snap = await getDocs(collection(c.db, col));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Drive a session until it completes. `decide(s)` may return
 *   { type, payload } to send a command, 'wait' to just sync, or null for the default
 * (advance when SCORED, else sync). Returns the final session doc.
 */
async function drive(c, sessionId, actorId, decide = () => null, { timeout = 180000, every = 300 } = {}) {
  const deadline = Date.now() + timeout;
  let s;
  while (Date.now() < deadline) {
    s = await c.get(`sessions/${sessionId}`);
    if (s.status === 'COMPLETE' || s.status === 'TERMINATED') return s;
    const action = await decide(s);
    if (action && action !== 'wait') {
      await c.command(sessionId, action.type, action.payload || {}, actorId);
      // Let the trigger apply the command before looking again.
      await c.waitDoc(`sessions/${sessionId}`, (d) => d.seq !== s.seq, 15000).catch(() => {});
      continue;
    }
    if (!action && s.status === 'SCORED') {
      await c.command(sessionId, 'advance', {}, actorId);
      await c.waitDoc(`sessions/${sessionId}`, (d) => d.seq !== s.seq, 15000).catch(() => {});
      continue;
    }
    await c.command(sessionId, 'sync', {}, actorId);
    await sleep(every);
  }
  throw new Error(`session ${sessionId} stuck in ${s?.status}`);
}

/** A quick 1-question practice: start, skip the tossup (or buzz + answer `answerText`), advance -> COMPLETE. */
async function quickPractice(c, studentId, { answerText = null } = {}) {
  const req = await c.request('sessionRequests', { mode: 'practice', options: { count: 1, readingSpeed: 'fast' } });
  if (req.status !== 'done') throw new Error(`sessionRequest failed: ${req.error}`);
  const sid = req.result.sessionId;
  await c.command(sid, 'start', {}, studentId);
  const done = new Set();
  const s = await drive(c, sid, studentId, (st) => {
    if (st.status === 'READING_CLUE' && !done.has(st.qIndex)) {
      done.add(st.qIndex);
      return answerText ? { type: 'buzz', payload: {} } : { type: 'skip' };
    }
    if (st.status === 'AWAITING_ANSWER' && st.current.buzz?.actorId === studentId) return { type: 'answer', payload: { text: answerText } };
    if (st.status === 'BONUS') return { type: 'skip' };
    return null;
  });
  const summary = await c.waitDoc(`sessionSummaries/${sid}_${studentId}`, (d) => !!d, 30000);
  return { sessionId: sid, session: s, summary };
}

// ---- Admin SDK (test oracle only: answer keys, fixtures the UI can't make) ----
let adminDb = null;
function admin() {
  if (!adminDb) {
    process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
    process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
    const { initializeApp, getApps } = require('firebase-admin/app');
    const { getFirestore } = require('firebase-admin/firestore');
    const app = getApps().find((a) => a.name === 'itest') || initializeApp({ projectId: 'quizbowl-d984f' }, 'itest');
    adminDb = getFirestore(app);
  }
  return adminDb;
}

/** The answer key for a question (read server-side; never visible to clients). */
async function answerKey(questionId) {
  const q = (await admin().doc(`questions/${questionId}`).get()).data();
  if (!q) throw new Error(`no question ${questionId}`);
  return q;
}

module.exports = {
  RUN,
  uniq,
  clientPool,
  randomCode,
  until,
  newTeacher,
  newClassroom,
  addStudents,
  loginStudent,
  classFixture,
  listWhere,
  listAll,
  drive,
  quickPractice,
  admin,
  answerKey
};
