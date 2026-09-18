'use strict';

const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const crypto = require('crypto');
const { weekKey } = require('../engine/progression');

if (!getApps().length) initializeApp();
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });
const auth = getAuth();

class UserError extends Error {}

const now = () => Date.now();

function toMillis(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (v instanceof Timestamp) return v.toMillis();
  if (typeof v.toMillis === 'function') return v.toMillis();
  return null;
}

/** Merge custom claims and tell the client to refresh its token. */
async function setClaims(uid, patch, { replace = false } = {}) {
  const user = await auth.getUser(uid);
  const next = replace ? { ...patch } : { ...(user.customClaims || {}), ...patch };
  for (const [k, v] of Object.entries(next)) if (v === null || v === undefined) delete next[k];
  await auth.setCustomUserClaims(uid, next);
  await db.doc(`users/${uid}`).set(
    { claimsVersion: FieldValue.increment(1), role: next.role || null, contentAdmin: !!next.contentAdmin, platformAdmin: !!next.platformAdmin },
    { merge: true }
  );
  return next;
}

async function claimsOf(uid) {
  if (!uid) return {};
  try {
    const user = await auth.getUser(uid);
    return { ...(user.customClaims || {}), _email: user.email || null, _anonymous: user.providerData.length === 0 && !user.email, _disabled: user.disabled };
  } catch {
    return {};
  }
}

/**
 * Run a request-document handler: status/result/error are written back.
 * handler(data, ref) returns the result object; throw UserError for a friendly message.
 */
async function fulfil(snap, handler) {
  const ref = snap.ref;
  const data = snap.data() || {};
  if (data.status && data.status !== 'pending') return;
  try {
    const result = await handler(data, ref);
    await ref.set({ status: 'done', result: result ?? null, finishedAt: now() }, { merge: true });
  } catch (err) {
    const message = err instanceof UserError ? err.message : 'Something went wrong. Please try again.';
    if (!(err instanceof UserError)) console.error(`request ${ref.path} failed`, err);
    await ref.set({ status: 'error', error: message, finishedAt: now() }, { merge: true });
  }
}

/** Audit trail. Never put answer text or child names in details. */
async function audit(action, { actorUid = null, actorRole = null, target = null, schoolId = null, details = {} } = {}) {
  await db.collection('auditEvents').add({ at: now(), action, actorUid, actorRole, target, schoolId, details });
}

/** Privacy-safe weekly counters (no identifiers). */
async function bumpMetric(fields, at = now()) {
  const inc = {};
  for (const [k, v] of Object.entries(fields)) inc[k] = FieldValue.increment(v);
  await db.doc(`metrics/${weekKey(at, 'UTC')}`).set({ ...unflatten(inc), weekKey: weekKey(at, 'UTC') }, { merge: true });
}

function unflatten(obj) {
  const out = {};
  for (const [path, v] of Object.entries(obj)) {
    const parts = path.split('.');
    let cur = out;
    parts.slice(0, -1).forEach((p) => {
      cur[p] = cur[p] || {};
      cur = cur[p];
    });
    cur[parts[parts.length - 1]] = v;
  }
  return out;
}

function hashId(id) {
  return crypto.createHash('sha256').update(`quizquest:${id}`).digest('hex').slice(0, 24);
}

function randomCode(len = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(len);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

async function notify({ toUid = null, toStudentId = null, kind, title, body, link = null }) {
  await db.collection('notifications').add({ toUid, toStudentId, kind, title, body, link, read: false, createdAt: now() });
}

const DEFAULT_CLASS_SETTINGS = {
  leaderboard: 'class',
  opponentMinTier: 0,
  opponentMaxTier: 3,
  rules: {},
  accessibility: { readingSpeed: 'medium', readAloud: false, reducedMotion: false, largeText: false },
  voiceAnswers: false
};

const DEFAULT_SCHOOL_SETTINGS = { consentMode: 'school', retentionDays: 365, timezone: 'America/New_York', allowCrossSchoolChallenges: false };

module.exports = {
  db,
  auth,
  FieldValue,
  Timestamp,
  UserError,
  now,
  toMillis,
  setClaims,
  claimsOf,
  fulfil,
  audit,
  bumpMetric,
  hashId,
  randomCode,
  notify,
  DEFAULT_CLASS_SETTINGS,
  DEFAULT_SCHOOL_SETTINGS
};
