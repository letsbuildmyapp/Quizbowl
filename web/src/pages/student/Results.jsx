// Post-match results: score, rewards, categories, early-buzz performance,
// missed clues, recommended next quest, rematch.
// Reads: sessions/{id}, sessionSummaries/{id}_{studentId}
// Writes: sessionRequests (rematch / next quest), analyticsEvents (rematch_click)
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase.js';
import { useAuth } from '../../hooks/useAuth.jsx';
import { useDoc } from '../../hooks/useFirestore.js';
import { Avatar, Button, ButtonLink, Card, Chip, ErrorNote, Loading, PageHeader, Stat, StrengthRow } from '../../components/ui.jsx';
import { ClueReview } from '../../components/game/GameParts.jsx';
import { MODE_LABELS, startSession } from '../../lib/game.js';
import { badgeById, categoryMeta, WORLDS } from '../../lib/catalog.js';
import { pct } from '../../lib/format.js';

export default function Results() {
  const { sessionId } = useParams();
  const { claims } = useAuth();
  const navigate = useNavigate();
  const studentId = claims.studentId;
  const { data: session, loading } = useDoc(`sessions/${sessionId}`);
  const { data: summary } = useDoc(studentId ? `sessionSummaries/${sessionId}_${studentId}` : null);
  const [starting, setStarting] = useState(null);
  const [err, setErr] = useState(null);

  if (loading) return <Loading full />;
  if (!session) {
    return (
      <div className="page page-narrow stack-lg">
        <h1>Results not found</h1>
        <ButtonLink to="/play" variant="primary">
          Back home
        </ButtonLink>
      </div>
    );
  }

  const me = session.participants.find((p) => p.id === studentId);
  const mySide = me?.side;
  const winner = session.result?.winnerSide;
  const opp = session.opponent;
  const versus = Object.keys(session.sides).length > 1;
  const won = versus && winner === mySide;
  const tie = winner === 'tie';

  const go = async (key, mode, options) => {
    setStarting(key);
    setErr(null);
    try {
      const id = await startSession(mode, options);
      navigate(`/play/match/${id}`);
    } catch (e) {
      setErr(e);
      setStarting(null);
    }
  };

  const rematch = () => {
    addDoc(collection(db, 'analyticsEvents'), { type: 'rematch_click', createdAt: serverTimestamp() }).catch(() => {});
    go('rematch', 'versus', { personaId: opp.personaId, count: session.total, category: session.category || undefined, rematchOf: sessionId });
  };

  let headline = 'Quest complete!';
  if (versus && tie) headline = "It's a tie!";
  else if (versus && won) headline = session.mode === 'live_battle' ? `${session.sides[mySide].name} win!` : `You beat ${opp?.name}!`;
  else if (versus) headline = session.mode === 'live_battle' ? 'Great battle!' : `${opp?.name} wins this time`;
  const oppLine = opp ? (won ? opp.lines?.lose : opp.lines?.win) : null;

  return (
    <div className="page stack-xl">
      <PageHeader eyebrow={session.title || MODE_LABELS[session.mode]} title={headline} subtitle={oppLine ? `${opp.avatar} “${oppLine}”` : null} />

      <Card className="row" style={{ justifyContent: 'space-around', gap: 24 }}>
        {Object.entries(session.sides).map(([k, s]) => (
          <div key={k} className="stack" style={{ alignItems: 'center', gap: 8 }}>
            <Avatar emoji={s.emoji} size="lg" />
            <strong>{k === mySide && session.mode !== 'live_battle' ? 'You' : s.name}</strong>
            <span className="stat-value" style={{ color: k === mySide ? 'var(--purple)' : undefined }}>
              {s.score}
            </span>
            {winner === k ? <Chip tone="sun">🏆 Winner</Chip> : null}
          </div>
        ))}
      </Card>

      {!summary ? (
        <Loading label="Adding up your rewards…" />
      ) : (
        <>
          <Rewards summary={summary} />
          <div className="grid-4">
            <Card>
              <Stat value={`${summary.correct}/${summary.seen}`} label="Correct" />
            </Card>
            <Card>
              <Stat value={summary.answered ? `${pct(summary.correct, summary.answered)}%` : 'n/a'} label="Accuracy" hint="of the questions you buzzed on" />
            </Card>
            <Card>
              <Stat value={summary.early} label="Early buzzes" hint="correct before the last clue" color="var(--teal)" />
            </Card>
            <Card>
              <Stat value={summary.powers} label="Powers" hint="correct in the power zone" color="var(--sun-strong)" />
            </Card>
          </div>

          <Card className="stack-lg">
            <h2>Categories</h2>
            {Object.entries(summary.byCategory || {}).map(([cat, c]) => {
              const m = categoryMeta(cat);
              return <StrengthRow key={cat} label={cat} emoji={m.emoji} value={c.seen ? pct(c.correct, c.seen) : 0} color={m.color} detail={`${c.correct} of ${c.seen}`} />;
            })}
          </Card>

          {summary.recommendation ? (
            <Card tone="teal" className="row-between">
              <div className="stack" style={{ gap: 4 }}>
                <span className="eyebrow" style={{ color: 'var(--teal)' }}>
                  Next quest
                </span>
                <strong>
                  {categoryMeta(summary.recommendation.category).emoji} {summary.recommendation.category} · {MODE_LABELS[summary.recommendation.mode]}
                </strong>
                <span className="muted">{summary.recommendation.reason}</span>
              </div>
              <Button
                variant="teal"
                size="lg"
                loading={starting === 'rec'}
                onClick={() => go('rec', summary.recommendation.mode, { category: summary.recommendation.category, count: summary.recommendation.count, personaId: summary.recommendation.mode === 'versus' ? 'adaptive-rival' : undefined })}
              >
                Start
              </Button>
            </Card>
          ) : null}
        </>
      )}

      <ErrorNote error={err} />
      <div className="row">
        {opp ? (
          <Button variant="primary" size="lg" onClick={rematch} loading={starting === 'rematch'}>
            Rematch {opp.name}
          </Button>
        ) : null}
        <ButtonLink to="/play" size="lg">
          Home
        </ButtonLink>
        <ButtonLink to="/play/review" variant="ghost">
          Review Deck
        </ButtonLink>
      </div>

      <section className="stack-lg">
        <h2>Question by question</h2>
        {session.history.map((h) => {
          const mine = (h.attempts || []).filter((a) => a.actorId === studentId);
          const right = mine.some((a) => a.result === 'correct');
          return (
            <details key={h.index} className="card card-tight">
              <summary style={{ cursor: 'pointer', display: 'flex', gap: 12, alignItems: 'center', minHeight: 44, flexWrap: 'wrap' }}>
                <span aria-hidden>{right ? '✅' : h.winnerSide ? '💡' : '➖'}</span>
                <strong>{h.canonicalAnswer}</strong>
                <Chip tone="gray">
                  {categoryMeta(h.category).emoji} {h.category}
                </Chip>
                {h.powered && right ? <Chip tone="sun">⚡ Power</Chip> : null}
                <span className="sr-only">{right ? 'You got it' : 'Missed'}</span>
              </summary>
              <HistoryClues sessionId={sessionId} h={h} session={session} studentId={studentId} />
            </details>
          );
        })}
      </section>
    </div>
  );
}

function HistoryClues({ h, session, studentId }) {
  const mine = (h.attempts || []).filter((a) => a.actorId === studentId);
  return (
    <div className="stack" style={{ marginTop: 12, gap: 12 }}>
      {!mine.length ? <p className="muted">You didn't buzz on this one. Here's where the clues gave it away.</p> : null}
      {h.explanation ? (
        <p>
          <strong>Why: </strong>
          {h.explanation}
        </p>
      ) : null}
      {h.allClues ? (
        <ClueReview
          outcome={{ allClues: h.allClues, powerClueIndex: h.powerClueIndex, computerPlan: h.computerPlan }}
          attempts={h.attempts}
          sides={session.sides}
          opponentName={session.opponent?.name}
          myActorId={studentId}
        />
      ) : null}
      {h.bonus ? (
        <p className="muted">
          Bonus: {h.bonus.correctParts} of {h.bonus.parts} (+{h.bonus.points})
        </p>
      ) : null}
    </div>
  );
}

function Rewards({ summary }) {
  const worlds = (summary.unlockedWorlds || []).map((id) => WORLDS.find((w) => w.id === id)).filter(Boolean);
  const badges = (summary.newBadges || []).map(badgeById).filter(Boolean);
  return (
    <Card tone="purple" className="stack-lg">
      <div className="row-between">
        <div className="stack" style={{ gap: 4 }}>
          <span className="eyebrow">Rewards</span>
          <span className="stat-value" style={{ color: 'var(--purple-strong)' }}>
            +{summary.xpEarned} XP
          </span>
        </div>
        {summary.leveledUp ? <Chip tone="sun">⬆️ Level {summary.leveledUp}!</Chip> : null}
      </div>
      <ul className="row" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {(summary.xpBreakdown || []).map((b) => (
          <li key={b.label}>
            <Chip tone="gray">
              {b.label} +{b.amount}
            </Chip>
          </li>
        ))}
      </ul>
      {worlds.map((w) => (
        <Card key={w.id} tone="sun" tight>
          <strong>
            {w.emoji} New world unlocked: {w.name}!
          </strong>
        </Card>
      ))}
      {badges.length ? (
        <div className="row">
          {badges.map((b) => (
            <Chip key={b.id} tone="teal">
              {b.emoji} New badge: {b.name}
            </Chip>
          ))}
        </div>
      ) : null}
      {summary.newCards?.length ? (
        <p>
          🃏 New knowledge {summary.newCards.length === 1 ? 'card' : 'cards'}: <strong>{summary.newCards.join(', ')}</strong>
        </p>
      ) : null}
      {summary.newBests?.length ? <p>🏅 New personal best: {summary.newBests.join(', ')}</p> : null}
      {summary.teamQuestContribution ? <p>🤝 You added {summary.teamQuestContribution} to your team quest.</p> : null}
    </Card>
  );
}

