// Progress (/play/progress): accuracy, buzz timing, category strengths, versus record,
// Score Attack bests, streak, and recent matches.
// Firestore reads: students/{id} (live, via useAuth)
//   sessionSummaries where studentId == id orderBy completedAt desc limit 15
// Firestore writes: none
import { Link } from 'react-router-dom';
import { collection, limit, orderBy, query, where } from 'firebase/firestore';
import { db } from '../../firebase.js';
import { useQuery } from '../../hooks/useFirestore.js';
import { CATEGORIES, personaById } from '../../lib/catalog.js';
import { MODE_LABELS } from '../../lib/game.js';
import { fmtNum, pct, timeAgo } from '../../lib/format.js';
import { Avatar, ButtonLink, Card, EmptyState, ErrorNote, Loading, PageHeader, Stat, StrengthRow } from '../../components/ui.jsx';
import { StudentGate } from '../../components/student/common.jsx';
import './student.css';

export default function Progress() {
  return <StudentGate>{(student) => <ProgressBody student={student} />}</StudentGate>;
}

function ProgressBody({ student }) {
  const stats = student.stats || {};
  const correct = stats.correct || 0;
  const answered = stats.answered || 0;
  const clueFraction = correct ? Math.round(((stats.clueFractionSum || 0) / correct) * 100) : null;
  const versusPlayed = stats.versusPlayed || 0;
  const versusWon = stats.versusWon || 0;
  const bests = student.personalBests?.score_attack;
  const streak = student.streak || {};

  const summaries = useQuery(
    () => query(collection(db, 'sessionSummaries'), where('studentId', '==', student.id), orderBy('completedAt', 'desc'), limit(15)),
    [student.id]
  );

  return (
    <div className="page stack-xl">
      <PageHeader eyebrow="My stats" title="Your progress" subtitle="See what you're great at and where you're growing." />

      <section className="stack" aria-labelledby="overview-h">
        <h2 id="overview-h" className="sr-only">
          Overview
        </h2>
        <div className="qq-stats">
          <Card tight>
            <Stat value={answered ? `${pct(correct, answered)}%` : 'n/a'} label="Accuracy" hint={`${fmtNum(correct)} right of ${fmtNum(answered)} answered`} />
          </Card>
          <Card tight>
            <Stat value={fmtNum(stats.seen || 0)} label="Questions seen" hint={`${fmtNum(stats.sessions || 0)} matches finished`} />
          </Card>
          <Card tight>
            <Stat value={fmtNum(streak.current || 0)} label="Day streak" hint={`Best: ${fmtNum(streak.best || 0)} days`} />
          </Card>
          <Card tight>
            <Stat value={fmtNum(stats.early || 0)} label="Early buzzes" hint={`${fmtNum(stats.powers || 0)} powers`} />
          </Card>
        </div>
      </section>

      <div className="grid-2">
        <Card tone="teal" aria-labelledby="buzz-h">
          <div className="stack">
            <h2 id="buzz-h">
              <span aria-hidden className="qq-ico">🔔</span>Buzz timing
            </h2>
            {clueFraction == null ? (
              <p className="prose">Get your first question right to see how early you buzz.</p>
            ) : (
              <>
                <p className="stat-value tabular">{clueFraction}%</p>
                <p className="prose">
                  You buzz correctly {clueFraction}% of the way through a question on average. A lower number means you knew it sooner.
                </p>
              </>
            )}
            <p className="caption">
              Early buzzes: <strong className="tabular">{fmtNum(stats.early || 0)}</strong> · Powers: <strong className="tabular">{fmtNum(stats.powers || 0)}</strong>
            </p>
          </div>
        </Card>

        <Card tone="coral" aria-labelledby="versus-h">
          <div className="stack">
            <h2 id="versus-h">
              <span aria-hidden className="qq-ico">🤖</span>Battle record
            </h2>
            {versusPlayed ? (
              <>
                <p className="stat-value tabular">
                  {versusWon} won of {versusPlayed}
                </p>
                <p className="prose">That's a {pct(versusWon, versusPlayed)}% win rate against computer rivals.</p>
              </>
            ) : (
              <p className="prose">Battle a computer rival to start your record.</p>
            )}
            <ButtonLink to="/play/modes" variant="coral" style={{ alignSelf: 'flex-start' }}>
              Find a rival
            </ButtonLink>
          </div>
        </Card>
      </div>

      <CategoryStrengths stats={stats} />

      <Card aria-labelledby="bests-h">
        <div className="stack">
          <h2 id="bests-h">
            <span aria-hidden className="qq-ico">🏅</span>Solo Score Attack bests
          </h2>
          {bests ? (
            <div className="qq-stats">
              <Stat value={fmtNum(bests.points || 0)} label="Points" />
              <Stat value={`${bests.accuracy || 0}%`} label="Accuracy" />
              <Stat value={fmtNum(bests.streak || 0)} label="Answer streak" />
              <Stat value={fmtNum(bests.earlyBuzz || 0)} label="Early buzz score" />
            </div>
          ) : (
            <p className="muted">Play Solo Score Attack to set your first personal best.</p>
          )}
        </div>
      </Card>

      <section className="stack" aria-labelledby="recent-h">
        <h2 id="recent-h">Recent matches</h2>
        <RecentMatches summaries={summaries} />
      </section>
    </div>
  );
}

function CategoryStrengths({ stats }) {
  const cats = stats.categories || {};
  const rows = CATEGORIES.map((c) => {
    const s = cats[c.id] || {};
    const answered = s.answered || 0;
    return { ...c, answered, correct: s.correct || 0, acc: answered ? pct(s.correct || 0, answered) : null };
  });
  const played = rows.filter((r) => r.answered > 0).sort((a, b) => b.acc - a.acc || b.answered - a.answered);
  const tags = {};
  if (played.length >= 3) {
    const n = played.length >= 5 ? 2 : 1;
    played.slice(0, n).forEach((r) => (tags[r.id] = 'strength'));
    played.slice(-n).forEach((r) => (tags[r.id] = 'growing'));
  }
  const ordered = [...played, ...rows.filter((r) => r.answered === 0)];

  return (
    <Card aria-labelledby="cats-h">
      <div className="stack-lg">
        <div className="stack" style={{ gap: 4 }}>
          <h2 id="cats-h">Category strengths</h2>
          <p className="caption">Accuracy on questions you answered in each subject.</p>
        </div>
        {played.length === 0 ? <p className="muted">Answer a few questions to see your strengths.</p> : null}
        {ordered.map((r) => (
          <div key={r.id} className="stack" style={{ gap: 6 }}>
            {tags[r.id] === 'strength' ? (
              <span className="chip chip-green" style={{ alignSelf: 'flex-start' }}>
                <span aria-hidden>💪</span> Strength
              </span>
            ) : null}
            {tags[r.id] === 'growing' ? (
              <span className="chip chip-sun" style={{ alignSelf: 'flex-start' }}>
                <span aria-hidden>🌱</span> Growing
              </span>
            ) : null}
            <StrengthRow
              label={r.id}
              emoji={r.emoji}
              value={r.acc}
              color={r.color}
              detail={r.answered ? `${r.correct} of ${r.answered}` : 'Not tried yet'}
            />
          </div>
        ))}
      </div>
    </Card>
  );
}

function RecentMatches({ summaries }) {
  if (summaries.loading) return <Loading label="Loading your matches…" />;
  if (summaries.error) return <ErrorNote error={summaries.error} />;
  if (!summaries.data.length) {
    return (
      <EmptyState emoji="🎮" title="No matches yet" action={<ButtonLink to="/play/worlds" variant="primary" size="lg">Start a quest</ButtonLink>}>
        Finished matches show up here with your score.
      </EmptyState>
    );
  }
  return (
    <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 12 }}>
      {summaries.data.map((s) => (
        <li key={s.id}>
          <MatchRow s={s} />
        </li>
      ))}
    </ul>
  );
}

function resultChip(s) {
  if (s.won == null && !s.tie) return <span className="chip chip-gray">Done</span>;
  if (s.tie) return <span className="chip chip-sun">Tie</span>;
  if (s.won)
    return (
      <span className="chip chip-green">
        <span aria-hidden>🏆</span> Won
      </span>
    );
  return <span className="chip chip-coral">Lost</span>;
}

function MatchRow({ s }) {
  const persona = s.opponent?.personaId ? personaById(s.opponent.personaId) : null;
  const avatar = s.opponent?.avatar || persona?.avatar || (s.opponent ? '🤖' : '⭐');
  const parts = [];
  if (s.title) parts.push(s.title);
  if (s.opponent?.name) parts.push(`vs ${s.opponent.name}`);
  if (s.liveTeam) parts.push(s.liveTeam);
  if (!parts.length && s.byCategory) parts.push(Object.keys(s.byCategory).join(', '));
  const title = parts.join(' · ');
  const acc = s.answered ? `${pct(s.correct || 0, s.answered)}%` : 'n/a';
  return (
    <Link to={`/play/results/${s.sessionId}`} className="qq-match-row">
      <Avatar emoji={avatar} />
      <div className="stack" style={{ gap: 4, minWidth: 0 }}>
        <span style={{ fontWeight: 800 }}>
          {MODE_LABELS[s.mode] || 'Match'}
          {title ? <span className="muted" style={{ fontWeight: 700 }}> · {title}</span> : null}
        </span>
        <span className="qq-match-meta">
          <span>{fmtNum(s.points || 0)} pts</span>
          <span>{acc} accuracy</span>
          <span>+{fmtNum(s.xpEarned || 0)} XP</span>
          <span>{timeAgo(s.completedAt)}</span>
        </span>
      </div>
      {resultChip(s)}
    </Link>
  );
}
