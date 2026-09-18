// Team Quest (/play/team): the student's team and active team quests.
// Firestore reads: students/{id} (live, via useAuth), teams/{teamId}
//   teamQuests where classroomId == X (active ones filtered client-side: endsAt > now,
//   teamId == mine or null)
// Firestore writes: sessionRequests (via startSession) for "Help your team"
import { collection, query, where } from 'firebase/firestore';
import { db } from '../../firebase.js';
import { useDoc, useQuery } from '../../hooks/useFirestore.js';
import { categoryMeta } from '../../lib/catalog.js';
import { fmtNum } from '../../lib/format.js';
import { Button, ButtonLink, Card, EmptyState, ErrorNote, Loading, PageHeader, ProgressBar } from '../../components/ui.jsx';
import { CategoryChip, DAY_MS, StudentGate, useStartMatch } from '../../components/student/common.jsx';
import './student.css';

export default function TeamQuest() {
  return <StudentGate>{(student) => <TeamQuestBody student={student} />}</StudentGate>;
}

function TeamQuestBody({ student }) {
  const team = useDoc(student.teamId ? `teams/${student.teamId}` : null);
  const quests = useQuery(() => query(collection(db, 'teamQuests'), where('classroomId', '==', student.classroomId)), [student.classroomId]);
  const match = useStartMatch();
  const now = Date.now();
  const active = quests.data
    .filter((q) => (q.endsAt || 0) > now && (q.startsAt || 0) <= now && (!q.teamId || q.teamId === student.teamId))
    .sort((a, b) => (a.completedAt ? 1 : 0) - (b.completedAt ? 1 : 0) || (a.endsAt || 0) - (b.endsAt || 0));

  return (
    <div className="page stack-xl">
      <PageHeader eyebrow="Team Quest" title="Play together, win together" subtitle="Every question you get right moves your team's quest forward." />

      {student.teamId ? (
        team.loading ? (
          <Loading />
        ) : team.data ? (
          <Card tone="purple">
            <div className="row" style={{ gap: 16, flexWrap: 'nowrap' }}>
              <span className="qq-team-emoji" style={{ width: 64, height: 64, fontSize: '2.25rem' }} aria-hidden>
                {team.data.emoji || '🚩'}
              </span>
              <div className="stack" style={{ gap: 2 }}>
                <span className="eyebrow">Your team</span>
                <h2>{team.data.name}</h2>
                <span className="caption tabular">You've added {fmtNum(student.teamContribution || 0)} to team quests so far.</span>
              </div>
            </div>
          </Card>
        ) : null
      ) : (
        <Card tone="purple">
          <p>You're not on a team yet. Class quests still count everything you answer.</p>
        </Card>
      )}

      <section className="stack-lg" aria-labelledby="quests-h">
        <h2 id="quests-h">Active quests</h2>
        <ErrorNote>{match.error?.message}</ErrorNote>
        {quests.loading ? (
          <Loading label="Loading quests…" />
        ) : quests.error ? (
          <ErrorNote error={quests.error} />
        ) : active.length === 0 ? (
          <EmptyState emoji="🗺️" title="No team quests right now" action={<ButtonLink to="/play/worlds" variant="primary" size="lg">Play a world</ButtonLink>}>
            Your teacher starts team quests. Keep practicing so you're ready.
          </EmptyState>
        ) : (
          active.map((q) => <QuestCard key={q.id} quest={q} student={student} match={match} teamName={team.data?.name} now={now} />)
        )}
      </section>
    </div>
  );
}

function QuestCard({ quest, student, match, teamName, now }) {
  const done = !!quest.completedAt || (quest.progress || 0) >= (quest.target || 1);
  const daysLeft = Math.max(0, Math.ceil(((quest.endsAt || 0) - now) / DAY_MS));
  const unit = quest.metric === 'answered' ? 'answered' : 'correct';
  const contributions = Object.entries(quest.contributions || {})
    .map(([id, n]) => ({ id, n, name: id === student.id ? 'You' : quest.names?.[id] || 'Teammate' }))
    .sort((a, b) => b.n - a.n);
  const top = contributions.slice(0, 5);
  const mine = contributions.find((c) => c.id === student.id);
  if (mine && !top.includes(mine)) top.push(mine);
  const key = `quest:${quest.id}`;
  const color = quest.category ? categoryMeta(quest.category).color : undefined;

  return (
    <Card className={done ? 'qq-quest-done' : ''} aria-labelledby={`q-${quest.id}`}>
      <div className="stack-lg">
        <div className="row-between" style={{ alignItems: 'flex-start' }}>
          <div className="stack" style={{ gap: 8 }}>
            <h3 id={`q-${quest.id}`} style={{ fontSize: '1.375rem' }}>
              {done ? <span aria-hidden className="qq-ico">🎉</span> : null}
              {quest.title}
            </h3>
            <div className="row" style={{ gap: 8 }}>
              {quest.category ? <CategoryChip category={quest.category} /> : <span className="chip">All subjects</span>}
              <span className="chip chip-gray">{quest.teamId ? teamName || 'Your team' : 'Whole class'}</span>
            </div>
          </div>
          {done ? (
            <span className="chip chip-green" style={{ fontSize: '0.9375rem' }}>
              <span aria-hidden>✓</span> Complete
            </span>
          ) : (
            <span className="chip chip-sun tabular">
              {daysLeft <= 1 ? 'Last day' : `${daysLeft} days left`}
            </span>
          )}
        </div>

        <div className="stack" style={{ gap: 8 }}>
          <ProgressBar value={Math.min(quest.progress || 0, quest.target || 1)} max={quest.target || 1} color={done ? 'var(--green)' : color} label={`${quest.title} progress`} height={18} />
          <span className="tabular" style={{ fontWeight: 800 }}>
            {fmtNum(quest.progress || 0)} of {fmtNum(quest.target || 0)} {unit}
          </span>
        </div>

        {done ? <p style={{ fontWeight: 700 }}>Quest complete! Amazing teamwork. You can keep playing to add more.</p> : null}

        <div className="stack" style={{ gap: 8 }}>
          <h4>Top helpers</h4>
          {top.length ? (
            <ol className="qq-contrib">
              {top.map((c) => (
                <li key={c.id} className={c.id === student.id ? 'qq-me' : ''}>
                  <span>{c.name}</span>
                  <span className="tabular">{fmtNum(c.n)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted">No one has added to this quest yet. Be the first!</p>
          )}
          {!mine ? <p className="caption">Your answers will show up here after your next match.</p> : null}
        </div>

        <Button
          variant={done ? 'default' : 'primary'}
          size="lg"
          loading={match.busy === key}
          disabled={match.busy != null}
          onClick={() => match.start(key, 'practice', { category: quest.category || undefined, count: 5 })}
          style={{ alignSelf: 'flex-start' }}
        >
          {match.busy === key ? 'Building your match…' : 'Help your team'}
        </Button>
      </div>
    </Card>
  );
}
