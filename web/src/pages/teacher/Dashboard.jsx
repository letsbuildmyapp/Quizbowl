// Teacher Command Center (/teach).
// Firestore reads:
//   classrooms where teacherUid == uid (useClassroom)
//   students where classroomId == X (roster, nickname requests)
//   sessionSummaries where classroomId == X and completedAt >= now-7d
//   answerReviews where classroomId == X and status == 'pending'
//   assignments where classroomId == X, assignments/{id}/progress/*
// RTDB reads: presence ordered by classroomId, equalTo X
// Firestore writes:
//   classrooms/{X}: { dismissedSuggestions: arrayUnion(key) }
//   classrooms/{auto}: create (via ClassGate's CreateClassModal)
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { arrayUnion, collection, doc, query, updateDoc, where } from 'firebase/firestore';
import { equalTo, onValue, orderByChild, query as rtQuery, ref as rtRef } from 'firebase/database';
import { db, rtdb } from '../../firebase.js';
import { useClassroom } from '../../hooks/useClassroom.js';
import { useQuery } from '../../hooks/useFirestore.js';
import { WORLDS, categoryMeta } from '../../lib/catalog.js';
import { evaluateRule, worldName } from '../../lib/rewards.js';
import { fmtNum, pct, timeAgo, weekKey } from '../../lib/format.js';
import { Avatar, ButtonLink, Button, Card, Chip, EmptyState, ErrorNote, Loading, StrengthRow, useToast, friendlyError } from '../../components/ui.jsx';
import { ClassGate, TeacherHeader, rosterMap, useRoster, useSummaries } from '../../components/teacher/TeacherPage.jsx';
import { AssignmentCompletion, useAssignments } from '../../components/teacher/assignments.jsx';
import { DAY_MS, MODE_LABELS, categoryTotals, orderedCategories, pctText, personaResults, stuckWorld, totals, unlockedSet } from '../../components/teacher/stats.js';

export default function Dashboard() {
  const cls = useClassroom();
  return (
    <div className="page stack-lg">
      <TeacherHeader cls={cls} title="Command Center" subtitle="How your class played over the last 7 days." />
      <ClassGate cls={cls}>
        <DashboardBody classroom={cls.classroom} />
      </ClassGate>
      <footer className="t-footer">
        <Link to="/teach/feedback">Send pilot feedback</Link>
      </footer>
    </div>
  );
}

function useOnlineCount(classroomId) {
  const [count, setCount] = useState(null);
  useEffect(() => {
    if (!rtdb || !classroomId) {
      setCount(null);
      return undefined;
    }
    const q = rtQuery(rtRef(rtdb, 'presence'), orderByChild('classroomId'), equalTo(classroomId));
    return onValue(
      q,
      (snap) => {
        let n = 0;
        snap.forEach((child) => {
          if (child.val()?.online === true) n += 1;
        });
        setCount(n);
      },
      () => setCount(null)
    );
  }, [classroomId]);
  return count;
}

/** Rule-based suggestions. Each one names the numbers it's based on. */
function buildSuggestions({ summaries, activeRoster, pendingReviews }) {
  const week = weekKey();
  const out = [];

  const cats = categoryTotals(summaries);
  const weak = Object.entries(cats)
    .filter(([, v]) => v.answered >= 10 && v.correct / v.answered < 0.65)
    .sort((a, b) => a[1].correct / a[1].answered - b[1].correct / b[1].answered)[0];
  if (weak) {
    const [cat, v] = weak;
    const title = `${cat} Quest`;
    out.push({
      key: `weak-category:${cat}:${week}`,
      title: `Assign a 15-question ${cat} Quest.`,
      why: `${cat} accuracy is ${pct(v.correct, v.answered)}% (${v.correct} of ${v.answered} answered) this week.`,
      actionLabel: 'Create assignment',
      to: `/teach/assignments?${new URLSearchParams({ mode: 'practice', category: cat, count: '15', title })}`
    });
  }

  const playedIds = new Set(summaries.map((s) => s.studentId));
  const idle = activeRoster.filter((s) => !playedIds.has(s.id));
  if (idle.length && activeRoster.length) {
    const names = idle.slice(0, 3).map((s) => s.displayName).join(', ');
    const more = idle.length > 3 ? ` and ${idle.length - 3} more` : '';
    out.push({
      key: `idle-students:${week}`,
      title: `${idle.length} ${idle.length === 1 ? "student hasn't" : "students haven't"} played this week.`,
      why: `No sessions in 7 days: ${names}${more}.`,
      actionLabel: 'Assign 5-question practice',
      to: `/teach/assignments?${new URLSearchParams({ mode: 'practice', count: '5', title: 'Quick practice', students: idle.map((s) => s.id).join(',') })}`
    });
  }

  const versus = summaries.filter((s) => s.mode === 'versus');
  if (versus.length >= 8) {
    const wins = versus.filter((s) => s.won).length;
    const rate = wins / versus.length;
    const why = `Students won ${wins} of ${versus.length} computer matches (${pct(wins, versus.length)}%) this week.`;
    if (rate >= 0.8) out.push({ key: `raise-tier:${week}`, title: 'Raise the computer difficulty range.', why, actionLabel: 'Open class settings', to: '/teach/settings' });
    if (rate <= 0.3) out.push({ key: `lower-tier:${week}`, title: 'Lower the computer difficulty range.', why, actionLabel: 'Open class settings', to: '/teach/settings' });
  }

  const stuck = stuckWorld(activeRoster);
  if (stuck && stuck.students.length >= 3 && stuck.students.length >= activeRoster.length * 0.4) {
    const prereq = WORLDS.find((w) => w.id === stuck.rule.world);
    const n = stuck.students.length;
    const label = evaluateRule(stuck.rule, {}).label;
    out.push({
      key: `stuck-world:${stuck.worldId}:${week}`,
      title: `${n} students still have ${worldName(stuck.worldId)} locked.`,
      why: `It opens when they ${label.charAt(0).toLowerCase()}${label.slice(1)}. A ${prereq?.category || ''} practice assignment counts toward it.`,
      actionLabel: `Assign ${prereq?.category || 'a'} practice`,
      to: `/teach/assignments?${new URLSearchParams({ mode: 'practice', category: prereq?.category || '', count: '10', title: `${worldName(stuck.rule.world)} Quest`, students: stuck.students.map((s) => s.id).join(',') })}`
    });
  }

  if (pendingReviews > 0) {
    out.push({
      key: `reviews:${pendingReviews}:${week}`,
      title: `Review ${pendingReviews} close ${pendingReviews === 1 ? 'answer' : 'answers'}.`,
      why: `${pendingReviews} ${pendingReviews === 1 ? 'answer was' : 'answers were'} close to correct and need your call.`,
      actionLabel: 'Open answer reviews',
      to: '/teach/reviews'
    });
  }
  return out;
}

function DashboardBody({ classroom }) {
  const classroomId = classroom.id;
  const toast = useToast();
  const [since] = useState(() => Date.now() - 7 * DAY_MS);
  const roster = useRoster(classroomId);
  const summariesQ = useSummaries('classroomId', classroomId, since);
  const reviewsQ = useQuery(
    () => query(collection(db, 'answerReviews'), where('classroomId', '==', classroomId), where('status', '==', 'pending')),
    [classroomId]
  );
  const assignments = useAssignments(classroomId);
  const online = useOnlineCount(classroomId);
  const [dismissing, setDismissing] = useState(null);

  const summaries = summariesQ.data;
  const activeRoster = roster.active;
  const names = useMemo(() => rosterMap(roster.data), [roster.data]);
  const t = useMemo(() => totals(summaries), [summaries]);
  const activeIds = useMemo(() => new Set(summaries.map((s) => s.studentId)), [summaries]);
  const activeInRoster = activeRoster.filter((s) => activeIds.has(s.id)).length;
  const cats = useMemo(() => categoryTotals(summaries), [summaries]);
  const personas = useMemo(() => personaResults(summaries), [summaries]);
  const recent = useMemo(() => summaries.slice().sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0)).slice(0, 8), [summaries]);
  const nicknameRequests = roster.data.filter((s) => s.nicknameRequest?.status === 'pending');
  const pendingReviews = reviewsQ.data.length;

  const dismissed = classroom.dismissedSuggestions || [];
  const adventureKey = activeRoster.map((s) => `${s.id}:${(s.unlockedWorlds || []).length}:${s.stats?.sessions || 0}`).join('|');
  const suggestions = useMemo(
    () => (summariesQ.loading || roster.loading ? [] : buildSuggestions({ summaries, activeRoster, pendingReviews }).filter((s) => !dismissed.includes(s.key))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [summaries, adventureKey, pendingReviews, dismissed.join('|'), summariesQ.loading, roster.loading]
  );

  const dismiss = async (key) => {
    setDismissing(key);
    try {
      await updateDoc(doc(db, 'classrooms', classroomId), { dismissedSuggestions: arrayUnion(key) });
    } catch (err) {
      toast(friendlyError(err), { emoji: '⚠️' });
    } finally {
      setDismissing(null);
    }
  };

  const loading = summariesQ.loading || roster.loading;
  const catRows = orderedCategories(cats).filter((c) => cats[c]?.answered > 0);

  return (
    <div className="stack-lg">
      <Card className="stack-lg" aria-labelledby="cc-title">
        <h2 id="cc-title" className="eyebrow" style={{ color: 'var(--purple-strong)' }}>
          Teacher Command Center
        </h2>
        {summariesQ.error ? <ErrorNote error={summariesQ.error} /> : null}
        {loading ? (
          <Loading label="Crunching this week's numbers…" />
        ) : (
          <>
            <div className="t-tiles">
              <Tile value={fmtNum(activeIds.size)} label="Active students" color="var(--purple)" hint="Played in the last 7 days" />
              <Tile value={pctText(activeInRoster, activeRoster.length)} label="Participation" color="var(--teal)" hint={`${activeInRoster} of ${activeRoster.length} on the roster`} />
              <Tile value={pctText(t.correct, t.answered)} label="Team accuracy" color="var(--coral)" hint={`${fmtNum(t.correct)} of ${fmtNum(t.answered)} answered`} />
              <Tile value={fmtNum(t.seen)} label="Questions" color="var(--sun-strong)" hint={`Across ${fmtNum(t.sessions)} sessions`} />
            </div>
            <div className="grid-2" style={{ alignItems: 'start', gap: 24 }}>
              <section className="stack" aria-labelledby="strengths-title">
                <h3 id="strengths-title" className="stat-label">
                  Team strengths
                </h3>
                {catRows.length ? (
                  catRows.map((c) => {
                    const v = cats[c];
                    const m = categoryMeta(c);
                    return <StrengthRow key={c} label={c} emoji={m.emoji} color={m.color} value={pct(v.correct, v.answered)} detail={`${v.correct}/${v.answered}`} />;
                  })
                ) : (
                  <p className="muted">Category accuracy shows up after students answer a few questions.</p>
                )}
              </section>
              <section className="stack" aria-labelledby="suggest-title">
                <h3 id="suggest-title" className="sr-only">
                  Smart suggestions
                </h3>
                {suggestions.length ? (
                  suggestions.map((s) => (
                    <div key={s.key} className="t-suggestion">
                      <span className="t-suggestion-label">✨ Smart suggestion</span>
                      <strong style={{ fontSize: '1.0625rem' }}>{s.title}</strong>
                      <span className="caption">{s.why}</span>
                      <div className="row">
                        <ButtonLink to={s.to} variant="primary">
                          {s.actionLabel}
                        </ButtonLink>
                        <Button variant="ghost" onClick={() => dismiss(s.key)} loading={dismissing === s.key} aria-label={`Dismiss suggestion: ${s.title}`}>
                          Dismiss
                        </Button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="t-suggestion">
                    <span className="t-suggestion-label">✨ Smart suggestion</span>
                    <span className="muted">Nothing needs your attention right now.</span>
                    <ButtonLink to="/teach/assignments" variant="primary">
                      Create assignment
                    </ButtonLink>
                  </div>
                )}
              </section>
            </div>
          </>
        )}
      </Card>

      <div className="grid-2" style={{ alignItems: 'start' }}>
        <Card className="stack" aria-labelledby="todo-title">
          <h2 id="todo-title">Right now</h2>
          <ul className="t-list">
            <li>
              <span aria-hidden>🟢</span>
              <span style={{ flex: 1 }}>Online now</span>
              <strong className="tabular">{online == null ? 'Unavailable' : fmtNum(online)}</strong>
            </li>
            <li>
              <span aria-hidden>🔎</span>
              <span style={{ flex: 1 }}>Close answers to review</span>
              {reviewsQ.error ? <span className="caption">Unavailable</span> : <Chip tone={pendingReviews ? 'sun' : 'gray'}>{reviewsQ.loading ? '…' : pendingReviews}</Chip>}
              <Link to="/teach/reviews">Review</Link>
            </li>
            <li>
              <span aria-hidden>✏️</span>
              <span style={{ flex: 1 }}>Nickname requests</span>
              <Chip tone={nicknameRequests.length ? 'sun' : 'gray'}>{roster.loading ? '…' : nicknameRequests.length}</Chip>
              <Link to="/teach/students">Open roster</Link>
            </li>
          </ul>
        </Card>

        <Card className="stack" aria-labelledby="assign-title">
          <div className="row-between">
            <h2 id="assign-title">Assignments</h2>
            <Link to="/teach/assignments">All assignments</Link>
          </div>
          {assignments.error ? (
            <ErrorNote error={assignments.error} />
          ) : assignments.loading ? (
            <Loading />
          ) : assignments.current.length ? (
            <ul className="t-list">
              {assignments.current.slice(0, 4).map((a) => (
                <li key={a.id} style={{ justifyContent: 'space-between' }}>
                  <div className="stack" style={{ gap: 2 }}>
                    <strong>{a.title}</strong>
                    <span className="caption">{MODE_LABELS[a.mode] || a.mode}</span>
                  </div>
                  <AssignmentCompletion assignment={a} activeRoster={activeRoster} compact />
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No open assignments.</p>
          )}
        </Card>
      </div>

      <AdventureCard roster={activeRoster} loading={roster.loading} />

      <div className="grid-2" style={{ alignItems: 'start' }}>
        <Card className="stack" aria-labelledby="recent-title">
          <h2 id="recent-title">Recent activity</h2>
          {loading ? (
            <Loading />
          ) : recent.length ? (
            <ul className="t-list">
              {recent.map((s) => {
                const st = names[s.studentId];
                return (
                  <li key={s.id}>
                    <Avatar emoji={st?.avatar} />
                    <div className="stack" style={{ gap: 2, flex: 1, minWidth: 140 }}>
                      <strong>{st?.displayName || 'Former student'}</strong>
                      <span className="caption">
                        {MODE_LABELS[s.mode] || s.mode} · {timeAgo(s.completedAt)}
                      </span>
                    </div>
                    <span className="tabular" style={{ fontWeight: 800 }}>
                      {fmtNum(s.points)} pts
                    </span>
                    <span className="tabular caption">{pctText(s.correct, s.answered)} correct</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState emoji="🎯" title="No games this week">
              Finished sessions show up here.
            </EmptyState>
          )}
        </Card>

        <Card className="stack" aria-labelledby="versus-title">
          <h2 id="versus-title">Computer matches</h2>
          {loading ? (
            <Loading />
          ) : personas.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Opponent</th>
                    <th scope="col" className="num">
                      Played
                    </th>
                    <th scope="col" className="num">
                      Student wins
                    </th>
                    <th scope="col" className="num">
                      Win rate
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {personas.map((p) => (
                    <tr key={p.personaId}>
                      <td>
                        <span aria-hidden>{p.avatar} </span>
                        {p.name}
                      </td>
                      <td className="num">{p.played}</td>
                      <td className="num">{p.wins}</td>
                      <td className="num">{pctText(p.wins, p.played)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">No Battle the Computer matches this week.</p>
          )}
        </Card>
      </div>
    </div>
  );
}

function AdventureCard({ roster, loading }) {
  const rows = WORLDS.map((w) => ({
    ...w,
    unlocked: roster.filter((s) => unlockedSet(s).has(w.id)).length,
    bosses: roster.filter((s) => (s.bossesDefeated || []).includes(w.id)).length,
    mastered: roster.filter((s) => (s.masteredWorlds || []).includes(w.id)).length
  }));
  return (
    <Card className="stack" aria-labelledby="adventure-title">
      <div className="stack" style={{ gap: 4 }}>
        <h2 id="adventure-title">Adventure</h2>
        <p className="muted">How many students have opened each world and beaten its boss.</p>
      </div>
      {loading ? (
        <Loading />
      ) : !roster.length ? (
        <p className="muted">Add students to see their adventure progress.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">World</th>
                <th scope="col" className="num">Unlocked</th>
                <th scope="col" className="num">Boss beaten</th>
                <th scope="col" className="num">Mastered</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => (
                <tr key={w.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <span aria-hidden>{w.emoji} </span>
                    {w.name}
                  </td>
                  <td className="num">
                    {w.unlocked} of {roster.length}
                  </td>
                  <td className="num">{w.bosses}</td>
                  <td className="num">{w.mastered}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function Tile({ value, label, color, hint }) {
  return (
    <div className="t-tile">
      <span className="stat-value" style={{ color }}>
        {value}
      </span>
      <span className="stat-label">{label}</span>
      {hint ? <span className="caption">{hint}</span> : null}
    </div>
  );
}
