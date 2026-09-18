// Team HQ (/play/team): school-themed hub. School weekly quest, class team quests,
// team totals (when the class leaderboard setting allows), and school gear.
// Firestore reads: students/{id} (live, via useAuth), schoolThemes/{schoolId} (useSchoolTheme),
//   schoolQuests where schoolId == claims.schoolId (active filtered client-side),
//   teams/{teamId}, teamQuests where classroomId == X (active: startsAt <= now < endsAt, teamId == mine or null),
//   classrooms/{cid} (leaderboard setting), teamboards/{cid}_{weekKey} (when 'class' or 'teams').
// Firestore writes: sessionRequests (via startSession) for "Help your team".
import { collection, query, where } from 'firebase/firestore';
import { db } from '../../firebase.js';
import { useAuth } from '../../hooks/useAuth.jsx';
import { useDoc, useQuery } from '../../hooks/useFirestore.js';
import { useSchoolTheme } from '../../hooks/useSchoolTheme.js';
import { categoryMeta } from '../../lib/catalog.js';
import { fmtNum, weekKey } from '../../lib/format.js';
import { owns, rewards, unlockLabel } from '../../lib/rewards.js';
import { ChestArt, Crest, ItemArt, ProgressVisual, itemDisplayName } from '../../components/bot/index.js';
import { Button, ButtonLink, Card, EmptyState, ErrorNote, Loading, ProgressBar } from '../../components/ui.jsx';
import { CategoryChip, DAY_MS, StudentGate, useMyClassroom, useStartMatch } from '../../components/student/common.jsx';
import { CheckIcon, LockIcon, RarityChip, isApprovedSchoolItem, mascotOne, rarityColor } from '../../components/collection/parts.jsx';
import './student.css';

export default function TeamQuest() {
  return <StudentGate>{(student) => <TeamHQ student={student} />}</StudentGate>;
}

const daysLeftLabel = (endsAt, now) => {
  const d = Math.max(0, Math.ceil(((endsAt || 0) - now) / DAY_MS));
  return d <= 1 ? 'Last day' : `${d} days left`;
};

function TeamHQ({ student }) {
  const { claims } = useAuth();
  const { theme, schoolName, rewardCatalog, loading: themeLoading } = useSchoolTheme();
  const team = useDoc(student.teamId ? `teams/${student.teamId}` : null);
  const quests = useQuery(() => query(collection(db, 'teamQuests'), where('classroomId', '==', student.classroomId)), [student.classroomId]);
  const schoolId = claims.schoolId || student.schoolId;
  const schoolQuests = useQuery(() => (schoolId ? query(collection(db, 'schoolQuests'), where('schoolId', '==', schoolId)) : null), [schoolId]);
  const match = useStartMatch();
  const now = Date.now();
  const active = quests.data
    .filter((q) => (q.endsAt || 0) > now && (q.startsAt || 0) <= now && (!q.teamId || q.teamId === student.teamId))
    .sort((a, b) => (a.completedAt ? 1 : 0) - (b.completedAt ? 1 : 0) || (a.endsAt || 0) - (b.endsAt || 0));
  const schoolActive = schoolQuests.data.filter((q) => (q.startsAt || 0) <= now && now < (q.endsAt || 0)).sort((a, b) => (a.endsAt || 0) - (b.endsAt || 0));
  const vars = { '--school-1': theme.primaryColor, '--school-2': theme.secondaryColor, '--school-3': theme.accentColor };

  return (
    <div className="page qc-page stack-xl" style={vars}>
      <header className="qc-hq-head">
        <Crest theme={theme} size={84} />
        <div className="stack" style={{ gap: 4, flex: 1, minWidth: 200 }}>
          <span className="eyebrow">{themeLoading ? ' ' : schoolName || theme.displayName}</span>
          <h1>{theme.teamHubLabel}</h1>
          <p style={{ fontWeight: 700, opacity: 0.92 }}>
            {student.displayName}
            {team.data ? ` · Team ${team.data.name}` : ''} · Every right answer powers up your school.
          </p>
        </div>
        {team.data ? (
          <span className="qq-team-emoji" style={{ width: 64, height: 64, fontSize: '2.25rem', background: 'rgb(255 255 255 / 0.18)' }} aria-hidden>
            {team.data.emoji || '🚩'}
          </span>
        ) : null}
      </header>

      <section className="stack-lg" aria-labelledby="school-q-h">
        <h2 id="school-q-h">{theme.weeklyQuestLabel}</h2>
        {schoolQuests.loading ? (
          <Loading label="Loading your school quest…" />
        ) : schoolQuests.error ? (
          <ErrorNote error={schoolQuests.error} />
        ) : schoolActive.length === 0 ? (
          <EmptyState emoji="🏫" title="No school quest this week">
            When your school starts a {theme.weeklyQuestLabel}, it shows up here. Every {mascotOne(theme)} who helps earns the {theme.mascotName} Chest.
          </EmptyState>
        ) : (
          schoolActive.map((q) => <SchoolQuestCard key={q.id} quest={q} student={student} theme={theme} now={now} match={match} />)
        )}
      </section>

      <section className="stack-lg" aria-labelledby="quests-h">
        <div className="stack" style={{ gap: 4 }}>
          <h2 id="quests-h">Class team quests</h2>
          {student.teamId ? (
            <span className="caption tabular">You've added {fmtNum(student.teamContribution || 0)} to team quests so far.</span>
          ) : (
            <span className="caption">You're not on a team yet. Class quests still count everything you answer.</span>
          )}
        </div>
        <ErrorNote>{match.error?.message}</ErrorNote>
        {quests.loading ? (
          <Loading label="Loading quests…" />
        ) : quests.error ? (
          <ErrorNote error={quests.error} />
        ) : active.length === 0 ? (
          <EmptyState emoji="🗺️" title="No team quests right now" action={<ButtonLink to="/play" variant="primary" size="lg">Go on a quest</ButtonLink>}>
            Your teacher starts team quests. Keep practicing so you're ready.
          </EmptyState>
        ) : (
          active.map((q) => <QuestCard key={q.id} quest={q} student={student} match={match} teamName={team.data?.name} now={now} />)
        )}
      </section>

      <TeamTotals student={student} />

      <SchoolGear student={student} theme={theme} rewardCatalog={rewardCatalog} />
    </div>
  );
}

function SchoolQuestCard({ quest, student, theme, now, match }) {
  const target = quest.target || 1;
  const progress = Math.min(quest.progress || 0, target);
  const done = !!quest.completedAt || progress >= target;
  const mine = quest.contributions?.[student.id] || 0;
  const unit = quest.metric === 'answered' ? 'answered' : 'correct';
  const key = `school:${quest.id}`;
  return (
    <div className="qc-hq-quest">
      <ProgressVisual type={theme.progressVisual} value={progress} max={target} theme={theme} size={170} label={theme.progressLabel} />
      <div className="stack">
        <div className="row-between" style={{ alignItems: 'flex-start' }}>
          <div className="stack" style={{ gap: 6 }}>
            <h3 style={{ fontSize: '1.5rem' }}>{quest.title}</h3>
            {quest.description ? <p className="muted">{quest.description}</p> : null}
            <div className="row" style={{ gap: 8 }}>
              {quest.category ? <CategoryChip category={quest.category} /> : <span className="chip">All subjects</span>}
              <span className="chip chip-gray">Whole school</span>
            </div>
          </div>
          {done ? (
            <span className="chip chip-green">
              <CheckIcon size={12} /> Complete
            </span>
          ) : (
            <span className="chip chip-sun tabular">{daysLeftLabel(quest.endsAt, now)}</span>
          )}
        </div>
        <div className="qc-hq-stats">
          <div className="qc-hq-stat">
            <span className="caption">School total</span>
            <strong className="tabular">
              {fmtNum(quest.progress || 0)} / {fmtNum(target)}
            </strong>
            <span className="caption">{unit}</span>
          </div>
          <div className="qc-hq-stat">
            <span className="caption">You added</span>
            <strong className="tabular">{fmtNum(mine)}</strong>
            <span className="caption">{mine ? 'Thank you!' : 'Not yet'}</span>
          </div>
        </div>
        <div className="qc-hq-reward">
          <ChestArt rarity="epic" state={done && mine ? 'ready' : 'closed'} school theme={theme} size={56} />
          <span>
            {done
              ? mine
                ? `Quest complete! Your ${theme.mascotName} Chest is in your Vault.`
                : `Quest complete! Help with the next one to earn the ${theme.mascotName} Chest.`
              : `Every ${mascotOne(theme)} who helps earns the ${theme.mascotName} Chest.`}
          </span>
        </div>
        {done && mine ? (
          <ButtonLink to="/play/vault" variant="sun" style={{ alignSelf: 'flex-start' }}>
            Open your Vault
          </ButtonLink>
        ) : !done ? (
          <Button
            variant="primary"
            size="lg"
            loading={match.busy === key}
            disabled={match.busy != null}
            onClick={() => match.start(key, 'practice', { category: quest.category || undefined, count: 5 })}
            style={{ alignSelf: 'flex-start' }}
          >
            {match.busy === key ? 'Building your match…' : 'Help your school'}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function QuestCard({ quest, student, match, teamName, now }) {
  const done = !!quest.completedAt || (quest.progress || 0) >= (quest.target || 1);
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
            <span className="chip chip-sun tabular">{daysLeftLabel(quest.endsAt, now)}</span>
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

// Same visibility rule as the Leaderboard page: only when the class setting is 'class' or 'teams'.
// A board that doesn't exist yet is denied by the rules, so "missing" and "denied" both mean empty.
function boardEmpty(state) {
  return !state.data || (state.error && /permission|insufficient/i.test(state.error.message || ''));
}

function TeamTotals({ student }) {
  const cls = useMyClassroom();
  const mode = cls.data?.settings?.leaderboard || 'class';
  const show = !cls.loading && cls.data && (mode === 'class' || mode === 'teams');
  const state = useDoc(show ? `teamboards/${student.classroomId}_${weekKey()}` : null);
  if (cls.loading || !show) return null;
  const list = [...(state.data?.teams || [])].sort((a, b) => (b.xp || 0) - (a.xp || 0));
  return (
    <Card aria-labelledby="teams-h">
      <div className="stack">
        <h2 id="teams-h">Team totals this week</h2>
        {state.loading ? (
          <Loading />
        ) : state.error && !boardEmpty(state) ? (
          <ErrorNote error={state.error} />
        ) : boardEmpty(state) || !list.length ? (
          <EmptyState emoji="🤝" title="No team scores yet">
            No scores yet this week. Play a quest to get your team on the board.
          </EmptyState>
        ) : (
          <ol className="qq-board">
            {list.map((t, i) => {
              const mine = t.teamId === student.teamId;
              return (
                <li key={t.teamId} className={`qq-board-row ${mine ? 'qq-board-me' : ''}`}>
                  <span className={`qq-rank ${i < 3 ? `qq-rank-${i + 1}` : ''}`} aria-label={`Rank ${i + 1}`}>
                    {i + 1}
                  </span>
                  <span className="qq-team-emoji" aria-hidden>
                    {t.emoji || '🚩'}
                  </span>
                  <span className="qq-board-name">
                    {t.name}
                    {mine ? <span className="chip chip-sun" style={{ marginLeft: 8 }}>Your team</span> : null}
                    <span className="caption tabular" style={{ display: 'block', fontWeight: 700 }}>
                      {fmtNum(t.correct || 0)} correct
                    </span>
                  </span>
                  <span className="qq-board-xp">{fmtNum(t.xp || 0)} XP</span>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </Card>
  );
}

function SchoolGear({ student, theme, rewardCatalog }) {
  const items = rewards.cosmetics.filter((c) => c.school && isApprovedSchoolItem(c, rewardCatalog));
  if (!items.length) return null;
  const have = items.filter((c) => owns(student, c.id)).length;
  return (
    <Card aria-labelledby="gear-h">
      <div className="stack">
        <div className="row-between">
          <h2 id="gear-h">{theme.mascotName} Gear</h2>
          <span className="chip tabular">
            {have} of {items.length} owned
          </span>
        </div>
        <ul className="qc-pick-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))' }}>
          {items.map((c) => {
            const got = owns(student, c.id);
            return (
              <li key={c.id} className="qc-shelf-slot" style={{ '--rar': rarityColor(c.rarity), opacity: got ? 1 : 0.85 }}>
                <span style={{ opacity: got ? 1 : 0.5 }}>
                  <ItemArt itemId={c.id} theme={theme} size={64} />
                </span>
                <span>{itemDisplayName(c, theme)}</span>
                <RarityChip rarity={c.rarity} small />
                {got ? (
                  <span className="qc-owned-mark" style={{ margin: 0 }}>
                    <CheckIcon size={12} /> Owned
                  </span>
                ) : (
                  <span className="caption row" style={{ gap: 4, justifyContent: 'center' }}>
                    <LockIcon size={11} /> {unlockLabel(c)}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        <ButtonLink to="/play/garage" style={{ alignSelf: 'flex-start' }}>
          Try it on in My QuizBot
        </ButtonLink>
      </div>
    </Card>
  );
}
