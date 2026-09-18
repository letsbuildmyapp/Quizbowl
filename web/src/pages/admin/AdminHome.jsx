// Platform overview: "Analytics and Success Measures" plus opponent reaction floors.
// Reads:  metrics/{weekKey} for the last 8 ISO weeks, config/opponents
// Writes: config/opponents { reactionFloorMs: { '0', '1', '2', '3' } } (setDoc merge)
import { useEffect, useState } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../../firebase.js';
import { Button, Card, Chip, EmptyState, ErrorNote, Field, Loading, PageHeader, Stat, useToast } from '../../components/ui.jsx';
import { BarChart, PlatformOnly } from '../../components/admin/common.jsx';
import { useDoc } from '../../hooks/useFirestore.js';
import { TIER_LABELS, catalog } from '../../lib/catalog.js';
import { weekKey } from '../../lib/format.js';
import './admin.css';

const WEEKS = 8;
const TIERS = ['0', '1', '2', '3'];
const nf = (n, digits = 0) => (n == null || Number.isNaN(n) ? 'No data' : Number(n).toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits }));
const pctText = (n) => (n == null ? 'No data' : `${Math.round(n * 100)}%`);

function lastWeekKeys() {
  const keys = [];
  for (let i = WEEKS - 1; i >= 0; i--) keys.push(weekKey(Date.now() - i * 7 * 86400000));
  return [...new Set(keys)];
}

function useMetrics() {
  const [state, setState] = useState({ loading: true, error: null, weeks: [] });
  useEffect(() => {
    let alive = true;
    const keys = lastWeekKeys();
    Promise.all(keys.map((k) => getDoc(doc(db, 'metrics', k))))
      .then((snaps) => {
        if (!alive) return;
        setState({ loading: false, error: null, weeks: snaps.map((s, i) => ({ key: keys[i], data: s.exists() ? s.data() : null })) });
      })
      .catch((error) => alive && setState({ loading: false, error, weeks: [] }));
    return () => {
      alive = false;
    };
  }, []);
  return state;
}

function versusTotals(m) {
  let played = 0;
  let wins = 0;
  for (const t of Object.values(m?.versusByTier || {})) {
    played += t?.played || 0;
    wins += t?.studentWins || 0;
  }
  return { played, wins };
}

function derive(m) {
  if (!m) return null;
  const { played } = versusTotals(m);
  return {
    active: m.activeStudents ?? 0,
    perStudent: m.activeStudents ? (m.questions || 0) / m.activeStudents : null,
    sessions: m.sessions ?? 0,
    versusPlayed: played,
    completion: typeof m.versusStarted === 'number' && m.versusStarted > 0 ? played / m.versusStarted : null,
    rematchRate: played ? (m.rematches || 0) / played : null,
    assignments: m.assignmentsCreated ?? 0,
    reportViews: m.reportViews ?? 0,
    privacy: m.privacyRequests ?? 0,
    flags: m.contentFlags ?? 0,
    denied: m.deniedAccess ?? 0
  };
}

const shortLabel = (key) => key.split('-')[1] || key;

function TierCard({ weeks }) {
  const totals = Object.fromEntries(TIERS.map((t) => [t, { played: 0, wins: 0 }]));
  for (const w of weeks) {
    for (const t of TIERS) {
      const v = w.data?.versusByTier?.[t];
      totals[t].played += v?.played || 0;
      totals[t].wins += v?.studentWins || 0;
    }
  }
  const any = TIERS.some((t) => totals[t].played > 0);
  return (
    <Card className="stack-lg" aria-labelledby="tier-title">
      <div className="stack" style={{ gap: 6 }}>
        <h2 id="tier-title">Student win rate by opponent tier</h2>
        <p className="muted prose">Last 8 weeks combined. The shaded band is the 35 to 70% target.</p>
      </div>
      {!any ? (
        <EmptyState emoji="🤖" title="No versus matches yet">
          Win rates appear once students play versus matches.
        </EmptyState>
      ) : (
        <div className="stack-lg">
          {TIERS.map((t) => {
            const { played, wins } = totals[t];
            const rate = played ? wins / played : null;
            const verdict = rate == null ? null : rate > 0.7 ? { tone: 'coral', label: 'Too easy' } : rate < 0.35 ? { tone: 'coral', label: 'Too hard' } : { tone: 'green', label: 'In range' };
            return (
              <div key={t} className="adm-tier-row">
                <div className="row-between">
                  <strong>
                    Tier {t}: {TIER_LABELS[Number(t)] || 'Tier'}
                  </strong>
                  <span className="row" style={{ gap: 10 }}>
                    <span className="tabular" style={{ fontWeight: 800 }}>
                      {rate == null ? 'No matches' : `${Math.round(rate * 100)}%`}
                    </span>
                    <span className="caption tabular">
                      {wins}/{played} won
                    </span>
                    {verdict ? <Chip tone={verdict.tone}>{verdict.label}</Chip> : null}
                  </span>
                </div>
                <div className="adm-band" aria-hidden>
                  <div className="adm-band-target" />
                  {rate != null ? <div className="adm-band-marker" style={{ left: `${rate * 100}%` }} /> : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function FloorsCard() {
  const cfg = useDoc('config/opponents');
  const toast = useToast();
  const [values, setValues] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (cfg.loading) return;
    const src = cfg.data?.reactionFloorMs || catalog.reactionFloorMs || { 0: 1800, 1: 1200, 2: 900, 3: 600 };
    setValues(Object.fromEntries(TIERS.map((t) => [t, String(src[t] ?? '')])));
  }, [cfg.loading, cfg.data]);

  if (cfg.loading || !values) return <Card><Loading label="Loading opponent settings…" /></Card>;

  const nums = TIERS.map((t) => Number(values[t]));
  const problems = [];
  TIERS.forEach((t, i) => {
    if (!Number.isFinite(nums[i]) || values[t] === '') problems.push(`Tier ${t} needs a number.`);
    else if (nums[i] < 300) problems.push(`Tier ${t} must be at least 300 ms.`);
    if (i > 0 && nums[i] > nums[i - 1]) problems.push(`Tier ${t} can't be slower than tier ${TIERS[i - 1]}.`);
  });

  const save = async (e) => {
    e.preventDefault();
    if (problems.length) return;
    setBusy(true);
    setError(null);
    try {
      await setDoc(doc(db, 'config', 'opponents'), { reactionFloorMs: Object.fromEntries(TIERS.map((t, i) => [t, Math.round(nums[i])])) }, { merge: true });
      toast('Reaction floors saved');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card aria-labelledby="floors-title">
      <form className="stack-lg" onSubmit={save}>
        <div className="stack" style={{ gap: 6 }}>
          <h2 id="floors-title">Opponent reaction floors</h2>
          <p className="muted prose">The fastest a computer opponent may buzz, per tier. Higher tiers must be equal or faster. Minimum 300 ms.</p>
        </div>
        {cfg.error ? <ErrorNote error={cfg.error} /> : null}
        <div className="adm-filters">
          {TIERS.map((t) => (
            <Field key={t} label={`Tier ${t}: ${TIER_LABELS[Number(t)]} (ms)`}>
              {(id) => (
                <input
                  id={id}
                  className="input tabular"
                  type="number"
                  inputMode="numeric"
                  min={300}
                  step={50}
                  value={values[t]}
                  onChange={(e) => setValues((v) => ({ ...v, [t]: e.target.value }))}
                />
              )}
            </Field>
          ))}
        </div>
        {problems.length ? (
          <div className="alert alert-error" role="alert">
            <ul className="adm-issues">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <ErrorNote error={error} />
        <div>
          <Button type="submit" variant="primary" loading={busy} disabled={problems.length > 0}>
            Save floors
          </Button>
        </div>
      </form>
    </Card>
  );
}

function AdminHomeInner() {
  const metrics = useMetrics();
  const rows = metrics.weeks.map((w) => ({ key: w.key, label: shortLabel(w.key), m: derive(w.data) }));
  const hasAny = rows.some((r) => r.m);
  const cur = rows[rows.length - 1]?.m;
  const prev = rows[rows.length - 2]?.m;
  const prevHint = (v, fmt = nf) => (prev ? `Last week ${fmt(v(prev))}` : 'No data last week');
  const series = (fn, fmt) => rows.map((r) => ({ key: r.key, label: r.label, value: r.m ? fn(r.m) : null, display: r.m && fn(r.m) != null ? fmt(fn(r.m)) : undefined }));

  return (
    <div className="page stack-xl">
      <PageHeader eyebrow="Platform" title="Analytics and Success Measures" subtitle="Weekly counters with no student identities. Weeks run Monday to Sunday." />

      {metrics.loading ? <Loading label="Loading metrics…" /> : null}
      <ErrorNote error={metrics.error} />

      {!metrics.loading && !metrics.error && !hasAny ? (
        <EmptyState emoji="📊" title="No metrics yet">
          Weekly counters appear here once schools start playing.
        </EmptyState>
      ) : null}

      {hasAny ? (
        <>
          <section aria-labelledby="week-title" className="stack">
            <h2 id="week-title">This week</h2>
            <div className="adm-kpis">
              <Card><Stat value={nf(cur?.active)} label="Active students" hint={prevHint((m) => m.active)} color="var(--purple)" /></Card>
              <Card><Stat value={nf(cur?.perStudent, 1)} label="Questions per student" hint={prevHint((m) => m.perStudent, (v) => nf(v, 1))} color="var(--teal)" /></Card>
              <Card><Stat value={nf(cur?.sessions)} label="Sessions" hint={prevHint((m) => m.sessions)} /></Card>
              <Card><Stat value={pctText(cur?.completion)} label="Versus completion" hint={cur && cur.completion == null ? 'Needs a versusStarted counter' : prevHint((m) => m.completion, pctText)} /></Card>
              <Card><Stat value={pctText(cur?.rematchRate)} label="Rematch rate" hint={prevHint((m) => m.rematchRate, pctText)} color="var(--coral)" /></Card>
            </div>
          </section>

          <div className="grid-2">
            <Card className="stack-lg" aria-labelledby="c-active">
              <h2 id="c-active">Weekly active students</h2>
              <BarChart title="Weekly active students" data={series((m) => m.active, (v) => nf(v))} />
            </Card>
            <Card className="stack-lg" aria-labelledby="c-per">
              <h2 id="c-per">Questions per active student</h2>
              <BarChart title="Questions per active student" color="var(--teal)" data={series((m) => m.perStudent, (v) => nf(v, 1))} />
            </Card>
            <Card className="stack-lg" aria-labelledby="c-sessions">
              <h2 id="c-sessions">Sessions</h2>
              <BarChart title="Sessions" color="var(--sun)" data={series((m) => m.sessions, (v) => nf(v))} />
            </Card>
            <Card className="stack-lg" aria-labelledby="c-rematch">
              <h2 id="c-rematch">Versus rematch rate</h2>
              <BarChart title="Versus rematch rate" color="var(--coral)" max={1} data={series((m) => m.rematchRate, pctText)} />
            </Card>
          </div>

          <TierCard weeks={metrics.weeks} />

          <section className="stack" aria-labelledby="table-title">
            <h2 id="table-title">Week by week</h2>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Week</th>
                    <th scope="col" className="num">Active</th>
                    <th scope="col" className="num">Q per student</th>
                    <th scope="col" className="num">Sessions</th>
                    <th scope="col" className="num">Versus</th>
                    <th scope="col" className="num">Completion</th>
                    <th scope="col" className="num">Rematch</th>
                    <th scope="col" className="num">Assignments</th>
                    <th scope="col" className="num">Report views</th>
                    <th scope="col" className="num">Privacy requests</th>
                    <th scope="col" className="num">Content flags</th>
                    <th scope="col" className="num">Denied access</th>
                  </tr>
                </thead>
                <tbody>
                  {[...rows].reverse().map((r) => (
                    <tr key={r.key}>
                      <th scope="row" className="tabular">{r.key}</th>
                      {r.m ? (
                        <>
                          <td className="num">{nf(r.m.active)}</td>
                          <td className="num">{nf(r.m.perStudent, 1)}</td>
                          <td className="num">{nf(r.m.sessions)}</td>
                          <td className="num">{nf(r.m.versusPlayed)}</td>
                          <td className="num">{pctText(r.m.completion)}</td>
                          <td className="num">{pctText(r.m.rematchRate)}</td>
                          <td className="num">{nf(r.m.assignments)}</td>
                          <td className="num">{nf(r.m.reportViews)}</td>
                          <td className="num">{nf(r.m.privacy)}</td>
                          <td className="num">{nf(r.m.flags)}</td>
                          <td className="num">
                            {r.m.denied > 0 ? <Chip tone="coral">{nf(r.m.denied)}</Chip> : nf(r.m.denied)}
                          </td>
                        </>
                      ) : (
                        <td colSpan={11} className="muted">No data for this week</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}

      <FloorsCard />
    </div>
  );
}

export default function AdminHome() {
  return (
    <PlatformOnly>
      <AdminHomeInner />
    </PlatformOnly>
  );
}
