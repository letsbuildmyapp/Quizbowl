#!/usr/bin/env node
'use strict';

/**
 * Seed QuizQuest data.
 *
 *   node scripts/seed.js --emulator            content + demo school/class/students/parent (local emulators)
 *   node scripts/seed.js --content             content only, against the real project (uses ADC)
 *   node scripts/seed.js --grant-admin <email> make an existing account a platform + content admin
 *   node scripts/seed.js --reset --emulator    wipe emulator data first
 *
 * Demo logins (emulator only) are printed at the end.
 */

const path = require('path');
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const PROJECT = process.env.GCLOUD_PROJECT || 'quizbowl-d984f';

if (flag('--emulator')) {
  process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
  process.env.FIREBASE_DATABASE_EMULATOR_HOST ||= '127.0.0.1:9000';
}

const fnDir = path.join(__dirname, '..', 'functions');
// Reuse the functions package's firebase-admin install.
const fnRequire = require('module').createRequire(path.join(fnDir, 'index.js'));
const { initializeApp } = fnRequire('firebase-admin/app');
const { getFirestore } = fnRequire('firebase-admin/firestore');
const { getAuth } = fnRequire('firebase-admin/auth');

initializeApp({ projectId: PROJECT });
const db = getFirestore();
const auth = getAuth();
const questions = require(path.join(fnDir, 'seed/questions.json'));

const now = Date.now();

async function reset() {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('--reset only runs against the emulator');
  const res = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  console.log('firestore reset', res.status);
  const ares = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
  console.log('auth reset', ares.status);
}

async function seedContent() {
  const set = questions.set;
  await db.doc(`questionSets/${set.id}`).set({
    name: set.name,
    sourceOwner: set.sourceOwner,
    license: set.license,
    rightsNote: set.rightsNote,
    usageWindowEnd: set.usageWindowEnd,
    createdBy: 'seed',
    createdAt: now
  });
  let batch = db.batch();
  let n = 0;
  const all = [...questions.tossups, ...questions.bonuses];
  for (const q of all) {
    const { id, ...rest } = q;
    batch.set(db.doc(`questions/${id}`), {
      ...rest,
      status: 'published',
      setId: set.id,
      sourceOwner: set.sourceOwner,
      license: set.license,
      usageWindowEnd: set.usageWindowEnd,
      createdBy: 'seed',
      reviewedBy: 'seed',
      version: 1,
      createdAt: now,
      updatedAt: now
    });
    if (++n % 400 === 0) {
      await batch.commit();
      batch = db.batch();
    }
  }
  await batch.commit();
  console.log(`content: ${questions.tossups.length} tossups, ${questions.bonuses.length} bonuses published in "${set.name}"`);
}

async function user(email, password, displayName, claims) {
  let u;
  try {
    u = await auth.getUserByEmail(email);
  } catch {
    u = await auth.createUser({ email, password, displayName, emailVerified: true });
  }
  await auth.setCustomUserClaims(u.uid, claims);
  await db.doc(`users/${u.uid}`).set({ displayName, email, role: claims.role || null, schoolId: claims.schoolId || null, claimsVersion: 1, prefs: { weeklyEmail: false, notifications: { badges: true, weeklySummary: true } }, createdAt: now }, { merge: true });
  return u.uid;
}

async function seedDemo() {
  const schoolId = 'demo-school';
  const teacherUid = await user('teacher@quizquest.test', 'quizquest123', 'Ms. Rivera', { role: 'teacher', schoolId, schoolAdmin: true });
  await db.doc(`schools/${schoolId}`).set({
    name: 'Maple Grove Elementary',
    adminUids: [teacherUid],
    teacherJoinCode: 'MAPLE2026',
    settings: { consentMode: 'school', retentionDays: 365, timezone: 'America/New_York', allowCrossSchoolChallenges: true },
    createdAt: now
  });
  await db.doc(`schools/${schoolId}/teachers/${teacherUid}`).set({ displayName: 'Ms. Rivera', email: 'teacher@quizquest.test', status: 'approved', isAdmin: true, requestedAt: now });
  await user('admin@quizquest.test', 'quizquest123', 'Content Admin', { contentAdmin: true, platformAdmin: true });

  const classroomId = 'demo-class';
  await db.doc(`classrooms/${classroomId}`).set({
    schoolId,
    teacherUid,
    name: 'Quiz Bowl Club',
    grade: '4-5',
    joinCode: 'QUEST1',
    joinCodeExpiresAt: now + 90 * 86400000,
    settings: {
      leaderboard: 'class',
      opponentMinTier: 0,
      opponentMaxTier: 3,
      rules: {},
      accessibility: { readingSpeed: 'medium', readAloud: false, reducedMotion: false, largeText: false },
      voiceAnswers: false
    },
    dismissedSuggestions: [],
    createdAt: now
  });
  const teams = [
    { id: 'demo-eagles', name: 'Eagles', emoji: '🦅', color: '#6d4df2' },
    { id: 'demo-tigers', name: 'Tigers', emoji: '🐯', color: '#e5484d' }
  ];
  for (const t of teams) await db.doc(`teams/${t.id}`).set({ classroomId, name: t.name, emoji: t.emoji, color: t.color });

  const kids = [
    ['Meridian', '🦊', 'demo-eagles', '1111'],
    ['Emma', '🐼', 'demo-eagles', '2222'],
    ['Liam', '🐯', 'demo-tigers', '3333'],
    ['Noah', '🐸', 'demo-tigers', '4444'],
    ['Ava', '🦄', 'demo-eagles', '5555'],
    ['Leo', '🐙', 'demo-tigers', '6666']
  ];
  for (const [i, [name, avatar, teamId, pin]] of kids.entries()) {
    const id = `demo-student-${i + 1}`;
    await db.doc(`students/${id}`).set({
      classroomId,
      schoolId,
      teacherUid,
      displayName: name,
      avatar,
      teamId,
      active: true,
      consent: 'school',
      xp: 0,
      level: 1,
      title: 'Rookie',
      unlockedWorlds: ['science-lab'],
      createdAt: now
    });
    await db.doc(`students/${id}/private/credentials`).set({ pin });
  }
  await db.doc('parentInvites/FAMILY01').set({ studentId: 'demo-student-1', classroomId, teacherUid, expiresAt: now + 30 * 86400000, usedBy: null, createdAt: now });

  console.log('\nDemo ready:');
  console.log('  Teacher (school admin): teacher@quizquest.test / quizquest123');
  console.log('  Content + platform admin: admin@quizquest.test / quizquest123');
  console.log('  Students: class code QUEST1, pick a name. PINs: Meridian 1111, Emma 2222, Liam 3333, Noah 4444, Ava 5555, Leo 6666');
  console.log('  Family invite code for Meridian: FAMILY01 (sign in with any email link in the Auth emulator)');
  console.log('  Teacher join code for Maple Grove: MAPLE2026');
}

async function grantAdmin(email) {
  const u = await auth.getUserByEmail(email);
  const claims = { ...(u.customClaims || {}), contentAdmin: true, platformAdmin: true };
  await auth.setCustomUserClaims(u.uid, claims);
  await db.doc(`users/${u.uid}`).set({ claimsVersion: Date.now() }, { merge: true });
  console.log(`granted platform + content admin to ${email}`);
}

(async () => {
  if (flag('--reset')) await reset();
  const gi = args.indexOf('--grant-admin');
  if (gi >= 0) await grantAdmin(args[gi + 1]);
  if (flag('--content') || flag('--emulator')) await seedContent();
  if (flag('--emulator')) await seedDemo();
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
