// Competitions: Team Quests (async shared target), Live Team Battles, School Challenges.
// Firestore reads: classrooms (useClassroom), students where classroomId ==, teams where classroomId ==,
//   teamQuests where classroomId ==,
//   sessions where classroomId == X, mode == 'live_battle', status in [active statuses],
//   challenges where schoolIds array-contains my school (filtered to this class).
// Firestore writes:
//   teamQuests/{auto} add { classroomId, teamId, title, category, metric, target, startsAt, endsAt,
//     progress: 0, contributions: {}, createdBy, createdAt: serverTimestamp() }
//   sessionRequests/{auto} via request(): { uid, mode: 'live_battle', options: { classroomId, teamA, teamB, count, category },
//     status: 'pending', createdAt } (teamA/teamB = { name, emoji, studentIds })
//   challenges/{auto} add { name, hostSchoolId, schoolIds, classroomIds, startsAt, endsAt, categories: [],
//     metric: 'correct', inviteCode, standings: {}, createdBy, createdAt: serverTimestamp() }
//   adminActions/{auto} via request(): { uid, action: 'joinChallenge', code, classroomId, status: 'pending', createdAt }
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { addDoc, collection, query, serverTimestamp, where } from 'firebase/firestore';
import { db } from '../../firebase.js';
import { useAuth } from '../../hooks/useAuth.jsx';
import { useClassroom } from '../../hooks/useClassroom.js';
import { useQuery } from '../../hooks/useFirestore.js';
import { CATEGORIES, categoryMeta } from '../../lib/catalog.js';
import { fmtDate, fmtNum, toMillis } from '../../lib/format.js';
import { randomCode, request } from '../../lib/requests.js';
import { Button, Card, Chip, EmptyState, ErrorNote, Field, Loading, Modal, ProgressBar, Segmented, friendlyError, useToast } from '../../components/ui.jsx';
import { ClassGate, TeacherHeader, rosterMap, useRoster, useTeams } from '../../components/teacher/TeacherPage.jsx';
import { ACTIVE_SESSION_STATUSES, DAY_MS } from '../../components/teacher/stats.js';

function dateInput(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function startOfDay(value) {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}
function endOfDay(value) {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
}

export default function Competitions() {
  const cls = useClassroom();
  return (
    <div className="page stack-lg">
      <TeacherHeader cls={cls} title="Competitions" subtitle="Team goals, live battles, and challenges with other classes." />
      <ClassGate cls={cls}>{cls.classroom ? <CompetitionsBody classroom={cls.classroom} /> : null}</ClassGate>
    </div>
  );
}

function CompetitionsBody({ classroom }) {
  const roster = useRoster(classroom.id);
  const teams = useTeams(classroom.id);
  return (
    <div className="stack-xl">
      <TeamQuests classroom={classroom} roster={roster} teams={teams} />
      <LiveBattles classroom={classroom} roster={roster} teams={teams} />
      <SchoolChallenges classroom={classroom} />
    </div>
  );
}

/* ---------------- Team Quest ---------------- */

function TeamQuests({ classroom, roster, teams }) {
  const [open, setOpen] = useState(false);
  const quests = useQuery(() => query(collection(db, 'teamQuests'), where('classroomId', '==', classroom.id)), [classroom.id]);
  const [now] = useState(() => Date.now());
  const sorted = quests.data.slice().sort((a, b) => (b.startsAt || 0) - (a.startsAt || 0));
  const active = sorted.filter((q) => (q.endsAt || 0) >= now);
  const past = sorted.filter((q) => (q.endsAt || 0) < now);
  const names = rosterMap(roster.data);
  const teamById = Object.fromEntries(teams.data.map((t) => [t.id, t]));

  return (
    <section className="stack" aria-labelledby="tq-heading">
      <div className="row-between">
        <div className="stack" style={{ gap: 4 }}>
          <h2 id="tq-heading">Team Quest</h2>
          <p className="muted">A shared weekly goal. Every correct answer counts toward it.</p>
        </div>
        <Button variant="primary" onClick={() => setOpen(true)}>
          New team quest
        </Button>
      </div>
      {quests.loading ? (
        <Loading label="Loading quests…" />
      ) : quests.error ? (
        <ErrorNote error={quests.error} />
      ) : !sorted.length ? (
        <EmptyState emoji="🎯" title="No team quests yet">
          Set a target like 200 correct answers this week.
        </EmptyState>
      ) : (
        <div className="stack">
          {active.length ? (
            <div className="grid-2">
              {active.map((q) => (
                <QuestCard key={q.id} quest={q} names={names} team={teamById[q.teamId]} />
              ))}
            </div>
          ) : (
            <p className="muted">No active quests right now.</p>
          )}
          {past.length ? (
            <details>
              <summary style={{ cursor: 'pointer', fontWeight: 800, minHeight: 44, display: 'flex', alignItems: 'center' }}>Past quests ({past.length})</summary>
              <div className="grid-2" style={{ marginTop: 16 }}>
                {past.map((q) => (
                  <QuestCard key={q.id} quest={q} names={names} team={teamById[q.teamId]} past />
                ))}
              </div>
            </details>
          ) : null}
        </div>
      )}
      {open ? <TeamQuestModal classroom={classroom} teams={teams.data} onClose={() => setOpen(false)} /> : null}
    </section>
  );
}

function QuestCard({ quest, names, team, past }) {
  const progress = quest.progress || 0;
  const target = quest.target || 1;
  const done = progress >= target || !!quest.completedAt;
  const cat = quest.category ? categoryMeta(quest.category) : null;
  const top = Object.entries(quest.contributions || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id, n]) => ({ name: names[id]?.displayName || 'Former student', n }));
  return (
    <Card>
      <div className="stack">
        <div className="row-between" style={{ alignItems: 'flex-start' }}>
          <h3>{quest.title}</h3>
          {done ? <Chip tone="green">✓ Complete</Chip> : past ? <Chip tone="gray">Ended</Chip> : <Chip tone="teal">Active</Chip>}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Chip tone="gray">{team ? `${team.emoji || ''} ${team.name}`.trim() : 'Whole class'}</Chip>
          <Chip tone="gray">{cat ? `${cat.emoji} ${cat.id}` : 'Any category'}</Chip>
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <span className="tabular" style={{ fontWeight: 800 }}>
            {fmtNum(progress)} / {fmtNum(quest.target)} {quest.metric === 'answered' ? 'answered' : 'correct'}
          </span>
          <ProgressBar value={Math.min(progress, target)} max={target} color={done ? 'var(--green)' : 'var(--purple)'} label={`${quest.title} progress`} />
          <span className="caption">
            {fmtDate(quest.startsAt)} to {fmtDate(quest.endsAt)}
          </span>
        </div>
        {top.length ? (
          <div className="stack" style={{ gap: 4 }}>
            <span className="label">Top helpers</span>
            <ol className="t-list" style={{ paddingLeft: 0 }}>
              {top.map((c, i) => (
                <li key={i} style={{ padding: '8px 0', justifyContent: 'space-between' }}>
                  <span>{c.name}</span>
                  <span className="tabular" style={{ fontWeight: 800 }}>
                    {fmtNum(c.n)}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        ) : (
          <span className="caption">No contributions yet.</span>
        )}
      </div>
    </Card>
  );
}

function TeamQuestModal({ classroom, teams, onClose }) {
  const { user } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState(() => ({
    title: '',
    teamId: '',
    category: '',
    metric: 'correct',
    target: 100,
    start: dateInput(Date.now()),
    end: dateInput(Date.now() + 6 * DAY_MS)
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e?.preventDefault();
    if (!form.title.trim()) return setError('Give the quest a title.');
    const target = Math.round(Number(form.target));
    if (!target || target < 1) return setError('Set a target of at least 1.');
    if (!form.start || !form.end) return setError('Pick a start and end date.');
    const startsAt = startOfDay(form.start);
    const endsAt = endOfDay(form.end);
    if (endsAt <= startsAt) return setError('The end date must be after the start date.');
    setBusy(true);
    setError(null);
    try {
      await addDoc(collection(db, 'teamQuests'), {
        classroomId: classroom.id,
        teamId: form.teamId || null,
        title: form.title.trim(),
        category: form.category || null,
        metric: form.metric,
        target,
        startsAt,
        endsAt,
        progress: 0,
        contributions: {},
        createdBy: user.uid,
        createdAt: serverTimestamp()
      });
      toast('Team quest created');
      onClose();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="New team quest"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={busy}>
            Create quest
          </Button>
        </>
      }
    >
      <form className="stack" onSubmit={submit}>
        <Field label="Title" hint="For example: Space Week">
          {(id) => <input id={id} className="input" value={form.title} onChange={(e) => set('title')(e.target.value)} maxLength={60} autoComplete="off" />}
        </Field>
        <Field label="Who plays">
          {(id) => (
            <select id={id} className="select" value={form.teamId} onChange={(e) => set('teamId')(e.target.value)}>
              <option value="">Whole class</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.emoji} {t.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Category">
          {(id) => (
            <select id={id} className="select" value={form.category} onChange={(e) => set('category')(e.target.value)}>
              <option value="">Any category</option>
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.emoji} {c.id}
                </option>
              ))}
            </select>
          )}
        </Field>
        <div className="stack" style={{ gap: 8 }}>
          <span className="label">Count</span>
          <Segmented
            label="Count"
            value={form.metric}
            onChange={set('metric')}
            options={[
              { value: 'correct', label: 'Correct answers' },
              { value: 'answered', label: 'Questions answered' }
            ]}
          />
        </div>
        <Field label="Target">
          {(id) => <input id={id} type="number" inputMode="numeric" min={1} max={100000} className="input tabular" value={form.target} onChange={(e) => set('target')(e.target.value)} />}
        </Field>
        <div className="grid-2">
          <Field label="Starts">
            {(id) => <input id={id} type="date" className="input" value={form.start} onChange={(e) => set('start')(e.target.value)} />}
          </Field>
          <Field label="Ends">
            {(id) => <input id={id} type="date" className="input" value={form.end} onChange={(e) => set('end')(e.target.value)} />}
          </Field>
        </div>
        {error ? <ErrorNote>{error}</ErrorNote> : null}
      </form>
    </Modal>
  );
}

/* ---------------- Live Team Battle ---------------- */

function LiveBattles({ classroom, roster, teams }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [mode, setMode] = useState('auto');
  const [teamAId, setTeamAId] = useState('');
  const [teamBId, setTeamBId] = useState('');
  const [count, setCount] = useState(10);
  const [category, setCategory] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const live = useQuery(
    () =>
      query(
        collection(db, 'sessions'),
        where('classroomId', '==', classroom.id),
        where('mode', '==', 'live_battle'),
        where('status', 'in', ACTIVE_SESSION_STATUSES)
      ),
    [classroom.id]
  );

  const buildSides = () => {
    const active = roster.active;
    if (mode === 'teams') {
      const a = teams.data.find((t) => t.id === teamAId);
      const b = teams.data.find((t) => t.id === teamBId);
      if (!a || !b) throw new Error('Choose two teams.');
      if (a.id === b.id) throw new Error('Choose two different teams.');
      const side = (t) => ({ name: t.name, emoji: t.emoji || '⭐', studentIds: active.filter((s) => s.teamId === t.id).map((s) => s.id) });
      const A = side(a);
      const B = side(b);
      if (!A.studentIds.length || !B.studentIds.length) throw new Error('Each team needs at least one active student.');
      return [A, B];
    }
    if (active.length < 2) throw new Error('You need at least two active students.');
    const shuffled = active.map((s) => s.id).sort(() => Math.random() - 0.5);
    const half = Math.ceil(shuffled.length / 2);
    return [
      { name: 'Team Rocket', emoji: '🚀', studentIds: shuffled.slice(0, half) },
      { name: 'Team Comet', emoji: '☄️', studentIds: shuffled.slice(half) }
    ];
  };

  const start = async () => {
    setError(null);
    let sides;
    try {
      sides = buildSides();
    } catch (err) {
      return setError(err.message);
    }
    setBusy(true);
    try {
      const r = await request('sessionRequests', {
        mode: 'live_battle',
        options: { classroomId: classroom.id, teamA: sides[0], teamB: sides[1], count, category: category || null }
      });
      toast('Battle ready');
      navigate(`/teach/live/${r.sessionId}`);
    } catch (err) {
      setError(friendlyError(err));
      setBusy(false);
    }
  };

  return (
    <section className="stack" aria-labelledby="lb-heading">
      <div className="stack" style={{ gap: 4 }}>
        <h2 id="lb-heading">Live Team Battle</h2>
        <p className="muted">Two teams buzz in on their own devices while you run the host screen.</p>
      </div>
      {live.error ? <ErrorNote error={live.error} /> : null}
      {live.data.length ? (
        <Card tone="teal">
          <div className="stack">
            <h3>In progress</h3>
            <ul className="t-list">
              {live.data.map((s) => (
                <li key={s.id} style={{ justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 800 }}>
                    {s.sides?.A?.emoji} {s.sides?.A?.name || 'Team A'} vs {s.sides?.B?.emoji} {s.sides?.B?.name || 'Team B'}
                  </span>
                  <Link className="btn btn-sm" to={`/teach/live/${s.id}`}>
                    Open host screen
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      ) : null}
      <Card>
        <div className="stack-lg">
          <div className="stack" style={{ gap: 8 }}>
            <span className="label">Teams</span>
            <Segmented
              label="Teams"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'auto', label: 'Split the class in two' },
                { value: 'teams', label: 'Use my teams' }
              ]}
            />
            {mode === 'auto' ? (
              <span className="caption tabular">{roster.loading ? 'Loading roster…' : `${roster.active.length} active students, split at random.`}</span>
            ) : null}
          </div>
          {mode === 'teams' ? (
            teams.data.length >= 2 ? (
              <div className="grid-2">
                <Field label="Team A">
                  {(id) => (
                    <select id={id} className="select" value={teamAId} onChange={(e) => setTeamAId(e.target.value)}>
                      <option value="">Choose a team</option>
                      {teams.data.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.emoji} {t.name}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                <Field label="Team B">
                  {(id) => (
                    <select id={id} className="select" value={teamBId} onChange={(e) => setTeamBId(e.target.value)}>
                      <option value="">Choose a team</option>
                      {teams.data.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.emoji} {t.name}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
              </div>
            ) : (
              <p className="muted">
                You need two teams. <Link to="/teach/students">Set up teams</Link>
              </p>
            )
          ) : null}
          <div className="grid-2">
            <Field label={`Questions: ${count}`} hint="Between 5 and 15">
              {(id) => <input id={id} type="range" min={5} max={15} value={count} onChange={(e) => setCount(Number(e.target.value))} style={{ minHeight: 44 }} />}
            </Field>
            <Field label="Category">
              {(id) => (
                <select id={id} className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="">Mixed</option>
                  {CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.emoji} {c.id}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
          {error ? <ErrorNote>{error}</ErrorNote> : null}
          <div className="row">
            <Button variant="primary" size="lg" onClick={start} loading={busy}>
              Start live battle
            </Button>
          </div>
        </div>
      </Card>
    </section>
  );
}

/* ---------------- School Challenge ---------------- */

function SchoolChallenges({ classroom }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  // Query by school (what the rules can verify), then keep this class's challenges.
  const { claims } = useAuth();
  const schoolChallenges = useQuery(() => (claims.schoolId ? query(collection(db, 'challenges'), where('schoolIds', 'array-contains', claims.schoolId)) : null), [claims.schoolId]);
  const challenges = { ...schoolChallenges, data: schoolChallenges.data.filter((c) => (c.classroomIds || []).includes(classroom.id)) };
  const [now] = useState(() => Date.now());
  const sorted = challenges.data.slice().sort((a, b) => toMillis(b.startsAt) - toMillis(a.startsAt));

  return (
    <section className="stack" aria-labelledby="sc-heading">
      <div className="row-between">
        <div className="stack" style={{ gap: 4 }}>
          <h2 id="sc-heading">School Challenge</h2>
          <p className="muted">A time-boxed contest between classes. Standings show class totals only.</p>
        </div>
        <div className="row">
          <Button onClick={() => setJoinOpen(true)}>Join with a code</Button>
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            New challenge
          </Button>
        </div>
      </div>
      {challenges.loading ? (
        <Loading label="Loading challenges…" />
      ) : challenges.error ? (
        <ErrorNote error={challenges.error} />
      ) : !sorted.length ? (
        <EmptyState emoji="🏆" title="No challenges yet">
          Create one and share the code, or join another class’s challenge.
        </EmptyState>
      ) : (
        <div className="stack">
          {sorted.map((c) => (
            <ChallengeCard key={c.id} challenge={c} classroomId={classroom.id} now={now} />
          ))}
        </div>
      )}
      {createOpen ? <ChallengeModal classroom={classroom} onClose={() => setCreateOpen(false)} /> : null}
      {joinOpen ? <JoinChallengeModal classroom={classroom} onClose={() => setJoinOpen(false)} /> : null}
    </section>
  );
}

function ChallengeCard({ challenge, classroomId, now }) {
  const standings = Object.entries(challenge.standings || {})
    .map(([id, s]) => ({ id, className: s?.className || 'Class', schoolName: s?.schoolName || '', points: s?.points || 0 }))
    .sort((a, b) => b.points - a.points);
  const ends = toMillis(challenge.endsAt);
  const starts = toMillis(challenge.startsAt);
  const status = ends && ends < now ? 'Ended' : starts && starts > now ? 'Upcoming' : 'Active';
  return (
    <Card>
      <div className="stack">
        <div className="row-between" style={{ alignItems: 'flex-start' }}>
          <div className="stack" style={{ gap: 4 }}>
            <h3>{challenge.name}</h3>
            <span className="caption">
              {fmtDate(starts)} to {fmtDate(ends)}
            </span>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <Chip tone={status === 'Active' ? 'teal' : 'gray'}>{status}</Chip>
            <Chip tone="sun">
              Code <span className="tabular" style={{ letterSpacing: '0.12em' }}>{challenge.inviteCode}</span>
            </Chip>
          </div>
        </div>
        {standings.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col" className="num">
                    Rank
                  </th>
                  <th scope="col">Class</th>
                  <th scope="col">School</th>
                  <th scope="col" className="num">
                    Points
                  </th>
                </tr>
              </thead>
              <tbody>
                {standings.map((s, i) => (
                  <tr key={s.id}>
                    <td className="num">{i + 1}</td>
                    <td style={{ fontWeight: s.id === classroomId ? 800 : undefined }}>
                      {s.className}
                      {s.id === classroomId ? ' (your class)' : ''}
                    </td>
                    <td>{s.schoolName}</td>
                    <td className="num">{fmtNum(s.points)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <span className="caption">Standings appear after the first games are played.</span>
        )}
      </div>
    </Card>
  );
}

function ChallengeModal({ classroom, onClose }) {
  const { user, claims } = useAuth();
  const toast = useToast();
  const [name, setName] = useState('');
  const [start, setStart] = useState(() => dateInput(Date.now()));
  const [end, setEnd] = useState(() => dateInput(Date.now() + 13 * DAY_MS));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e?.preventDefault();
    if (!name.trim()) return setError('Give the challenge a name.');
    if (!start || !end) return setError('Pick a start and end date.');
    const startsAt = startOfDay(start);
    const endsAt = endOfDay(end);
    if (endsAt <= startsAt) return setError('The end date must be after the start date.');
    setBusy(true);
    setError(null);
    try {
      const schoolId = claims.schoolId || classroom.schoolId;
      await addDoc(collection(db, 'challenges'), {
        name: name.trim(),
        hostSchoolId: schoolId,
        schoolIds: [schoolId],
        classroomIds: [classroom.id],
        startsAt,
        endsAt,
        categories: [],
        metric: 'correct',
        inviteCode: randomCode(6),
        standings: {},
        createdBy: user.uid,
        createdAt: serverTimestamp()
      });
      toast('Challenge created');
      onClose();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="New school challenge"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={busy}>
            Create challenge
          </Button>
        </>
      }
    >
      <form className="stack" onSubmit={submit}>
        <Field label="Challenge name" hint="For example: Spring Brain Bowl">
          {(id) => <input id={id} className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="off" />}
        </Field>
        <div className="grid-2">
          <Field label="Starts">
            {(id) => <input id={id} type="date" className="input" value={start} onChange={(e) => setStart(e.target.value)} />}
          </Field>
          <Field label="Ends">
            {(id) => <input id={id} type="date" className="input" value={end} onChange={(e) => setEnd(e.target.value)} />}
          </Field>
        </div>
        <p className="caption">Classes score by correct answers. You get a code to share with other teachers.</p>
        {error ? <ErrorNote>{error}</ErrorNote> : null}
      </form>
    </Modal>
  );
}

function JoinChallengeModal({ classroom, onClose }) {
  const toast = useToast();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e?.preventDefault();
    const clean = code.trim().toUpperCase();
    if (clean.length < 4) return setError('Enter the challenge code.');
    setBusy(true);
    setError(null);
    try {
      await request('adminActions', { action: 'joinChallenge', code: clean, classroomId: classroom.id });
      toast(`${classroom.name} joined the challenge`);
      onClose();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Join a challenge"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={busy}>
            Join challenge
          </Button>
        </>
      }
    >
      <form className="stack" onSubmit={submit}>
        <Field label="Challenge code" hint={`Joins ${classroom.name}.`}>
          {(id) => (
            <input
              id={id}
              className="input input-lg code-input"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              maxLength={6}
              autoComplete="off"
              autoCapitalize="characters"
            />
          )}
        </Field>
        {error ? <ErrorNote>{error}</ErrorNote> : null}
      </form>
    </Modal>
  );
}
