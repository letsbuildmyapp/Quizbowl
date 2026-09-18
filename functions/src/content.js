'use strict';

// Content workflow: draft -> review -> approved -> published -> retired, with
// version history, audit, rights enforcement and the teacher-facing stats doc.

const { onDocumentCreated, onDocumentWritten } = require('firebase-functions/v2/firestore');
const { db, UserError, now, toMillis, claimsOf, fulfil, audit, bumpMetric } = require('./common');
const { invalidateQuestionCache, isPlayable } = require('./questions');
const { catalog } = require('../engine');

const ALLOWED = {
  draft: ['review'],
  review: ['approved', 'draft'],
  approved: ['published', 'review', 'draft'],
  published: ['retired'],
  retired: ['draft']
};

const TRACKED = ['type', 'status', 'setId', 'category', 'subcategory', 'gradeBand', 'difficulty', 'promptLeadin', 'clues', 'powerClueIndex', 'canonicalAnswer', 'acceptedAnswers', 'rejectedAnswers', 'approvedDistractors', 'explanation', 'pronunciationNotes', 'parts', 'license', 'sourceOwner', 'usageWindowEnd'];

function rightsProblem(q) {
  if (!q.setId) return 'Pick a question set before publishing.';
  if (!q.license || !q.sourceOwner) return 'Rights metadata (license and source owner) is required to publish.';
  const end = toMillis(q.usageWindowEnd);
  if (end && end < now()) return 'The usage window for this content has ended.';
  return null;
}

async function rebuildStats() {
  const snap = await db.collection('questions').where('status', '==', 'published').get();
  const published = {};
  const setCounts = {};
  snap.forEach((d) => {
    const q = d.data();
    if (!isPlayable(q)) return;
    const c = (published[q.category] ||= { tossups: 0, bonuses: 0, byDifficulty: { 1: 0, 2: 0, 3: 0 } });
    if (q.type === 'tossup') {
      c.tossups += 1;
      c.byDifficulty[q.difficulty] = (c.byDifficulty[q.difficulty] || 0) + 1;
    } else c.bonuses += 1;
    if (q.setId) setCounts[q.setId] = (setCounts[q.setId] || 0) + 1;
  });
  const setsSnap = await db.collection('questionSets').get();
  const sets = setsSnap.docs.map((d) => ({ id: d.id, name: d.data().name, count: setCounts[d.id] || 0 })).filter((s) => s.count > 0);
  await db.doc('contentStats/summary').set({ published, sets, updatedAt: now() });
}

exports.onQuestionWritten = onDocumentWritten('questions/{questionId}', async (event) => {
  const before = event.data.before.data();
  const after = event.data.after.data();
  const { questionId } = event.params;
  invalidateQuestionCache();

  if (!after) {
    await audit('content.deleted', { target: `questions/${questionId}` });
    if (before?.status === 'published') await rebuildStats();
    return;
  }

  // Our own revert write: nothing else to do.
  if (before && (after.revertSeq || 0) !== (before.revertSeq || 0)) return;

  // Enforce lifecycle and rights (rules enforce this too; this is defense in depth).
  if (before && before.status !== after.status) {
    const ok = (ALLOWED[before.status] || []).includes(after.status);
    const problem = after.status === 'published' ? rightsProblem(after) : null;
    if (!ok || problem) {
      await event.data.after.ref.update({
        status: before.status,
        publishError: problem || `Can't move from ${before.status} to ${after.status}.`,
        revertSeq: (after.revertSeq || 0) + 1
      });
      await audit('content.transition_blocked', { actorUid: after.updatedBy || null, target: `questions/${questionId}`, details: { from: before.status, to: after.status } });
      return;
    }
  }

  const changed = TRACKED.filter((k) => JSON.stringify(before?.[k] ?? null) !== JSON.stringify(after[k] ?? null));
  if (!changed.length) return;
  const version = after.version || 1;
  await db.doc(`questions/${questionId}/history/v${String(version).padStart(4, '0')}-${Date.now()}`).set({
    version,
    status: after.status,
    at: now(),
    by: after.updatedBy || after.createdBy || null,
    changes: before ? changed : ['created'],
    snapshot: Object.fromEntries(TRACKED.map((k) => [k, after[k] ?? null]))
  });
  if (!before || before.status !== after.status) {
    await audit(before ? `content.${after.status}` : 'content.created', {
      actorUid: after.updatedBy || after.createdBy || null,
      actorRole: 'contentAdmin',
      target: `questions/${questionId}`,
      details: { from: before?.status || null, to: after.status }
    });
  }
  if (after.publishError && (before?.status !== after.status)) await event.data.after.ref.update({ publishError: null });
  if (before?.status === 'published' || after.status === 'published') await rebuildStats();
});

exports.onQuestionSetWritten = onDocumentWritten('questionSets/{setId}', async () => {
  await rebuildStats();
});

function validateTossup(t) {
  const errs = [];
  if (!t.category || !catalog.categories.some((c) => c.id === t.category)) errs.push('unknown category');
  if (!Array.isArray(t.clues) || t.clues.length < 2) errs.push('needs at least 2 clues');
  if (!t.canonicalAnswer) errs.push('missing canonicalAnswer');
  const ans = String(t.canonicalAnswer || '').toLowerCase();
  if (ans && (t.clues || []).some((c) => String(c.text || '').toLowerCase().includes(ans))) errs.push('a clue contains the answer');
  return errs;
}

function validateBonus(b) {
  const errs = [];
  if (!b.category || !catalog.categories.some((c) => c.id === b.category)) errs.push('unknown category');
  if (!Array.isArray(b.parts) || !b.parts.length) errs.push('needs parts');
  (b.parts || []).forEach((p, i) => {
    if (!p.text || !p.canonicalAnswer) errs.push(`part ${i + 1} incomplete`);
  });
  return errs;
}

exports.onContentImport = onDocumentCreated('contentImports/{id}', (event) =>
  fulfil(event.data, async (data) => {
    const claims = await claimsOf(data.uid);
    if (!claims.contentAdmin && !claims.platformAdmin) throw new UserError('Only content admins can import questions.');
    const set = (await db.doc(`questionSets/${data.setId}`).get()).data();
    if (!set) throw new UserError('Pick a question set first.');
    let parsed;
    try {
      parsed = JSON.parse(data.payload);
    } catch {
      throw new UserError("That file isn't valid JSON.");
    }
    const items = [...(parsed.tossups || []).map((q) => ({ ...q, type: 'tossup' })), ...(parsed.bonuses || []).map((q) => ({ ...q, type: 'bonus' }))];
    if (!items.length) throw new UserError('No tossups or bonuses found in the file.');
    if (items.length > 300) throw new UserError('Import at most 300 questions at a time.');
    const errors = [];
    let imported = 0;
    let batch = db.batch();
    let n = 0;
    for (const [i, q] of items.entries()) {
      const errs = q.type === 'tossup' ? validateTossup(q) : validateBonus(q);
      if (errs.length) {
        errors.push({ index: i, id: q.id || null, errors: errs });
        continue;
      }
      const ref = db.collection('questions').doc();
      const doc = {
        type: q.type,
        status: 'draft',
        setId: data.setId,
        category: q.category,
        subcategory: q.subcategory || null,
        gradeBand: q.gradeBand || null,
        difficulty: Number(q.difficulty) || 2,
        promptLeadin: q.promptLeadin || '',
        explanation: q.explanation || '',
        pronunciationNotes: q.pronunciationNotes || null,
        sourceOwner: set.sourceOwner || null,
        license: set.license || null,
        usageWindowEnd: set.usageWindowEnd || null,
        importRef: q.id || null,
        createdBy: data.uid,
        version: 1,
        createdAt: now(),
        updatedAt: now()
      };
      if (q.type === 'tossup') {
        Object.assign(doc, {
          clues: q.clues.map((c, idx) => ({ text: c.text, clueIndex: idx, difficultyWeight: Number(c.difficultyWeight ?? 0.5) })),
          powerClueIndex: q.powerClueIndex ?? 1,
          canonicalAnswer: q.canonicalAnswer,
          acceptedAnswers: q.acceptedAnswers || [],
          rejectedAnswers: q.rejectedAnswers || [],
          approvedDistractors: q.approvedDistractors || []
        });
      } else {
        doc.parts = q.parts.map((p) => ({
          text: p.text,
          canonicalAnswer: p.canonicalAnswer,
          acceptedAnswers: p.acceptedAnswers || [],
          rejectedAnswers: p.rejectedAnswers || [],
          approvedDistractors: p.approvedDistractors || [],
          explanation: p.explanation || ''
        }));
      }
      batch.set(ref, doc);
      imported++;
      if (++n === 400) {
        await batch.commit();
        batch = db.batch();
        n = 0;
      }
    }
    if (n) await batch.commit();
    await audit('content.imported', { actorUid: data.uid, actorRole: 'contentAdmin', target: `questionSets/${data.setId}`, details: { imported, rejected: errors.length } });
    return { imported, errors };
  })
);

exports.onContentFlag = onDocumentCreated('contentFlags/{id}', async (event) => {
  const f = event.data.data();
  await bumpMetric({ contentFlags: 1 });
  await audit('content.flagged', { actorRole: f.role || null, target: `questions/${f.questionId}`, details: { reason: f.reason } });
});

exports._internal = { rebuildStats, rightsProblem, ALLOWED };
