// Bulk import questions from JSON (same shape as functions/seed/questions.json). The server creates drafts.
// Reads:  questionSets
// Writes: contentImports via request() { setId, format: 'json', payload } (one request per chunk of up to 100 questions, each under 900 KB)
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, ButtonLink, Card, Chip, ErrorNote, Field, PageHeader, ProgressBar, useToast } from '../../components/ui.jsx';
import { useQuestionSets } from '../../components/admin/common.jsx';
import { validateQuestion } from '../../components/admin/questionModel.js';
import { request } from '../../lib/requests.js';
import { downloadFile } from '../../lib/format.js';
import './admin.css';

const MAX_ITEMS = 100;
const MAX_BYTES = 900 * 1024;

const TEMPLATE = {
  set: { name: 'My question set', sourceOwner: 'Your organization', license: 'Describe the license', rightsNote: 'Who wrote these and how they may be used.', usageWindowEnd: null },
  tossups: [
    {
      type: 'tossup',
      category: 'Science',
      subcategory: 'Human Body',
      gradeBand: '4-5',
      difficulty: 1,
      promptLeadin: '',
      clues: [
        { text: 'This organ has its own natural pacemaker, a small cluster of cells called the sinoatrial node.', clueIndex: 0, difficultyWeight: 0.9 },
        { text: 'Valves called the tricuspid and the mitral keep blood flowing in one direction through this organ.', clueIndex: 1, difficultyWeight: 0.65 },
        { text: 'This organ has four chambers: two atria on top and two ventricles below them.', clueIndex: 2, difficultyWeight: 0.4 },
        { text: 'For 10 points, name this muscular organ in your chest that pumps blood through your body.', clueIndex: 3, difficultyWeight: 0.15 }
      ],
      powerClueIndex: 1,
      canonicalAnswer: 'heart',
      acceptedAnswers: [],
      rejectedAnswers: ['lungs'],
      approvedDistractors: ['Lungs', 'Brain', 'Liver'],
      explanation: 'The heart is a muscle that pushes blood around your body.',
      pronunciationNotes: null
    }
  ],
  bonuses: [
    {
      type: 'bonus',
      category: 'Science',
      subcategory: 'Earth Science',
      gradeBand: '4-5',
      difficulty: 1,
      promptLeadin: 'For 10 points each, answer these questions about the water cycle.',
      parts: [
        {
          text: 'What process turns liquid water in oceans and lakes into water vapor when the sun heats it?',
          canonicalAnswer: 'evaporation',
          acceptedAnswers: ['evaporate'],
          rejectedAnswers: ['condensation'],
          approvedDistractors: ['Condensation', 'Precipitation', 'Transpiration'],
          explanation: 'Evaporation happens when heat turns liquid water into water vapor.'
        },
        {
          text: 'What process turns water vapor high in the sky into tiny droplets that form clouds?',
          canonicalAnswer: 'condensation',
          acceptedAnswers: ['condense'],
          rejectedAnswers: ['evaporation'],
          approvedDistractors: ['Evaporation', 'Sublimation', 'Freezing'],
          explanation: 'Condensation is what makes droplets form on a cold glass.'
        },
        {
          text: 'What word names the release of water vapor into the air from the leaves of plants?',
          canonicalAnswer: 'transpiration',
          acceptedAnswers: [],
          rejectedAnswers: ['respiration'],
          approvedDistractors: ['Photosynthesis', 'Condensation', 'Precipitation'],
          explanation: 'Plants send water out through tiny holes in their leaves.'
        }
      ]
    }
  ]
};

const bytes = (s) => new Blob([s]).size;

function parse(text) {
  if (!text.trim()) return { items: [], error: null, set: null };
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { items: [], error: `This isn't valid JSON: ${e.message}`, set: null };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { items: [], error: 'Expected an object with "tossups" and "bonuses" lists.', set: null };
  const tossups = Array.isArray(data.tossups) ? data.tossups : [];
  const bonuses = Array.isArray(data.bonuses) ? data.bonuses : [];
  if (!tossups.length && !bonuses.length) return { items: [], error: 'No "tossups" or "bonuses" found.', set: data.set || null };
  const items = [
    ...tossups.map((q, i) => ({ kind: 'tossups', index: i, label: `Tossup ${i + 1}`, raw: { ...q, type: q?.type || 'tossup' } })),
    ...bonuses.map((q, i) => ({ kind: 'bonuses', index: i, label: `Bonus ${i + 1}`, raw: { ...q, type: q?.type || 'bonus' } }))
  ].map((it) => {
    const expected = it.kind === 'tossups' ? 'tossup' : 'bonus';
    const { errors, warnings } = validateQuestion(it.raw);
    const errs = errors.map((e) => e.message);
    if (it.raw.type !== expected) errs.unshift(`Listed under ${it.kind} but type is "${it.raw.type}".`);
    return { ...it, errors: errs, warnings: warnings.map((w) => w.message) };
  });
  return { items, error: null, set: data.set || null };
}

/** Split valid items into chunks of at most 100 questions and 900 KB each. */
function chunk(items) {
  const chunks = [];
  let cur = [];
  const payloadOf = (list) =>
    JSON.stringify({ tossups: list.filter((i) => i.kind === 'tossups').map((i) => i.raw), bonuses: list.filter((i) => i.kind === 'bonuses').map((i) => i.raw) });
  for (const it of items) {
    const next = [...cur, it];
    if (cur.length && (next.length > MAX_ITEMS || bytes(payloadOf(next)) > MAX_BYTES)) {
      chunks.push(cur);
      cur = [it];
    } else cur = next;
  }
  if (cur.length) chunks.push(cur);
  return chunks.map((list) => ({ list, payload: payloadOf(list) }));
}

export default function ContentImport() {
  const toast = useToast();
  const sets = useQuestionSets();
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [setId, setSetId] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const parsed = useMemo(() => parse(text), [text]);
  const valid = parsed.items.filter((i) => !i.errors.length);
  const invalid = parsed.items.filter((i) => i.errors.length);

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    setResult(null);
    setText(await f.text());
  };

  const run = async () => {
    if (!setId) {
      setError('Pick a question set first.');
      return;
    }
    const chunks = chunk(valid);
    const tooBig = chunks.find((c) => bytes(c.payload) > MAX_BYTES);
    if (tooBig) {
      setError('One question is larger than 900 KB. Shorten it and try again.');
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    let imported = 0;
    const errors = [];
    try {
      for (let i = 0; i < chunks.length; i++) {
        setProgress({ done: i, total: chunks.length });
        const r = await request('contentImports', { setId, format: 'json', payload: chunks[i].payload }, { timeoutMs: 120000 });
        imported += r?.imported || 0;
        for (const e of r?.errors || []) errors.push(chunks.length > 1 ? `Batch ${i + 1}: ${typeof e === 'string' ? e : JSON.stringify(e)}` : typeof e === 'string' ? e : JSON.stringify(e));
      }
      setProgress({ done: chunks.length, total: chunks.length });
      setResult({ imported, errors, skipped: invalid.length });
      toast(`${imported} draft ${imported === 1 ? 'question' : 'questions'} imported`);
    } catch (e) {
      setError(e);
      setResult({ imported, errors, skipped: invalid.length, partial: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page stack-xl">
      <PageHeader
        eyebrow="Content"
        title="Import questions"
        subtitle="Imported questions arrive as drafts. Each one still goes through review before it can be published."
        actions={
          <>
            <Button onClick={() => downloadFile('quizquest-import-template.json', JSON.stringify(TEMPLATE, null, 2), 'application/json')}>Download template</Button>
            <ButtonLink to="/admin/content">Back to content</ButtonLink>
          </>
        }
      />

      <Card className="stack-lg" aria-labelledby="src-title">
        <h2 id="src-title">1. Add your JSON</h2>
        <Field label="Upload a .json file" hint={fileName ? `Loaded ${fileName}` : 'Or paste the JSON below.'}>
          {(id) => <input id={id} type="file" accept="application/json,.json" className="input" onChange={onFile} />}
        </Field>
        <Field label="JSON">
          {(id) => (
            <textarea
              id={id}
              className="textarea adm-mono"
              style={{ minHeight: 220 }}
              value={text}
              spellCheck={false}
              onChange={(e) => {
                setText(e.target.value);
                setResult(null);
              }}
              placeholder='{ "tossups": [ ... ], "bonuses": [ ... ] }'
            />
          )}
        </Field>
        {parsed.error ? <ErrorNote>{parsed.error}</ErrorNote> : null}
        {parsed.set ? (
          <div className="alert alert-info">
            The file describes a set named "{parsed.set.name || 'unnamed'}". Questions go into the set you pick below.
          </div>
        ) : null}
      </Card>

      {parsed.items.length ? (
        <Card className="stack-lg" aria-labelledby="check-title">
          <div className="row-between">
            <h2 id="check-title">2. Check</h2>
            <div className="row">
              <Chip tone="green">{valid.length} ready</Chip>
              {invalid.length ? <Chip tone="coral">{invalid.length} with errors</Chip> : null}
            </div>
          </div>
          {invalid.length ? (
            <div className="stack">
              <p className="prose">Questions with errors are skipped. Fix them in the file and paste it again to include them.</p>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Item</th>
                      <th scope="col">Answer or lead-in</th>
                      <th scope="col">Errors</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invalid.map((it) => (
                      <tr key={`${it.kind}-${it.index}`}>
                        <td style={{ whiteSpace: 'nowrap', fontWeight: 800 }}>{it.label}</td>
                        <td>{it.raw.canonicalAnswer || it.raw.promptLeadin || it.raw.id || 'Unnamed'}</td>
                        <td>
                          <ul className="adm-issues">
                            {it.errors.map((e, i) => (
                              <li key={i}>{e}</li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <p className="muted">Every question passed the checks.</p>
          )}
          {valid.some((i) => i.warnings.length) ? (
            <details>
              <summary style={{ cursor: 'pointer', fontWeight: 800, minHeight: 44, display: 'flex', alignItems: 'center' }}>
                Warnings on {valid.filter((i) => i.warnings.length).length} ready questions
              </summary>
              <ul className="adm-issues" style={{ marginTop: 12 }}>
                {valid
                  .filter((i) => i.warnings.length)
                  .map((it) => (
                    <li key={`${it.kind}-${it.index}`}>
                      <strong>{it.label}:</strong> {it.warnings.join(' ')}
                    </li>
                  ))}
              </ul>
            </details>
          ) : null}
        </Card>
      ) : null}

      {parsed.items.length ? (
        <Card className="stack-lg" aria-labelledby="go-title">
          <h2 id="go-title">3. Import</h2>
          <Field label="Target question set" hint="Rights details come from this set.">
            {(id) => (
              <select id={id} className="select" value={setId} onChange={(e) => setSetId(e.target.value)}>
                <option value="">Pick a set</option>
                {sets.data.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name || s.id}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {!sets.loading && !sets.data.length ? (
            <p className="muted">
              No sets yet. Create one from <Link to="/admin/content">Content</Link> with Manage question sets.
            </p>
          ) : null}
          <ErrorNote error={sets.error} />
          {busy && progress ? (
            <div className="stack" style={{ gap: 8 }}>
              <span className="caption tabular">
                Batch {Math.min(progress.done + 1, progress.total)} of {progress.total}
              </span>
              <ProgressBar value={progress.done} max={progress.total} label="Import progress" />
            </div>
          ) : null}
          <ErrorNote error={error} />
          <div>
            <Button variant="primary" size="lg" onClick={run} loading={busy} disabled={!valid.length || !setId}>
              Import {valid.length} {valid.length === 1 ? 'question' : 'questions'} as drafts
            </Button>
          </div>
        </Card>
      ) : null}

      {result ? (
        <Card tone={result.errors.length || result.partial ? 'sun' : 'teal'} className="stack" aria-live="polite">
          <h2>{result.partial ? 'Import stopped partway' : 'Import finished'}</h2>
          <p className="tabular">
            {result.imported} imported as drafts. {result.skipped} skipped before sending. {result.errors.length} rejected by the server.
          </p>
          {result.errors.length ? (
            <ul className="adm-issues">
              {result.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          ) : null}
          <div>
            <ButtonLink to="/admin/content" variant="primary">
              See drafts
            </ButtonLink>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
