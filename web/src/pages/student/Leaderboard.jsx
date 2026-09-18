// Leaderboard (/play/leaderboard): weekly class XP board + team totals.
// Firestore reads: students/{id} (live, via useAuth), classrooms/{classroomId}
//   leaderboards/{classroomId}_{weekKey} (only when settings.leaderboard == 'class')
//   teamboards/{classroomId}_{weekKey} (when 'class' or 'teams')
// Firestore writes: students/{id} { leaderboardOptOut }
import { useDoc } from '../../hooks/useFirestore.js';
import { weekKey, fmtNum } from '../../lib/format.js';
import { Avatar, ButtonLink, Card, EmptyState, ErrorNote, Loading, PageHeader } from '../../components/ui.jsx';
import { LeaderboardToggle, StudentGate, useMyClassroom } from '../../components/student/common.jsx';
import './student.css';

const EMPTY_TEXT = 'No scores yet this week. Play a quest to get on the board.';

export default function Leaderboard() {
  return <StudentGate>{(student) => <LeaderboardBody student={student} />}</StudentGate>;
}

function LeaderboardBody({ student }) {
  const cls = useMyClassroom();
  const mode = cls.data?.settings?.leaderboard || 'class';
  const wk = weekKey();
  const cid = student.classroomId;
  const showClass = !cls.loading && cls.data && mode === 'class';
  const showTeams = !cls.loading && cls.data && (mode === 'class' || mode === 'teams');
  const board = useDoc(showClass ? `leaderboards/${cid}_${wk}` : null);
  const teams = useDoc(showTeams ? `teamboards/${cid}_${wk}` : null);

  return (
    <div className="page stack-xl">
      <PageHeader eyebrow="This week" title="Leaderboard" subtitle="Every question you answer helps you and your team climb." />

      {cls.loading ? <Loading /> : null}
      {cls.error ? <ErrorNote error={cls.error} /> : null}

      {!cls.loading && cls.data && mode === 'off' ? (
        <EmptyState emoji="🌟" title="Leaderboards are off" action={<ButtonLink to="/play/progress" variant="primary" size="lg">See my progress</ButtonLink>}>
          Your teacher has leaderboards turned off for your class. You can still track your own progress.
        </EmptyState>
      ) : null}

      {showClass ? <ClassBoard state={board} me={student} /> : null}
      {showTeams ? <TeamBoard state={teams} myTeamId={student.teamId} /> : null}

      {!cls.loading && mode !== 'off' ? (
        <Card>
          <LeaderboardToggle student={student} />
        </Card>
      ) : null}
    </div>
  );
}

// A board doc that doesn't exist yet is denied by the rules (they read resource.data),
// so treat "missing" and "denied" the same: nothing posted this week.
function boardEmpty(state) {
  return !state.data || (state.error && /permission|insufficient/i.test(state.error.message || ''));
}

function ClassBoard({ state, me }) {
  const entries = state.data?.entries || [];
  return (
    <Card aria-labelledby="class-h">
      <div className="stack">
        <h2 id="class-h" className="eyebrow" style={{ fontSize: '0.875rem' }}>
          Weekly leaderboard
        </h2>
        {me.leaderboardOptOut ? <p className="caption">You chose to stay off this board. Your XP still counts for your team.</p> : null}
        {state.loading ? (
          <Loading />
        ) : state.error && !boardEmpty(state) ? (
          <ErrorNote error={state.error} />
        ) : boardEmpty(state) || !entries.length ? (
          <EmptyState emoji="🏁" title="Ready, set, quest">
            {EMPTY_TEXT}
          </EmptyState>
        ) : (
          <ol className="qq-board">
            {entries.map((e, i) => {
              const isMe = e.studentId === me.id;
              return (
                <li key={e.studentId} className={`qq-board-row ${isMe ? 'qq-board-me' : ''}`} aria-current={isMe ? 'true' : undefined}>
                  <span className={`qq-rank ${i < 3 ? `qq-rank-${i + 1}` : ''}`} aria-label={`Rank ${i + 1}`}>
                    {i + 1}
                  </span>
                  <Avatar emoji={e.avatar} />
                  <span className="qq-board-name">
                    {e.displayName}
                    {isMe ? <span className="chip chip-sun" style={{ marginLeft: 8 }}>You</span> : null}
                  </span>
                  <span className="qq-board-xp">{fmtNum(e.xp || 0)} XP</span>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </Card>
  );
}

function TeamBoard({ state, myTeamId }) {
  const list = [...(state.data?.teams || [])].sort((a, b) => (b.xp || 0) - (a.xp || 0));
  return (
    <Card aria-labelledby="teams-h">
      <div className="stack">
        <h2 id="teams-h" className="eyebrow" style={{ fontSize: '0.875rem' }}>
          Team totals
        </h2>
        {state.loading ? (
          <Loading />
        ) : state.error && !boardEmpty(state) ? (
          <ErrorNote error={state.error} />
        ) : boardEmpty(state) || !list.length ? (
          <EmptyState emoji="🤝" title="No team scores yet">
            {EMPTY_TEXT}
          </EmptyState>
        ) : (
          <ol className="qq-board">
            {list.map((t, i) => {
              const mine = t.teamId === myTeamId;
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
