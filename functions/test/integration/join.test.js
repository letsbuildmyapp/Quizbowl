'use strict';

// Self-join: a kid with the class code picks a nickname and a PIN and lands on
// the roster. Covers the happy path, the teacher's off switch, a bad nickname,
// an expired code, and signing back in afterwards with the PIN they chose.

const test = require('node:test');
const assert = require('node:assert/strict');
const { doc, updateDoc } = require('firebase/firestore');
const { clientPool, newTeacher, newClassroom, until, RUN } = require('./fixtures');

const client = clientPool();
test.after(() => client.closeAll());

const ctx = {};
const tag = RUN.slice(-4);

test('teacher + classroom, self-join on by default', { timeout: 90000 }, async () => {
  const tc = client();
  const t = await newTeacher(tc, 'join');
  const cls = await newClassroom(tc, t);
  const cc = await tc.get(`classCodes/${cls.code}`);
  assert.equal(cc.selfJoin, true, 'class codes advertise self-join');
  Object.assign(ctx, { tc, t, cls });
});

test('a new student joins with the code and gets student claims', { timeout: 60000 }, async () => {
  const { tc, cls } = ctx;
  const sc = client();
  const user = await sc.anon();
  const name = `Newkid ${tag}`;
  const res = await sc.request('joinRequests', { code: cls.code, name, pin: '2468' }, user.uid);
  assert.equal(res.status, 'done', res.error);
  assert.equal(res.pin, undefined, 'PIN scrubbed from the request');
  assert.equal(res.result.displayName, name);

  const claims = await sc.claims();
  assert.equal(claims.role, 'student');
  assert.equal(claims.classroomId, cls.classroomId);
  assert.equal(claims.studentId, res.result.studentId);

  const student = await tc.get(`students/${res.result.studentId}`);
  assert.equal(student.displayName, name);
  assert.equal(student.joinedWithCode, true);
  assert.equal(student.active, true);
  assert.ok(student.avatar, 'got an avatar');

  // The roster the sign-in screen reads picks them up.
  await until(async () => (await tc.get(`classCodes/${cls.code}`)).roster.some((r) => r.id === res.result.studentId), 30000, 300, 'roster entry');
  Object.assign(ctx, { joined: { ...res.result, pin: '2468' } });
});

test('the PIN they picked signs them in again on another device', { timeout: 60000 }, async () => {
  const { cls, joined } = ctx;
  const sc2 = client();
  const user = await sc2.anon();
  const res = await sc2.request('studentLogins', { code: cls.code, studentId: joined.studentId, pin: joined.pin }, user.uid);
  assert.equal(res.status, 'done', res.error);
  assert.equal((await sc2.claims()).studentId, joined.studentId);
});

test('a second kid with the same name is numbered, not merged', { timeout: 60000 }, async () => {
  const { tc, cls, joined } = ctx;
  const sc = client();
  const user = await sc.anon();
  const res = await sc.request('joinRequests', { code: cls.code, name: `Newkid ${tag}`, pin: '1357' }, user.uid);
  assert.equal(res.status, 'done', res.error);
  assert.notEqual(res.result.studentId, joined.studentId);
  assert.equal(res.result.displayName, `Newkid ${tag} 2`);
  assert.equal((await tc.get(`students/${res.result.studentId}`)).displayName, `Newkid ${tag} 2`);
});

test('a rude nickname is refused', { timeout: 60000 }, async () => {
  const { cls } = ctx;
  const sc = client();
  const user = await sc.anon();
  const res = await sc.request('joinRequests', { code: cls.code, name: 'Big Butt', pin: '1111' }, user.uid);
  assert.equal(res.status, 'error');
  assert.match(res.error, /different nickname/i);
  assert.equal((await sc.claims()).role, undefined);
});

test('a PIN that is not 4 digits is refused', { timeout: 60000 }, async () => {
  const { cls } = ctx;
  const sc = client();
  const user = await sc.anon();
  const res = await sc.request('joinRequests', { code: cls.code, name: `Shorty ${tag}`, pin: '12' }, user.uid);
  assert.equal(res.status, 'error');
  assert.match(res.error, /4-digit/);
});

test('turning self-join off blocks new kids but leaves the roster alone', { timeout: 90000 }, async () => {
  const { tc, cls } = ctx;
  await updateDoc(doc(tc.db, 'classrooms', cls.classroomId), { 'settings.selfJoin': false });
  await until(async () => (await tc.get(`classCodes/${cls.code}`)).selfJoin === false, 30000, 300, 'selfJoin off');

  const sc = client();
  const user = await sc.anon();
  const res = await sc.request('joinRequests', { code: cls.code, name: `Latecomer ${tag}`, pin: '4321' }, user.uid);
  assert.equal(res.status, 'error');
  assert.match(res.error, /teacher adds students/i);

  // An existing student still signs in normally.
  const { joined } = ctx;
  const sc2 = client();
  const u2 = await sc2.anon();
  const ok = await sc2.request('studentLogins', { code: cls.code, studentId: joined.studentId, pin: joined.pin }, u2.uid);
  assert.equal(ok.status, 'done', ok.error);
});

test('an expired class code is refused', { timeout: 90000 }, async () => {
  const { tc, t } = ctx;
  const cls = await newClassroom(tc, t, { name: `Expired ${tag}` });
  await updateDoc(doc(tc.db, 'classrooms', cls.classroomId), { joinCodeExpiresAt: Date.now() - 1000 });
  await until(async () => (await tc.get(`classCodes/${cls.code}`)).expiresAt < Date.now(), 30000, 300, 'expiry synced');

  const sc = client();
  const user = await sc.anon();
  const res = await sc.request('joinRequests', { code: cls.code, name: `Toolate ${tag}`, pin: '9876' }, user.uid);
  assert.equal(res.status, 'error');
  assert.match(res.error, /expired/i);
});

test('rules reject a malformed join request', { timeout: 60000 }, async () => {
  const { cls } = ctx;
  const sc = client();
  const user = await sc.anon();
  const { setDoc, serverTimestamp } = require('firebase/firestore');
  // Extra field.
  await assert.rejects(
    setDoc(doc(sc.db, `joinRequests/${user.uid}`), {
      code: cls.code,
      name: 'Sneaky',
      pin: '1234',
      studentId: 'someone-else',
      uid: user.uid,
      status: 'pending',
      createdAt: serverTimestamp()
    })
  );
  // Someone else's doc id.
  await assert.rejects(
    setDoc(doc(sc.db, 'joinRequests/not-my-uid'), { code: cls.code, name: 'Sneaky', pin: '1234', uid: user.uid, status: 'pending', createdAt: serverTimestamp() })
  );
});
