'use strict';

// Content workflow as a content admin: set -> draft -> review -> approved ->
// published -> retired, with version history, audit and contentStats.

const test = require('node:test');
const assert = require('node:assert/strict');
const { collection, addDoc, doc, updateDoc, getDocs, query, where, serverTimestamp, increment } = require('firebase/firestore');
const { clientPool, uniq, until } = require('./fixtures');

const client = clientPool();
test.after(() => client.closeAll());

test('question lifecycle writes history per change and drives contentStats', { timeout: 120000 }, async () => {
  const a = client();
  await a.email('admin@quizquest.test', 'quizquest123');
  const uid = a.auth.currentUser.uid;
  const setName = uniq('Content set');
  const setRef = await addDoc(collection(a.db, 'questionSets'), {
    name: setName,
    sourceOwner: 'QuizQuest tests',
    license: 'CC-BY-4.0',
    rightsNote: 'integration test content',
    usageWindowEnd: null,
    createdBy: uid,
    createdAt: serverTimestamp()
  });
  const answer = `zorblax${Date.now()}`;
  const qRef = await addDoc(collection(a.db, 'questions'), {
    type: 'tossup',
    status: 'draft',
    setId: setRef.id,
    category: 'Science',
    subcategory: 'Test',
    gradeBand: '4-5',
    difficulty: 3,
    promptLeadin: '',
    clues: [
      { text: 'This imaginary mineral glows purple in integration tests.', clueIndex: 0, difficultyWeight: 0.8 },
      { text: 'For 10 points, name this made up test mineral.', clueIndex: 1, difficultyWeight: 0.2 }
    ],
    powerClueIndex: 0,
    canonicalAnswer: answer,
    acceptedAnswers: [],
    rejectedAnswers: [],
    approvedDistractors: ['quartz', 'granite', 'basalt'],
    explanation: 'It only exists here.',
    pronunciationNotes: null,
    sourceOwner: 'QuizQuest tests',
    license: 'CC-BY-4.0',
    usageWindowEnd: null,
    version: 1,
    createdBy: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  const history = async () => (await getDocs(collection(a.db, `questions/${qRef.id}/history`))).docs.map((d) => d.data());
  const statsSet = async () => ((await a.get('contentStats/summary'))?.sets || []).find((s) => s.id === setRef.id);

  let h = await until(async () => {
    const rows = await history();
    return rows.length >= 1 ? rows : null;
  }, 20000, 300, 'created history');
  assert.deepEqual(h[0].changes, ['created']);
  assert.equal(h[0].status, 'draft');

  const move = async (status, n) => {
    await updateDoc(doc(a.db, `questions/${qRef.id}`), { status, version: increment(1), updatedAt: serverTimestamp(), updatedBy: uid, ...(status === 'approved' ? { reviewedBy: uid } : {}) });
    const rows = await until(async () => {
      const r = await history();
      return r.length >= n ? r : null;
    }, 20000, 300, `history for ${status}`);
    const latest = rows.find((r) => r.status === status && r.changes.includes('status'));
    assert.ok(latest, `history row for ${status}`);
    assert.equal(latest.by, uid);
    assert.equal(latest.snapshot.canonicalAnswer, answer);
    const q = await a.get(`questions/${qRef.id}`);
    assert.equal(q.status, status, `not reverted: ${q.publishError || ''}`);
    return q;
  };

  await move('review', 2);
  assert.equal(await statsSet(), undefined, 'unpublished content is not counted');
  await move('approved', 3);
  const published = await move('published', 4);
  assert.equal(published.version, 4);
  const stats = await until(statsSet, 20000, 300, 'contentStats picks up the set');
  assert.equal(stats.count, 1);
  assert.equal(stats.name, setName);
  const summary = await a.get('contentStats/summary');
  assert.ok(summary.published.Science.byDifficulty['3'] >= 1);

  await move('retired', 5);
  await until(async () => ((await statsSet()) === undefined ? true : null), 20000, 300, 'contentStats drops the retired set');

  h = await history();
  assert.deepEqual(h.map((r) => r.status).sort(), ['approved', 'draft', 'published', 'retired', 'review']);
  // Audit trail for each transition.
  const audit = (await getDocs(query(collection(a.db, 'auditEvents'), where('target', '==', `questions/${qRef.id}`)))).docs.map((d) => d.data().action);
  for (const act of ['content.created', 'content.review', 'content.approved', 'content.published', 'content.retired']) assert.ok(audit.includes(act), `audit ${act}`);
  // Teachers see stats but not content or history.
  const t = client();
  await t.email('teacher@quizquest.test', 'quizquest123');
  await assert.rejects(t.get(`questions/${qRef.id}`));
  await assert.rejects(getDocs(collection(t.db, `questions/${qRef.id}/history`)));
  assert.ok(await t.get('contentStats/summary'));
});
