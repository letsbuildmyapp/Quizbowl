// Create or edit one question, move it through the review lifecycle, preview it as a student.
// Reads:  questions/{id}, questions/{id}/history (orderBy version desc), questionSets,
//         contentFlags (questionId == id, status == 'open')
// Writes: questions/{auto} (new): { ...content fields, status: 'draft', version: 1, createdBy, createdAt, updatedAt }
//         questions/{id} (edit):   { ...content fields, version: increment(1), updatedAt, updatedBy }
//         questions/{id} (status): { status, version: increment(1), updatedAt, updatedBy, reviewedBy? }
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { addDoc, collection, deleteField, doc, getDoc, increment, limit, orderBy, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { db } from '../../firebase.js';
import { Button, ButtonLink, Card, ConfirmModal, EmptyState, ErrorNote, Field, Loading, PageHeader, Segmented, useToast } from '../../components/ui.jsx';
import { QStatusChip, useQuestionSets, when } from '../../components/admin/common.jsx';
import { GRADE_BANDS, TOSSUP_ONLY, emptyQuestion, issuesFor, rightsProblems, toFirestore, toForm, validateQuestion } from '../../components/admin/questionModel.js';
import { useAuth } from '../../hooks/useAuth.jsx';
import { useQuery } from '../../hooks/useFirestore.js';
import { CATEGORIES, categoryMeta } from '../../lib/catalog.js';
import './admin.css';

const TRANSITIONS = {
  draft: [{ to: 'review', label: 'Submit for review', variant: 'primary', needsValid: true }],
  review: [
    { to: 'approved', label: 'Approve', variant: 'teal', needsValid: true },
    { to: 'draft', label: 'Send back' }
  ],
  approved: [{ to: 'published', label: 'Publish', variant: 'primary', needsValid: true, needsRights: true }],
  published: [{ to: 'retired', label: 'Retire', variant: 'danger', confirm: true }],
  retired: [{ to: 'draft', label: 'Reopen' }]
};

function Issues({ list }) {
  if (!list?.length) return null;
  return (
    <span className="error" role="alert">
      {list.join(' ')}
    </span>
  );
}

/** One-per-line list editor that keeps the raw text while typing. */
function ListField({ label, hint, value, onChange, error }) {
  const [text, setText] = useState(value.join('\n'));
  useEffect(() => {
    const parsed = text.split('\n').map((s) => s.trim()).filter(Boolean);
    if (parsed.join('\n') !== value.join('\n')) setText(value.join('\n'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <Field label={label} hint={hint} error={error}>
      {(id) => (
        <textarea
          id={id}
          className="textarea"
          style={{ minHeight: 96 }}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            onChange(e.target.value.split('\n').map((s) => s.trim()).filter(Boolean));
          }}
        />
      )}
    </Field>
  );
}

function AnswerFields({ value, onChange, issues, prefix }) {
  const set = (k) => (v) => onChange({ ...value, [k]: v });
  const one = (p) => issuesFor(issues, `${prefix}${p}`).join(' ') || undefined;
  return (
    <>
      <Field label="Canonical answer" error={one('canonicalAnswer')}>
        {(id) => <input id={id} className="input" value={value.canonicalAnswer} onChange={(e) => set('canonicalAnswer')(e.target.value)} />}
      </Field>
      <div className="grid-3">
        <ListField label="Accepted answers" hint="One per line." value={value.acceptedAnswers} onChange={set('acceptedAnswers')} />
        <ListField label="Rejected answers" hint="One per line. Close but wrong." value={value.rejectedAnswers} onChange={set('rejectedAnswers')} />
        <ListField
          label="Distractors"
          hint="One per line. 3 recommended."
          value={value.approvedDistractors}
          onChange={set('approvedDistractors')}
          error={one('approvedDistractors')}
        />
      </div>
    </>
  );
}

function CluesEditor({ form, setForm, issues }) {
  const clues = form.clues;
  const update = (next) => setForm((f) => ({ ...f, clues: next }));
  const move = (i, d) => {
    const next = [...clues];
    const [c] = next.splice(i, 1);
    next.splice(i + d, 0, c);
    let power = form.powerClueIndex;
    if (power === i) power = i + d;
    else if (power === i + d) power = i;
    setForm((f) => ({ ...f, clues: next, powerClueIndex: power }));
  };
  const remove = (i) => {
    const next = clues.filter((_, j) => j !== i);
    let power = form.powerClueIndex;
    if (power === i) power = null;
    else if (power != null && power > i) power -= 1;
    setForm((f) => ({ ...f, clues: next, powerClueIndex: power }));
  };
  const add = () => {
    const lastW = clues.length ? Number(clues[clues.length - 1].difficultyWeight) || 0.2 : 1;
    update([...clues, { text: '', difficultyWeight: Math.max(0, Math.round((lastW - 0.15) * 100) / 100) }]);
  };
  const general = issuesFor(issues.errors, 'clues');
  const orderWarn = issuesFor(issues.warnings, 'clues');

  return (
    <div className="stack">
      <div className="row-between">
        <h3>Clues</h3>
        <span className="caption">Hardest first. The last clue is the giveaway.</span>
      </div>
      {clues.map((c, i) => {
        const errs = issuesFor(issues.errors, `clues.${i}`);
        const warns = issuesFor(issues.warnings, `clues.${i}`);
        return (
          <div key={i} className="adm-clue" data-error={errs.length > 0}>
            <div className="adm-clue-head">
              <strong>
                Clue {i + 1}
                {form.powerClueIndex === i ? <span className="chip chip-sun" style={{ marginLeft: 8 }}>Power ends here</span> : null}
              </strong>
              <div className="row" style={{ gap: 6 }}>
                <Button variant="ghost" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move clue ${i + 1} up`}>
                  ↑ Up
                </Button>
                <Button variant="ghost" onClick={() => move(i, 1)} disabled={i === clues.length - 1} aria-label={`Move clue ${i + 1} down`}>
                  ↓ Down
                </Button>
                <Button variant="danger" onClick={() => remove(i)} disabled={clues.length <= 1} aria-label={`Remove clue ${i + 1}`}>
                  Remove
                </Button>
              </div>
            </div>
            <Field label={`Clue ${i + 1} text`}>
              {(id) => (
                <textarea
                  id={id}
                  className="textarea"
                  style={{ minHeight: 80 }}
                  value={c.text}
                  onChange={(e) => update(clues.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
                />
              )}
            </Field>
            <div className="adm-clue-weight">
              <label htmlFor={`w-${i}`} className="label">
                Difficulty weight
              </label>
              <input
                id={`w-${i}`}
                className="input tabular"
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={c.difficultyWeight}
                onChange={(e) => update(clues.map((x, j) => (j === i ? { ...x, difficultyWeight: e.target.value === '' ? '' : Number(e.target.value) } : x)))}
              />
              <span className="caption">0 easy to 1 hard</span>
            </div>
            {errs.length ? <span className="error" role="alert" style={{ color: 'var(--coral)', fontWeight: 700 }}>{errs.join(' ')}</span> : null}
            {warns.length ? <div className="adm-warn">{warns.join(' ')}</div> : null}
          </div>
        );
      })}
      {general.length ? <Issues list={general} /> : null}
      {orderWarn.length ? <div className="adm-warn">{orderWarn.join(' ')}</div> : null}
      <div>
        <Button onClick={add}>Add clue</Button>
      </div>
    </div>
  );
}

function Preview({ form }) {
  const cat = categoryMeta(form.category);
  return (
    <Card className="stack" aria-labelledby="preview-title">
      <h2 id="preview-title">Preview as a student</h2>
      <span className="caption">
        <span aria-hidden>{cat.emoji} </span>
        {form.category} {form.subcategory ? `· ${form.subcategory}` : ''}
      </span>
      {form.type === 'bonus' ? (
        <div className="adm-preview">
          <div className="adm-preview-clue" style={{ fontWeight: 800 }}>{form.promptLeadin || 'Lead-in goes here.'}</div>
          {form.parts.map((p, i) => (
            <div key={i} className="stack" style={{ gap: 6 }}>
              <div className="adm-preview-clue">
                <span className="caption">Part {i + 1}</span>
                {p.text || 'Part text goes here.'}
              </div>
              <div className="adm-preview-answer">Answer: {p.canonicalAnswer || 'not set'}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="adm-preview">
          {form.promptLeadin ? <div className="caption">{form.promptLeadin}</div> : null}
          {form.clues.map((c, i) => (
            <div key={i} className="adm-preview-clue" data-power={form.powerClueIndex != null && i <= form.powerClueIndex}>
              <span className="caption">
                Clue {i + 1}
                {form.powerClueIndex != null && i <= form.powerClueIndex ? ' · power zone' : ''}
              </span>
              {c.text || 'Clue text goes here.'}
            </div>
          ))}
          <div className="adm-preview-answer">Answer: {form.canonicalAnswer || 'not set'}</div>
          {form.approvedDistractors.length ? (
            <div className="caption">Choices: {[form.canonicalAnswer, ...form.approvedDistractors].filter(Boolean).join(', ')}</div>
          ) : null}
        </div>
      )}
      {form.explanation ? <p className="muted">{form.explanation}</p> : null}
    </Card>
  );
}

function History({ id }) {
  const hist = useQuery(() => (id ? query(collection(db, 'questions', id, 'history'), orderBy('version', 'desc'), limit(20)) : null), [id]);
  return (
    <Card className="stack" aria-labelledby="hist-title">
      <h2 id="hist-title">Version history</h2>
      {hist.loading ? <Loading /> : null}
      <ErrorNote error={hist.error} />
      {!hist.loading && !hist.error && !hist.data.length ? <p className="muted">No history yet. Saved changes show up here.</p> : null}
      {hist.data.length ? (
        <ol className="adm-history">
          {hist.data.map((h) => {
            const changes = Array.isArray(h.changes) ? h.changes.join(', ') : h.changes && typeof h.changes === 'object' ? Object.keys(h.changes).join(', ') : h.changes || '';
            return (
              <li key={h.id}>
                <div className="row-between">
                  <strong className="tabular">Version {h.version ?? h.id}</strong>
                  {h.status ? <QStatusChip status={h.status} /> : null}
                </div>
                <span className="caption tabular">{when(h.at)}</span>
                {changes ? <span className="caption">Changed: {changes}</span> : null}
              </li>
            );
          })}
        </ol>
      ) : null}
    </Card>
  );
}

function OpenFlags({ id }) {
  const flags = useQuery(() => (id ? query(collection(db, 'contentFlags'), where('questionId', '==', id), where('status', '==', 'open')) : null), [id]);
  return (
    <Card className="stack" aria-labelledby="flags-title">
      <div className="row-between">
        <h2 id="flags-title">Open flags</h2>
        <Link to="/admin/flags">All flags</Link>
      </div>
      {flags.loading ? <Loading /> : null}
      <ErrorNote error={flags.error} />
      {!flags.loading && !flags.error && !flags.data.length ? <p className="muted">No open flags.</p> : null}
      {flags.data.map((f) => (
        <div key={f.id} className="stack" style={{ gap: 4 }}>
          <strong>{f.reason || 'Flag'}</strong>
          {f.note ? <span>{f.note}</span> : null}
          <span className="caption">
            From a {f.role || 'user'} · {when(f.createdAt)}
          </span>
        </div>
      ))}
    </Card>
  );
}

export default function QuestionEditor() {
  const { questionId } = useParams();
  const [params] = useSearchParams();
  const isNew = questionId === 'new';
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const sets = useQuestionSets();

  const [meta, setMeta] = useState(null); // saved doc (status, version, createdBy, ...)
  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const typeParam = params.get('type') || 'tossup';
  const load = useCallback(async () => {
    if (isNew) {
      const f = emptyQuestion(typeParam);
      setForm(f);
      setSaved(f);
      setMeta(null);
      return;
    }
    try {
      const snap = await getDoc(doc(db, 'questions', questionId));
      if (!snap.exists()) {
        setLoadError('missing');
        return;
      }
      const data = snap.data();
      const f = toForm(data);
      setMeta({ id: snap.id, ...data });
      setForm(f);
      setSaved(f);
    } catch (e) {
      setLoadError(e);
    }
  }, [isNew, questionId, typeParam]);

  useEffect(() => {
    setLoadError(null);
    setForm(null);
    load();
  }, [load]);

  const issues = useMemo(() => (form ? validateQuestion(form) : { errors: [], warnings: [] }), [form]);
  const dirty = form && saved && JSON.stringify(form) !== JSON.stringify(saved);

  if (loadError === 'missing') {
    return (
      <div className="page">
        <EmptyState emoji="🔍" title="Question not found" action={<ButtonLink to="/admin/content">Back to content</ButtonLink>} />
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="page">
        <ErrorNote error={loadError} />
      </div>
    );
  }
  if (!form) return <Loading full label="Loading question…" />;

  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const err = (p) => issuesFor(issues.errors, p).join(' ') || undefined;
  const warnText = (p) => issuesFor(issues.warnings, p).join(' ') || undefined;
  const chosenSet = sets.data.find((s) => s.id === form.setId);

  const pickSet = (id) => {
    const s = sets.data.find((x) => x.id === id);
    setForm((f) => ({
      ...f,
      setId: id,
      sourceOwner: s?.sourceOwner || '',
      license: s?.license || '',
      usageWindowEnd: typeof s?.usageWindowEnd === 'number' ? s.usageWindowEnd : s?.usageWindowEnd?.toMillis?.() ?? null
    }));
  };

  const save = async () => {
    setBusy('save');
    setError(null);
    try {
      const content = toFirestore(form);
      if (isNew) {
        const ref = await addDoc(collection(db, 'questions'), {
          ...content,
          status: 'draft',
          version: 1,
          createdBy: user.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        toast('Draft created');
        navigate(`/admin/content/${ref.id}`, { replace: true });
        return;
      }
      const removed = form.type === 'bonus' ? Object.fromEntries(TOSSUP_ONLY.map((k) => [k, deleteField()])) : { parts: deleteField() };
      await updateDoc(doc(db, 'questions', questionId), {
        ...removed,
        ...content,
        version: increment(1),
        updatedAt: serverTimestamp(),
        updatedBy: user.uid
      });
      toast('Saved');
      await load();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  const transition = async (t) => {
    setBusy(t.to);
    setError(null);
    try {
      const patch = { status: t.to, version: increment(1), updatedAt: serverTimestamp(), updatedBy: user.uid };
      if (t.to === 'approved') patch.reviewedBy = user.uid;
      await updateDoc(doc(db, 'questions', questionId), patch);
      setConfirm(null);
      toast(`Status: ${t.label}`);
      await load();
    } catch (e) {
      setError(e);
      setConfirm(null);
    } finally {
      setBusy(null);
    }
  };

  const status = meta?.status || 'draft';
  const rights = rightsProblems(form);
  const isAuthor = meta?.createdBy && meta.createdBy === user.uid;
  const blockReason = (t) => {
    if (dirty) return 'Save your changes first.';
    if (t.needsValid && issues.errors.length) return 'Fix the errors marked below first.';
    if (t.needsRights && rights.length) return rights.join(' ');
    return null;
  };
  const onTransition = (t) => {
    if (t.to === 'approved' && isAuthor) setConfirm({ ...t, title: 'Approve your own question?', body: 'You wrote this question. A second reviewer catches more mistakes. Approve it anyway?', label: 'Approve anyway' });
    else if (t.confirm) setConfirm({ ...t, title: 'Retire this question?', body: 'Retired questions stop appearing in games. You can reopen it as a draft later.', label: 'Retire' });
    else transition(t);
  };

  return (
    <div className="page stack-xl">
      <PageHeader
        eyebrow={isNew ? 'New question' : `Question · version ${meta?.version ?? 1}`}
        title={isNew ? `New ${form.type}` : (form.type === 'bonus' ? form.promptLeadin : form.canonicalAnswer) || 'Untitled question'}
        actions={
          <>
            {!isNew ? <QStatusChip status={status} /> : null}
            <ButtonLink to="/admin/content">Back to content</ButtonLink>
          </>
        }
      />

      {!isNew ? (
        <Card className="stack" aria-labelledby="life-title">
          <div className="row-between">
            <h2 id="life-title">Review status</h2>
            <span className="caption">
              Created {when(meta?.createdAt)} · Updated {when(meta?.updatedAt)}
            </span>
          </div>
          <div className="row">
            {(TRANSITIONS[status] || []).map((t) => {
              const reason = blockReason(t);
              return (
                <Button key={t.to} variant={t.variant} onClick={() => onTransition(t)} disabled={!!reason || !!busy} loading={busy === t.to} title={reason || undefined}>
                  {t.label}
                </Button>
              );
            })}
          </div>
          {(TRANSITIONS[status] || []).some((t) => blockReason(t)) ? (
            <p className="caption">{blockReason((TRANSITIONS[status] || []).find((t) => blockReason(t)))}</p>
          ) : null}
          {status === 'review' && isAuthor ? <div className="adm-warn">You wrote this question. Ask another content admin to approve it when possible.</div> : null}
        </Card>
      ) : null}

      <div className="adm-editor">
        <div className="stack-xl">
          <Card className="stack-lg" aria-labelledby="basics-title">
            <h2 id="basics-title">Basics</h2>
            <Field label="Type">
              {() => <Segmented label="Question type" value={form.type} onChange={set('type')} options={[{ value: 'tossup', label: 'Tossup' }, { value: 'bonus', label: 'Bonus' }]} />}
            </Field>
            <div className="grid-2">
              <Field label="Question set" error={err('setId')} hint={sets.data.length ? undefined : 'Create a set under Manage question sets first.'}>
                {(id) => (
                  <select id={id} className="select" value={form.setId} onChange={(e) => pickSet(e.target.value)}>
                    <option value="">No set yet</option>
                    {sets.data.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name || s.id}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Category" error={err('category')}>
                {(id) => (
                  <select id={id} className="select" value={form.category} onChange={(e) => set('category')(e.target.value)}>
                    {CATEGORIES.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.emoji} {c.id}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Subcategory (knowledge card topic)" error={warnText('subcategory')}>
                {(id) => <input id={id} className="input" value={form.subcategory} onChange={(e) => set('subcategory')(e.target.value)} placeholder="e.g. Solar System" />}
              </Field>
              <Field label="Grade band" error={err('gradeBand')}>
                {(id) => (
                  <select id={id} className="select" value={form.gradeBand} onChange={(e) => set('gradeBand')(e.target.value)}>
                    {GRADE_BANDS.map((g) => (
                      <option key={g} value={g}>
                        Grades {g}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            </div>
            <Field label="Difficulty" error={err('difficulty')}>
              {() => (
                <Segmented
                  label="Difficulty"
                  value={Number(form.difficulty)}
                  onChange={set('difficulty')}
                  options={[
                    { value: 1, label: '1 Easier' },
                    { value: 2, label: '2 Medium' },
                    { value: 3, label: '3 Harder' }
                  ]}
                />
              )}
            </Field>
            <dl className="adm-dl">
              <dt>Source owner</dt>
              <dd>{form.sourceOwner || 'Not set'}</dd>
              <dt>License</dt>
              <dd>{form.license || 'Not set'}</dd>
              <dt>Usage ends</dt>
              <dd>{form.usageWindowEnd ? when(form.usageWindowEnd, false) : 'No end date'}</dd>
            </dl>
            <span className="caption">Rights details copy from the chosen set{chosenSet ? `: ${chosenSet.name}` : ''}.</span>
          </Card>

          <Card className="stack-lg" aria-labelledby="body-title">
            <h2 id="body-title">{form.type === 'bonus' ? 'Bonus' : 'Tossup'}</h2>
            <Field label={form.type === 'bonus' ? 'Lead-in' : 'Lead-in (optional)'} error={err('promptLeadin')}>
              {(id) => <input id={id} className="input" value={form.promptLeadin} onChange={(e) => set('promptLeadin')(e.target.value)} />}
            </Field>

            {form.type === 'bonus' ? (
              form.parts.map((p, i) => (
                <div key={i} className="adm-clue" data-error={issuesFor(issues.errors, `parts.${i}.`).length > 0}>
                  <h3>Part {i + 1}</h3>
                  <Field label={`Part ${i + 1} text`} error={err(`parts.${i}.text`)}>
                    {(id) => (
                      <textarea
                        id={id}
                        className="textarea"
                        style={{ minHeight: 80 }}
                        value={p.text}
                        onChange={(e) => set('parts')(form.parts.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
                      />
                    )}
                  </Field>
                  <AnswerFields
                    value={p}
                    issues={issues.errors.concat(issues.warnings)}
                    prefix={`parts.${i}.`}
                    onChange={(v) => set('parts')(form.parts.map((x, j) => (j === i ? v : x)))}
                  />
                  <Field label="Explanation">
                    {(id) => (
                      <textarea
                        id={id}
                        className="textarea"
                        style={{ minHeight: 80 }}
                        value={p.explanation}
                        onChange={(e) => set('parts')(form.parts.map((x, j) => (j === i ? { ...x, explanation: e.target.value } : x)))}
                      />
                    )}
                  </Field>
                </div>
              ))
            ) : (
              <>
                <CluesEditor form={form} setForm={setForm} issues={issues} />
                <Field label="Power clue" hint="Buzzing correctly during or before this clue earns a power." error={err('powerClueIndex')}>
                  {(id) => (
                    <select
                      id={id}
                      className="select"
                      value={form.powerClueIndex ?? ''}
                      onChange={(e) => set('powerClueIndex')(e.target.value === '' ? null : Number(e.target.value))}
                    >
                      <option value="">No power</option>
                      {form.clues.map((_, i) => (
                        <option key={i} value={i}>
                          Through clue {i + 1}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                <AnswerFields
                  value={form}
                  issues={issues.errors.concat(issues.warnings)}
                  prefix=""
                  onChange={(v) =>
                    setForm((f) => ({
                      ...f,
                      canonicalAnswer: v.canonicalAnswer,
                      acceptedAnswers: v.acceptedAnswers,
                      rejectedAnswers: v.rejectedAnswers,
                      approvedDistractors: v.approvedDistractors
                    }))
                  }
                />
              </>
            )}

            <Field label="Explanation" hint="What kids see after answering." error={warnText('explanation')}>
              {(id) => <textarea id={id} className="textarea" value={form.explanation} onChange={(e) => set('explanation')(e.target.value)} />}
            </Field>
            <Field label="Pronunciation notes (optional)" hint="For read-aloud, e.g. Sinoatrial: sigh-no-AY-tree-ul.">
              {(id) => <input id={id} className="input" value={form.pronunciationNotes} onChange={(e) => set('pronunciationNotes')(e.target.value)} />}
            </Field>
          </Card>

          {issues.errors.length || issues.warnings.length ? (
            <Card className="stack" aria-labelledby="check-title">
              <h2 id="check-title">Checks</h2>
              {issues.errors.length ? (
                <div className="alert alert-error" role="status">
                  <strong>Fix before review or publish:</strong>
                  <ul className="adm-issues">
                    {issues.errors.map((e, i) => (
                      <li key={i}>{e.message}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {issues.warnings.length ? (
                <div className="adm-warn">
                  <strong>Worth a look:</strong>
                  <ul className="adm-issues">
                    {issues.warnings.map((e, i) => (
                      <li key={i}>{e.message}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </Card>
          ) : null}

          <ErrorNote error={error} />
          <div className="row">
            <Button variant="primary" size="lg" onClick={save} loading={busy === 'save'} disabled={(!dirty && !isNew) || !!busy}>
              {isNew ? 'Create draft' : 'Save changes'}
            </Button>
            {dirty && !isNew ? (
              <Button variant="ghost" onClick={() => setForm(saved)} disabled={!!busy}>
                Discard changes
              </Button>
            ) : null}
          </div>
        </div>

        <aside className="adm-side" aria-label="Preview and history">
          <Preview form={form} />
          {!isNew ? <OpenFlags id={questionId} /> : null}
          {!isNew ? <History id={questionId} /> : null}
        </aside>
      </div>

      <ConfirmModal
        open={!!confirm}
        title={confirm?.title}
        body={confirm?.body}
        confirmLabel={confirm?.label}
        danger={confirm?.to === 'retired'}
        busy={!!confirm && busy === confirm.to}
        onConfirm={() => transition(confirm)}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
