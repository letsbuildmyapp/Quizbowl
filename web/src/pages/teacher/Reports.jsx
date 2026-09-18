// Class reports: per-student table, category trends by week, computer opponent results,
// assignment completion, CSV export. All totals come from sessionSummaries.
// Firestore reads: classrooms (useClassroom), students where classroomId ==,
//   sessionSummaries where classroomId == X and completedAt >= since (and <= until),
//   assignments where classroomId ==, assignments/{id}/progress/*.
// Firestore writes: analyticsEvents/{auto} { type: 'report_view', createdAt: ts }.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase.js';
import { useClassroom } from '../../hooks/useClassroom.js';
import { categoryMeta, TIER_LABELS } from '../../lib/catalog.js';
import { downloadFile, fmtDate, fmtNum, toCsv, weekKey } from '../../lib/format.js';
import { Avatar, Button, Card, EmptyState, ErrorNote, Field, Loading, Segmented, Stat } from '../../components/ui.jsx';
import { ClassGate, TeacherHeader, useRoster, useSummaries } from '../../components/teacher/TeacherPage.jsx';
import { AssignmentCompletion, useAssignments } from '../../components/teacher/assignments.jsx';
import { DAY_MS, byStudent, categoryTotals, orderedCategories, pctText, personaResults, totals } from '../../components/teacher/stats.js';

const toInputDate = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Where in the tossup a student usually buzzes correctly, from all-time student stats. */
function clueText(student) {
  const s = student?.stats;
  if (!s?.correct || s.clueFractionSum == null) return 'n/a';
  return `${Math.round((s.clueFractionSum / s.correct) * 100)}%`;
}

function useReportView() {
  const logged = useRef(false);
  useEffect(() => {
    if (logged.current) return;
    logged.current = true;
    addDoc(collection(db, 'analyticsEvents'), { type: 'report_view', createdAt: serverTimestamp() }).catch(() => {});
  }, []);
}

function CategoryTrends({ summaries }) {
  const { weeks, rows } = useMemo(() => {
    const byWeek = {};
    for (const s of summaries) (byWeek[s.weekKey || weekKey(s.completedAt)] ||= []).push(s);
    const wk = Object.keys(byWeek).sort();
    const perWeek = Object.fromEntries(wk.map((w) => [w, categoryTotals(byWeek[w])]));
    const all = categoryTotals(summaries);
    const cats = orderedCategories(all).filter((c) => all[c]?.seen);
    return { weeks: wk, rows: cats.map((c) => ({ cat: c, weeks: wk.map((w) => perWeek[w][c] || null) })) };
  }, [summaries]);

  if (!rows.length) return <EmptyState emoji="📈" title="No category data yet">Trends show up after students finish a few games.</EmptyState>;
  return (
    <div className="stack-lg">
      <p className="caption">Each bar is one week, oldest on the left. Height shows accuracy. Weeks: {weeks.join(', ')}.</p>
      <div className="grid-3">
        {rows.map(({ cat, weeks: wks }) => {
          const meta = categoryMeta(cat);
          return (
            <div key={cat} className="stack" style={{ gap: 8 }}>
              <span style={{ fontWeight: 800 }}>
                <span aria-hidden>{meta.emoji} </span>
                {cat}
              </span>
              <div className="t-trend" role="list" aria-label={`${cat} accuracy by week`}>
                {wks.map((v, i) => {
                  const label = v?.answered ? pctText(v.correct, v.answered) : 'no answers';
                  return v?.answered ? (
                    <span
                      key={weeks[i]}
                      role="listitem"
                      className="t-trend-bar"
                      title={`${weeks[i]}: ${label}`}
                      aria-label={`${weeks[i]}: ${label}`}
                      style={{ height: `${Math.max(6, Math.round((v.correct / v.answered) * 100))}%`, background: meta.color }}
                    />
                  ) : (
                    <span key={weeks[i]} role="listitem" className="t-trend-empty" aria-label={`${weeks[i]}: ${label}`} />
                  );
                })}
              </div>
              <span className="caption tabular">
                {wks.map((v) => (v?.answered ? pctText(v.correct, v.answered) : '·')).join('  ')}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ReportBody({ classroom }) {
  const [range, setRange] = useState('week');
  const [from, setFrom] = useState(() => toInputDate(Date.now() - 13 * DAY_MS));
  const [to, setTo] = useState(() => toInputDate(Date.now()));

  const { since, until } = useMemo(() => {
    if (range === 'custom') {
      const s = new Date(`${from}T00:00:00`).getTime();
      const u = new Date(`${to}T23:59:59.999`).getTime();
      return { since: Number.isFinite(s) ? s : Date.now() - 7 * DAY_MS, until: Number.isFinite(u) ? u : null };
    }
    return { since: Date.now() - (range === 'week' ? 7 : 28) * DAY_MS, until: null };
  }, [range, from, to]);

  const roster = useRoster(classroom.id);
  const sums = useSummaries('classroomId', classroom.id, since, until);
  const assignments = useAssignments(classroom.id);

  const summaries = sums.data;
  const t = useMemo(() => totals(summaries), [summaries]);
  const perStudent = useMemo(() => byStudent(summaries), [summaries]);
  const personas = useMemo(() => personaResults(summaries), [summaries]);

  const rows = useMemo(() => {
    const list = roster.data.filter((s) => s.active !== false || perStudent[s.id]);
    return list.map((s) => ({ student: s, ...(perStudent[s.id] || { sessions: 0, seen: 0, answered: 0, correct: 0, early: 0, lastPlayed: 0 }) }));
  }, [roster.data, perStudent]);

  const exportCsv = () => {
    const header = ['Alias', 'Sessions', 'Questions seen', 'Answered', 'Correct', 'Accuracy', 'Early-buzz rate', 'Avg earliest clue (all time)', 'Last played'];
    const body = rows.map((r) => [
      r.student.displayName || 'Student',
      r.sessions,
      r.seen,
      r.answered,
      r.correct,
      pctText(r.correct, r.answered),
      pctText(r.early, r.correct),
      clueText(r.student),
      r.lastPlayed ? toInputDate(r.lastPlayed) : ''
    ]);
    const label = range === 'custom' ? `${from}_to_${to}` : range === 'week' ? 'last-7-days' : 'last-4-weeks';
    const safeName = (classroom.name || 'class').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    downloadFile(`quizquest-${safeName}-${label}.csv`, toCsv([header, ...body]));
  };

  const loading = roster.loading || sums.loading;

  return (
    <div className="stack-lg">
      <Card className="stack">
        <div className="row-between">
          <Segmented
            label="Date range"
            value={range}
            onChange={setRange}
            options={[
              { value: 'week', label: 'This week' },
              { value: '4w', label: 'Last 4 weeks' },
              { value: 'custom', label: 'Custom' }
            ]}
          />
          <Button variant="primary" onClick={exportCsv} disabled={loading || !rows.length}>
            Export CSV
          </Button>
        </div>
        {range === 'custom' ? (
          <div className="grid-2">
            <Field label="From">{(id) => <input id={id} type="date" className="input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />}</Field>
            <Field label="To">{(id) => <input id={id} type="date" className="input" value={to} min={from} onChange={(e) => setTo(e.target.value)} />}</Field>
          </div>
        ) : null}
        <p className="caption">The CSV has aliases and totals only. No ids or answers.</p>
      </Card>

      {sums.error ? <ErrorNote error={sums.error} /> : null}
      {roster.error ? <ErrorNote error={roster.error} /> : null}

      {loading ? (
        <Loading label="Building the report…" />
      ) : (
        <>
          <div className="t-tiles">
            <div className="t-tile">
              <Stat value={fmtNum(t.sessions)} label="Sessions" color="var(--purple)" />
            </div>
            <div className="t-tile">
              <Stat value={fmtNum(Object.keys(perStudent).length)} label="Students played" color="var(--teal)" />
            </div>
            <div className="t-tile">
              <Stat value={pctText(t.correct, t.answered)} label="Accuracy" color="var(--coral)" />
            </div>
            <div className="t-tile">
              <Stat value={fmtNum(t.seen)} label="Questions" color="var(--sun-strong)" />
            </div>
          </div>

          <Card className="stack">
            <h2>Students</h2>
            {rows.length ? (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Student</th>
                      <th scope="col" className="num">Sessions</th>
                      <th scope="col" className="num">Seen</th>
                      <th scope="col" className="num">Answered</th>
                      <th scope="col" className="num">Accuracy</th>
                      <th scope="col" className="num">Early buzz</th>
                      <th scope="col" className="num">Earliest clue (all time)</th>
                      <th scope="col">Last played</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.student.id}>
                        <td>
                          <Link to={`/teach/students/${r.student.id}`} className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
                            <Avatar emoji={r.student.avatar} />
                            <span>{r.student.displayName || 'Student'}</span>
                          </Link>
                        </td>
                        <td className="num">{fmtNum(r.sessions)}</td>
                        <td className="num">{fmtNum(r.seen)}</td>
                        <td className="num">{fmtNum(r.answered)}</td>
                        <td className="num">{pctText(r.correct, r.answered)}</td>
                        <td className="num">{pctText(r.early, r.correct)}</td>
                        <td className="num">{clueText(r.student)}</td>
                        <td>{r.lastPlayed ? fmtDate(r.lastPlayed) : 'Not in range'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState emoji="🧑‍🎓" title="No students yet" action={<Link to="/teach/students">Add students</Link>} />
            )}
            <p className="caption">Early buzz is the share of correct answers that came on an early clue. Earliest clue is how far into a question a student usually buzzes correctly.</p>
          </Card>

          <Card className="stack">
            <h2>Category trends</h2>
            <CategoryTrends summaries={summaries} />
          </Card>

          <Card className="stack">
            <h2>Computer opponent results</h2>
            {personas.length ? (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Opponent</th>
                      <th scope="col">Level</th>
                      <th scope="col" className="num">Played</th>
                      <th scope="col" className="num">Student wins</th>
                      <th scope="col" className="num">Win rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {personas.map((p) => (
                      <tr key={p.personaId}>
                        <td>
                          <span aria-hidden>{p.avatar} </span>
                          {p.name}
                        </td>
                        <td>{TIER_LABELS[p.tier] || 'Personalized'}</td>
                        <td className="num">{fmtNum(p.played)}</td>
                        <td className="num">{fmtNum(p.wins)}</td>
                        <td className="num">{pctText(p.wins, p.played)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState emoji="🤖" title="No computer matches in this range" />
            )}
          </Card>

          <Card className="stack">
            <h2>Assignments</h2>
            {assignments.error ? <ErrorNote error={assignments.error} /> : null}
            {assignments.loading ? (
              <Loading />
            ) : assignments.current.length ? (
              <ul className="t-list">
                {assignments.current.map((a) => (
                  <li key={a.id} className="row-between">
                    <div className="stack" style={{ gap: 2 }}>
                      <span style={{ fontWeight: 800 }}>{a.title}</span>
                      <span className="caption">Due {fmtDate(a.dueAt)}</span>
                    </div>
                    <AssignmentCompletion assignment={a} activeRoster={roster.active} compact />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState emoji="📝" title="No open assignments" action={<Link to="/teach/assignments">Create an assignment</Link>} />
            )}
          </Card>
        </>
      )}
    </div>
  );
}

export default function Reports() {
  const cls = useClassroom();
  useReportView();
  return (
    <div className="page stack-lg">
      <TeacherHeader cls={cls} title="Reports" subtitle="Progress for this class, built from finished games." />
      <ClassGate cls={cls}>{cls.classroom ? <ReportBody key={cls.classroom.id} classroom={cls.classroom} /> : null}</ClassGate>
    </div>
  );
}
