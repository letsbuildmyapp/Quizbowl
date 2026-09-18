// Question model helpers shared by the editor and the importer.
// Shape follows docs/DATA_MODEL.md `questions/{id}` and functions/seed/questions.json.
import { CATEGORY_IDS, catalog } from '../../lib/catalog.js';

export const GRADE_BANDS = catalog.gradeBands || ['4-5', '6-8'];
export const STATUSES = catalog.contentStatuses || ['draft', 'review', 'approved', 'published', 'retired'];
export const TYPES = ['tossup', 'bonus'];

const text = (v) => (v == null ? '' : String(v));
const norm = (v) => text(v).trim().toLowerCase();
const list = (v) => (Array.isArray(v) ? v.map((x) => text(x).trim()).filter(Boolean) : []);

export function emptyPart() {
  return { text: '', canonicalAnswer: '', acceptedAnswers: [], rejectedAnswers: [], approvedDistractors: [], explanation: '' };
}

export function emptyQuestion(type = 'tossup') {
  return {
    type: type === 'bonus' ? 'bonus' : 'tossup',
    setId: '',
    category: CATEGORY_IDS[0] || '',
    subcategory: '',
    gradeBand: GRADE_BANDS[0],
    difficulty: 1,
    promptLeadin: '',
    clues: [
      { text: '', difficultyWeight: 0.9 },
      { text: '', difficultyWeight: 0.6 },
      { text: '', difficultyWeight: 0.3 }
    ],
    powerClueIndex: null,
    canonicalAnswer: '',
    acceptedAnswers: [],
    rejectedAnswers: [],
    approvedDistractors: [],
    explanation: '',
    pronunciationNotes: '',
    parts: [emptyPart(), emptyPart(), emptyPart()],
    sourceOwner: '',
    license: '',
    usageWindowEnd: null
  };
}

/** Firestore doc (or import item) -> editable form state. */
export function toForm(d = {}) {
  const base = emptyQuestion(d.type);
  const clues = Array.isArray(d.clues)
    ? [...d.clues]
        .sort((a, b) => (a.clueIndex ?? 0) - (b.clueIndex ?? 0))
        .map((c) => ({ text: text(c.text), difficultyWeight: typeof c.difficultyWeight === 'number' ? c.difficultyWeight : 0.5 }))
    : base.clues;
  const parts = Array.isArray(d.parts) && d.parts.length ? d.parts.map((p) => ({ ...emptyPart(), ...p, acceptedAnswers: list(p.acceptedAnswers), rejectedAnswers: list(p.rejectedAnswers), approvedDistractors: list(p.approvedDistractors) })) : base.parts;
  while (parts.length < 3) parts.push(emptyPart());
  return {
    ...base,
    type: d.type === 'bonus' ? 'bonus' : 'tossup',
    setId: d.setId || '',
    category: d.category || base.category,
    subcategory: text(d.subcategory),
    gradeBand: d.gradeBand || base.gradeBand,
    difficulty: Number(d.difficulty) || 1,
    promptLeadin: text(d.promptLeadin),
    clues: d.type === 'bonus' && !Array.isArray(d.clues) ? base.clues : clues,
    powerClueIndex: typeof d.powerClueIndex === 'number' ? d.powerClueIndex : null,
    canonicalAnswer: text(d.canonicalAnswer),
    acceptedAnswers: list(d.acceptedAnswers),
    rejectedAnswers: list(d.rejectedAnswers),
    approvedDistractors: list(d.approvedDistractors),
    explanation: text(d.explanation),
    pronunciationNotes: text(d.pronunciationNotes),
    parts: parts.slice(0, 3),
    sourceOwner: text(d.sourceOwner),
    license: text(d.license),
    usageWindowEnd: typeof d.usageWindowEnd === 'number' ? d.usageWindowEnd : d.usageWindowEnd?.toMillis?.() ?? null
  };
}

function cleanPart(p) {
  return {
    text: text(p.text).trim(),
    canonicalAnswer: text(p.canonicalAnswer).trim(),
    acceptedAnswers: list(p.acceptedAnswers),
    rejectedAnswers: list(p.rejectedAnswers),
    approvedDistractors: list(p.approvedDistractors),
    explanation: text(p.explanation).trim()
  };
}

/** Form state -> Firestore fields (content only; the caller adds status/version/timestamps). */
export function toFirestore(f) {
  const common = {
    type: f.type,
    setId: f.setId || null,
    category: f.category,
    subcategory: text(f.subcategory).trim(),
    gradeBand: f.gradeBand,
    difficulty: Number(f.difficulty) || 1,
    promptLeadin: text(f.promptLeadin).trim(),
    explanation: text(f.explanation).trim(),
    pronunciationNotes: text(f.pronunciationNotes).trim() || null,
    sourceOwner: text(f.sourceOwner).trim() || null,
    license: text(f.license).trim() || null,
    usageWindowEnd: f.usageWindowEnd ?? null
  };
  if (f.type === 'bonus') return { ...common, parts: f.parts.slice(0, 3).map(cleanPart) };
  return {
    ...common,
    clues: f.clues.map((c, i) => ({ text: text(c.text).trim(), clueIndex: i, difficultyWeight: Number(c.difficultyWeight) })),
    powerClueIndex: typeof f.powerClueIndex === 'number' && f.powerClueIndex < f.clues.length ? f.powerClueIndex : null,
    canonicalAnswer: text(f.canonicalAnswer).trim(),
    acceptedAnswers: list(f.acceptedAnswers),
    rejectedAnswers: list(f.rejectedAnswers),
    approvedDistractors: list(f.approvedDistractors)
  };
}

export const TOSSUP_ONLY = ['clues', 'powerClueIndex', 'canonicalAnswer', 'acceptedAnswers', 'rejectedAnswers', 'approvedDistractors'];

function containsAnswer(clue, answer) {
  const a = norm(answer);
  return a.length > 0 && norm(clue).includes(a);
}

function checkAnswerSet(prefix, answer, distractors, accepted, add, warn) {
  if (!text(answer).trim()) add(`${prefix}canonicalAnswer`, 'Add the canonical answer.');
  const ds = list(distractors);
  if (ds.length !== 3) warn(`${prefix}approvedDistractors`, `Add exactly 3 distractors for multiple choice (has ${ds.length}).`);
  const bad = ds.filter((d) => norm(d) === norm(answer) || list(accepted).some((a) => norm(a) === norm(d)));
  if (bad.length) add(`${prefix}approvedDistractors`, `A distractor matches a correct answer: ${bad.join(', ')}.`);
}

/**
 * Validate a question (form state or raw import item).
 * Returns { errors: [{path, message}], warnings: [{path, message}] }.
 * Errors block review/publish and import; warnings are advice.
 */
export function validateQuestion(raw) {
  const q = raw && raw.clues && raw.parts ? raw : toForm(raw || {});
  const errors = [];
  const warnings = [];
  const add = (path, message) => errors.push({ path, message });
  const warn = (path, message) => warnings.push({ path, message });

  if (raw && raw.type && !TYPES.includes(raw.type)) add('type', `Type must be tossup or bonus (got "${raw.type}").`);
  if (!CATEGORY_IDS.includes(q.category)) add('category', `Pick a category from the list (got "${q.category || 'none'}").`);
  if (!q.subcategory.trim()) warn('subcategory', 'Add a subcategory so this question can award a knowledge card.');
  if (!GRADE_BANDS.includes(q.gradeBand)) add('gradeBand', `Grade band must be one of ${GRADE_BANDS.join(', ')}.`);
  if (![1, 2, 3].includes(Number(q.difficulty))) add('difficulty', 'Difficulty must be 1, 2, or 3.');

  if (q.type === 'bonus') {
    if (!q.promptLeadin.trim()) add('promptLeadin', 'Bonuses need a lead-in.');
    const parts = raw && Array.isArray(raw.parts) ? raw.parts : q.parts;
    if (parts.length !== 3) add('parts', `A bonus needs exactly 3 parts (has ${parts.length}).`);
    q.parts.forEach((p, i) => {
      const pre = `parts.${i}.`;
      if (!text(p.text).trim()) add(`${pre}text`, `Part ${i + 1} needs text.`);
      checkAnswerSet(pre, p.canonicalAnswer, p.approvedDistractors, p.acceptedAnswers, add, warn);
      if (containsAnswer(p.text, p.canonicalAnswer)) add(`${pre}text`, `Part ${i + 1} text gives away its answer.`);
      if (!text(p.explanation).trim()) warn(`${pre}explanation`, `Part ${i + 1} has no explanation.`);
    });
  } else {
    const clues = q.clues;
    if (!clues.length) add('clues', 'Add at least one clue.');
    clues.forEach((c, i) => {
      if (!text(c.text).trim()) add(`clues.${i}`, `Clue ${i + 1} is empty.`);
      const w = Number(c.difficultyWeight);
      if (!(w >= 0 && w <= 1)) add(`clues.${i}`, `Clue ${i + 1} weight must be between 0 and 1.`);
      if (containsAnswer(c.text, q.canonicalAnswer)) add(`clues.${i}`, `Clue ${i + 1} contains the answer "${q.canonicalAnswer.trim()}".`);
      else {
        const hit = q.acceptedAnswers.find((a) => a.length >= 4 && containsAnswer(c.text, a));
        if (hit) warn(`clues.${i}`, `Clue ${i + 1} contains the accepted answer "${hit}".`);
      }
    });
    for (let i = 1; i < clues.length; i++) {
      if (!(Number(clues[i].difficultyWeight) < Number(clues[i - 1].difficultyWeight))) {
        warn('clues', 'Clue weights should go down from the first clue (hardest) to the last (easiest).');
        break;
      }
    }
    if (q.powerClueIndex != null && (q.powerClueIndex < 0 || q.powerClueIndex >= clues.length)) add('powerClueIndex', 'The power mark points past the last clue.');
    checkAnswerSet('', q.canonicalAnswer, q.approvedDistractors, q.acceptedAnswers, add, warn);
    if (!q.explanation.trim()) warn('explanation', 'Add a short explanation kids see after answering.');
  }
  return { errors, warnings };
}

/** Messages for one path (exact) or a prefix ending in '.'. */
export function issuesFor(issues, path) {
  return issues.filter((i) => (path.endsWith('.') ? i.path.startsWith(path) : i.path === path)).map((i) => i.message);
}

/** Rights check used before publishing. */
export function rightsProblems(q) {
  const out = [];
  if (!q.setId) out.push('Pick a question set.');
  if (!text(q.sourceOwner).trim()) out.push('The source owner is missing.');
  if (!text(q.license).trim()) out.push('The license is missing.');
  if (q.usageWindowEnd != null && q.usageWindowEnd <= Date.now()) out.push('The usage window for this set has ended.');
  return out;
}
