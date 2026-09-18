// Quiz Hall (/play/hall): the student's private trophy room. Featured QuizBot, badge,
// showcase items, world trophies, badges, knowledge cards, school pride, and
// (when the teacher allows it) classmates' halls.
// Reads: students/{id} (live via useAuth), schoolThemes/{schoolId}, classrooms/{cid},
//   teams/{teamId}, teamboards/{cid}_{week} (team rank, when allowed), hallCards where classroomId == cid (peer view on).
// Writes: students/{id} { hall } (keys: visibility, featuredBadge, featuredItems ≤6, hidden, showStreak, showTeamRank, featuredPreset, layout).
import { useMemo, useState } from 'react';
import { collection, doc, query, updateDoc, where } from 'firebase/firestore';
import { db } from '../../firebase.js';
import { useSchoolTheme } from '../../hooks/useSchoolTheme.js';
import { useDoc, useQuery } from '../../hooks/useFirestore.js';
import { BADGES, WORLDS, badgeById, categoryMeta, levelProgress } from '../../lib/catalog.js';
import { ITEMS, botEvolution, currentLoadout, owns, rewards } from '../../lib/rewards.js';
import { fmtDate, weekKey } from '../../lib/format.js';
import { Crest, ItemArt, QuizBot, itemDisplayName } from '../../components/bot/index.js';
import { ARENAS } from '../../lib/rewards.js';

/** Round badge cut from the world's arena art; locked worlds are greyed with a padlock. */
function WorldBadge({ world, locked, name }) {
  const src = ARENAS[world]?.image;
  return (
    <span
      role="img"
      aria-label={locked ? `${name}, locked` : name}
      style={{
        position: 'relative',
        display: 'inline-block',
        width: 96,
        height: 96,
        borderRadius: '50%',
        overflow: 'hidden',
        border: '3px solid var(--line-strong)',
        boxShadow: 'var(--shadow-sm)',
        background: 'var(--bg-deep)'
      }}
    >
      {src ? (
        <img src={src} alt="" loading="lazy" width="96" height="96" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: '50% 30%', filter: locked ? 'grayscale(1) brightness(0.7)' : 'none' }} />
      ) : null}
      {locked ? (
        <span aria-hidden style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 28 }}>
          🔒
        </span>
      ) : null}
    </span>
  );
}
import { Button, EmptyState, ErrorNote, ButtonLink, Loading, Modal, Segmented, friendlyError, useToast } from '../../components/ui.jsx';
import { Stars, StudentGate, Switch, useMyClassroom, worldProgress } from '../../components/student/common.jsx';
import { CheckIcon, RarityChip, SLOT_LABEL, lessMotion, mascotOne, rarityColor } from '../../components/collection/parts.jsx';
import { BotStage } from '../../components/collection/widgets.jsx';
import './student.css';

const RARITY_RANK = Object.fromEntries(rewards.rarities.map((r, i) => [r.id, i]));

export default function QuizHall() {
  return <StudentGate>{(student) => <HallBody student={student} />}</StudentGate>;
}

function useTeamRank(student, cls) {
  const mode = cls.data?.settings?.leaderboard || 'class';
  const allowed = !cls.loading && cls.data && (mode === 'class' || mode === 'teams');
  const board = useDoc(allowed && student.teamId ? `teamboards/${student.classroomId}_${weekKey()}` : null);
  const teams = [...(board.data?.teams || [])].sort((a, b) => (b.xp || 0) - (a.xp || 0));
  const i = teams.findIndex((t) => t.teamId === student.teamId);
  return i >= 0 ? { rank: i + 1, of: teams.length } : null;
}

function HallBody({ student }) {
  const { theme, schoolName } = useSchoolTheme();
  const cls = useMyClassroom();
  const team = useDoc(student.teamId ? `teams/${student.teamId}` : null);
  const teamRank = useTeamRank(student, cls);
  const quiet = lessMotion(student);
  const [editing, setEditing] = useState(false);
  const [peer, setPeer] = useState(null);

  const hall = student.hall || {};
  const hidden = new Set(hall.hidden || []);
  const presets = student.presets || {};
  const loadout = hall.featuredPreset && presets[hall.featuredPreset] ? presets[hall.featuredPreset] : currentLoadout(student);
  const lp = levelProgress(student.xp || 0);
  const level = student.level || lp.level;
  const evo = botEvolution(level);
  const badge = hall.featuredBadge && (student.badges || []).includes(hall.featuredBadge) ? badgeById(hall.featuredBadge) : null;
  const featured = (hall.featuredItems || []).filter((id) => ITEMS[id] && owns(student, id) && !hidden.has(id)).slice(0, 6);
  const classRewards = cls.data?.settings?.rewards || rewards.defaultClassRewards;
  const showStreak = hall.showStreak !== false && classRewards.showStreaks !== false;
  const streak = student.streak?.current || 0;
  const peerView = !!classRewards.hallPeerView;

  return (
    <div className="page qc-page stack-xl">
      <header className="qc-head">
        <div className="stack" style={{ gap: 6 }}>
          <span className="eyebrow">Quiz Hall</span>
          <h1>My Quiz Hall</h1>
          <p className="muted">
            {hall.visibility === 'class' && peerView ? 'Your classmates can visit a sharing card of your Hall.' : 'Only you can see your Hall right now.'}
          </p>
        </div>
        <div className="qc-head-meta">
          <span className={`chip ${hall.visibility === 'class' && peerView ? 'chip-teal' : 'chip-gray'}`}>
            <span aria-hidden>{hall.visibility === 'class' && peerView ? '👀' : '🔒'}</span>
            {hall.visibility === 'class' && peerView ? 'Shared with class' : 'Private'}
          </span>
          <Button variant="primary" onClick={() => setEditing(true)}>
            Edit my Hall
          </Button>
        </div>
      </header>

      <section className="qc-hall" aria-label="Trophy room">
        <div className="qc-hall-grid">
          <div className="qc-cabinet">
            <h2>Showcase</h2>
            <ul className="qc-shelf">
              {Array.from({ length: 6 }, (_, i) => {
                const id = featured[i];
                const item = id ? ITEMS[id] : null;
                return item ? (
                  <li key={id} className="qc-shelf-slot" style={{ '--rar': rarityColor(item.rarity) }}>
                    <ItemArt itemId={id} theme={theme} size={60} />
                    <span>{itemDisplayName(item, theme)}</span>
                  </li>
                ) : (
                  <li key={`e${i}`} className="qc-shelf-slot qc-shelf-empty">
                    <span aria-hidden style={{ fontSize: '1.25rem' }}>
                      ＋
                    </span>
                    <span>Empty spot</span>
                  </li>
                );
              })}
            </ul>
            {!featured.length ? (
              <Button size="sm" onClick={() => setEditing(true)}>
                Pick items to show off
              </Button>
            ) : null}
          </div>

          <div className="qc-hall-center">
            <div className="qc-banner">
              <span style={{ fontSize: '0.75rem', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.9 }}>{evo.title}</span>
              <strong>{student.displayName}</strong>
            </div>
            <BotStage loadout={loadout} theme={theme} size={230} reducedMotion={quiet} tint="var(--sun)" title={`${student.displayName}'s QuizBot`} />
            <div className="row" style={{ justifyContent: 'center', gap: 8 }}>
              <span className="chip tabular">Level {level}</span>
              <span className="chip chip-sun">{student.title || lp.title}</span>
              {hall.featuredPreset && presets[hall.featuredPreset] ? <span className="chip chip-gray">Look: {hall.featuredPreset}</span> : null}
            </div>
          </div>

          <div className="qc-cabinet">
            <h2>Highlights</h2>
            {badge ? (
              <span className="qc-medal">
                <span className="qc-medal-emoji" aria-hidden>
                  {badge.emoji}
                </span>
                <span className="stack" style={{ gap: 0 }}>
                  <span>{badge.name}</span>
                  <span className="caption">Featured badge</span>
                </span>
              </span>
            ) : (
              <p className="caption">No featured badge yet. Pick one of your badges in Edit my Hall.</p>
            )}
            {showStreak ? (
              <div className="qc-hq-stat">
                <span className="caption">Day streak</span>
                <strong className="tabular">
                  <span aria-hidden>🔥 </span>
                  {streak} {streak === 1 ? 'day' : 'days'}
                </strong>
              </div>
            ) : null}
            {hall.showTeamRank !== false && team.data ? (
              <div className="qc-hq-stat">
                <span className="caption">My team</span>
                <strong>
                  <span aria-hidden>{team.data.emoji || '🚩'} </span>
                  {team.data.name}
                </strong>
                {teamRank ? <span className="caption tabular">Rank {teamRank.rank} of {teamRank.of} this week</span> : null}
              </div>
            ) : null}
            <div className="qc-school" style={{ '--school-1': theme.primaryColor }}>
              <Crest theme={theme} size={48} />
              <span className="stack" style={{ gap: 0 }}>
                <strong>{schoolName || theme.displayName}</strong>
                <span style={{ fontSize: '0.8125rem', opacity: 0.9 }}>Proud {mascotOne(theme)}</span>
              </span>
            </div>
          </div>
        </div>
      </section>

      <WorldTrophies student={student} />
      <BadgeCase student={student} />
      <CardAlbum student={student} />
      <GearCollection student={student} theme={theme} hidden={hidden} />
      <Classmates student={student} peerView={peerView} onOpen={setPeer} theme={theme} />

      {editing ? <HallEditor student={student} theme={theme} peerView={peerView} onClose={() => setEditing(false)} /> : null}
      <Modal open={!!peer} onClose={() => setPeer(null)} title={peer ? `${peer.displayName}'s Hall` : ''}>
        {peer ? <PeerCard card={peer} theme={theme} /> : null}
      </Modal>
    </div>
  );
}

function WorldTrophies({ student }) {
  const mastered = new Set(student.masteredWorlds || []);
  const bosses = new Set(student.bossesDefeated || []);
  return (
    <section className="stack" aria-labelledby="trophies-h">
      <div className="qq-section-title">
        <h2 id="trophies-h">World trophies</h2>
        <span className="chip chip-sun tabular">
          <span aria-hidden>★</span> {student.totalStars || 0} stars
        </span>
      </div>
      <ul className="qc-trophies">
        {WORLDS.map((w) => {
          const p = worldProgress(w, student);
          return (
            <li key={w.id} className={`qc-trophy ${p.unlocked ? '' : 'qc-trophy-locked'}`}>
              <WorldBadge world={w.id} locked={!p.unlocked} name={w.name} />
              <span className="qc-trophy-name">{w.name}</span>
              {p.unlocked ? <Stars count={p.stars} /> : <span className="caption">Locked</span>}
              <span className="qc-trophy-marks">
                {bosses.has(w.id) ? <span className="chip chip-coral">🎖️ Champion</span> : null}
                {mastered.has(w.id) ? <span className="chip chip-sun">👑 Mastered</span> : null}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function BadgeCase({ student }) {
  const earned = new Set(student.badges || []);
  const [all, setAll] = useState(false);
  const sorted = [...BADGES].sort((a, b) => Number(earned.has(b.id)) - Number(earned.has(a.id)));
  const earnedCount = BADGES.filter((b) => earned.has(b.id)).length;
  // Earned badges plus a few goals; the rest behind "Show all" so the Hall stays a trophy room.
  const list = all ? sorted : sorted.slice(0, Math.max(earnedCount + 3, 5));
  return (
    <section className="stack" aria-labelledby="badges-h">
      <div className="qq-section-title">
        <h2 id="badges-h">Badges</h2>
        <span className="chip tabular">
          {BADGES.filter((b) => earned.has(b.id)).length} of {BADGES.length} earned
        </span>
      </div>
      <ul className="qq-badges" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {list.map((b) => {
          const has = earned.has(b.id);
          return (
            <li key={b.id} className={`qq-badge ${has ? '' : 'qq-badge-locked'}`}>
              <span className="qq-badge-emoji" aria-hidden>
                {b.emoji}
              </span>
              <strong>{b.name}</strong>
              <span className="caption" style={has ? { color: 'var(--ink-2)' } : undefined}>
                {has ? b.description : `Goal: ${b.description}`}
              </span>
              {has ? (
                <span className="chip chip-green">
                  <span aria-hidden>✓</span> Earned
                </span>
              ) : (
                <span className="chip chip-gray">
                  <span aria-hidden>🔒</span> Locked
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {list.length < sorted.length || all ? (
        <Button size="sm" onClick={() => setAll(!all)} aria-expanded={all} style={{ alignSelf: 'flex-start' }}>
          {all ? 'Show fewer badges' : `Show all ${BADGES.length} badges`}
        </Button>
      ) : null}
    </section>
  );
}

function CardAlbum({ student }) {
  const cards = Object.entries(student.cards || {}).sort((a, b) => (b[1].firstAt || 0) - (a[1].firstAt || 0));
  return (
    <section className="stack" aria-labelledby="cards-h">
      <div className="qq-section-title">
        <h2 id="cards-h">Knowledge card album</h2>
        <span className="chip tabular">{cards.length} collected</span>
      </div>
      {cards.length ? (
        <ul className="qq-cards" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {cards.map(([topic, c]) => {
            const m = categoryMeta(c.category);
            return (
              <li key={topic} className="qq-kcard" style={{ '--cat': m.color }}>
                <span className="qq-kcard-count" aria-label={`Collected ${c.count} times`}>
                  x{c.count}
                </span>
                <span className="qq-kcard-emoji" aria-hidden>
                  {m.emoji}
                </span>
                <div className="stack" style={{ gap: 4 }}>
                  <span className="qq-kcard-topic">{topic}</span>
                  <span className="caption">
                    {c.category} · {fmtDate(c.firstAt)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState emoji="🃏" title="No cards yet" action={<ButtonLink to="/play" variant="primary" size="lg">Start a quest</ButtonLink>}>
          Answer a question right to collect a card for its topic.
        </EmptyState>
      )}
    </section>
  );
}

function GearCollection({ student, theme, hidden }) {
  const owned = rewards.cosmetics
    .filter((c) => owns(student, c.id) && !hidden.has(c.id))
    .sort((a, b) => RARITY_RANK[b.rarity] - RARITY_RANK[a.rarity] || a.name.localeCompare(b.name));
  const total = rewards.cosmetics.filter((c) => owns(student, c.id)).length;
  return (
    <section className="stack" aria-labelledby="gear-h">
      <div className="qq-section-title">
        <h2 id="gear-h">Gear collection</h2>
        <span className="chip tabular">
          {total} of {rewards.cosmetics.length} items
        </span>
      </div>
      <ul className="qc-pick-grid">
        {owned.map((c) => (
          <li key={c.id} className="qc-shelf-slot" style={{ '--rar': rarityColor(c.rarity) }}>
            <ItemArt itemId={c.id} theme={theme} size={52} />
            <span>{itemDisplayName(c, theme)}</span>
            <RarityChip rarity={c.rarity} small />
          </li>
        ))}
      </ul>
      {hidden.size ? <p className="caption">{hidden.size} hidden from your Hall.</p> : null}
    </section>
  );
}

function Classmates({ student, peerView, onOpen, theme }) {
  const cards = useQuery(
    () => (peerView ? query(collection(db, 'hallCards'), where('classroomId', '==', student.classroomId)) : null),
    [peerView, student.classroomId]
  );
  if (!peerView) return null;
  const list = cards.data.filter((c) => c.id !== student.id).sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
  return (
    <section className="stack" aria-labelledby="peers-h">
      <div className="qq-section-title">
        <h2 id="peers-h">Classmates' Halls</h2>
        <span className="caption">Only classmates who chose to share appear here.</span>
      </div>
      {cards.loading ? (
        <Loading />
      ) : cards.error ? (
        <ErrorNote error={cards.error} />
      ) : list.length === 0 ? (
        <p className="muted">No classmates are sharing their Hall yet.</p>
      ) : (
        <ul className="qc-peers">
          {list.map((c) => (
            <li key={c.id}>
              <button type="button" className="qc-peer" onClick={() => onOpen(c)}>
                {c.loadout ? <QuizBot loadout={c.loadout} theme={theme} size={80} pose="static" title={`${c.displayName}'s QuizBot`} /> : <span style={{ fontSize: '2.5rem' }} aria-hidden>🏛️</span>}
                <strong>{c.displayName}</strong>
                {c.level ? <span className="caption tabular">Level {c.level}</span> : null}
                <span className="caption" style={{ color: 'var(--purple-strong)', fontWeight: 800 }}>
                  Visit Hall
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Only the fields the server put on the card (teacher-approved). No free text. */
function PeerCard({ card, theme }) {
  const b = card.featuredBadge ? badgeById(card.featuredBadge) : null;
  return (
    <div className="stack-lg">
      {card.loadout ? <BotStage loadout={card.loadout} theme={theme} size={180} title={`${card.displayName}'s QuizBot`} /> : null}
      <div className="row" style={{ justifyContent: 'center', gap: 8 }}>
        {card.level ? <span className="chip tabular">Level {card.level}</span> : null}
        {card.title ? <span className="chip chip-sun">{card.title}</span> : null}
        {card.level ? <span className="chip chip-teal">{botEvolution(card.level).title}</span> : null}
      </div>
      {b ? (
        <span className="qc-medal" style={{ alignSelf: 'center' }}>
          <span className="qc-medal-emoji" aria-hidden>
            {b.emoji}
          </span>
          {b.name}
        </span>
      ) : null}
      {card.featuredItems?.length ? (
        <ul className="qc-shelf">
          {card.featuredItems.map((id) =>
            ITEMS[id] ? (
              <li key={id} className="qc-shelf-slot" style={{ '--rar': rarityColor(ITEMS[id].rarity) }}>
                <ItemArt itemId={id} theme={theme} size={52} />
                <span>{itemDisplayName(ITEMS[id], theme)}</span>
              </li>
            ) : null
          )}
        </ul>
      ) : null}
      {card.worldsMastered?.length ? (
        <p style={{ textAlign: 'center', fontWeight: 800 }}>
          👑 Mastered {card.worldsMastered.length} {card.worldsMastered.length === 1 ? 'world' : 'worlds'}
        </p>
      ) : null}
    </div>
  );
}

function HallEditor({ student, theme, peerView, onClose }) {
  const toast = useToast();
  const hall = student.hall || {};
  const [draft, setDraft] = useState(() => ({
    visibility: hall.visibility === 'class' ? 'class' : 'private',
    featuredBadge: hall.featuredBadge ?? null,
    featuredItems: (hall.featuredItems || []).filter((id) => owns(student, id)).slice(0, 6),
    hidden: hall.hidden || [],
    showStreak: hall.showStreak !== false,
    showTeamRank: hall.showTeamRank !== false,
    featuredPreset: hall.featuredPreset ?? null,
    layout: hall.layout ?? null
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const earned = BADGES.filter((b) => (student.badges || []).includes(b.id));
  const owned = useMemo(
    () => rewards.cosmetics.filter((c) => owns(student, c.id)).sort((a, b) => RARITY_RANK[b.rarity] - RARITY_RANK[a.rarity] || a.name.localeCompare(b.name)),
    [student]
  );
  const presetNames = Object.keys(student.presets || {}).sort();
  const hiddenSet = new Set(draft.hidden);

  const toggleFeature = (id) => {
    const has = draft.featuredItems.includes(id);
    if (has) set({ featuredItems: draft.featuredItems.filter((x) => x !== id) });
    else if (draft.featuredItems.length < 6) set({ featuredItems: [...draft.featuredItems, id], hidden: draft.hidden.filter((x) => x !== id) });
  };
  const toggleHide = (id) => {
    if (hiddenSet.has(id)) set({ hidden: draft.hidden.filter((x) => x !== id) });
    else set({ hidden: [...draft.hidden, id].slice(0, 80), featuredItems: draft.featuredItems.filter((x) => x !== id) });
  };
  const reset = () => set({ featuredBadge: null, featuredItems: [], featuredPreset: null });

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await updateDoc(doc(db, 'students', student.id), { hall: draft });
      toast('Quiz Hall saved', { emoji: '🏛️' });
      onClose();
    } catch (e) {
      setError(friendlyError(e));
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title="Edit my Hall"
      footer={
        <>
          <Button variant="ghost" onClick={reset} disabled={saving}>
            Reset layout
          </Button>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} loading={saving}>
            Save
          </Button>
        </>
      }
    >
      <div className="stack-lg">
        <section className="stack" style={{ gap: 10 }} aria-labelledby="ed-vis">
          <h3 id="ed-vis">Who can see it</h3>
          <Segmented
            label="Who can see my Hall"
            value={draft.visibility}
            onChange={(v) => set({ visibility: v })}
            options={[
              { value: 'private', label: '🔒 Just me' },
              { value: 'class', label: '👀 My class' }
            ]}
          />
          <p className="caption prose">
            Classmates only see your Hall if your teacher turned on Hall sharing, and only the parts your teacher allows (like your QuizBot and level).
            {peerView ? ' Hall sharing is on for your class.' : ' Hall sharing is off for your class right now, so your Hall stays private.'}
          </p>
        </section>

        {presetNames.length ? (
          <section className="stack" style={{ gap: 10 }} aria-labelledby="ed-look">
            <h3 id="ed-look">QuizBot on display</h3>
            <Segmented
              label="QuizBot on display"
              value={draft.featuredPreset}
              onChange={(v) => set({ featuredPreset: v })}
              options={[{ value: null, label: 'My current look' }, ...presetNames.map((n) => ({ value: n, label: n }))]}
            />
          </section>
        ) : null}

        <section className="stack" style={{ gap: 10 }} aria-labelledby="ed-badge">
          <h3 id="ed-badge">Featured badge</h3>
          {earned.length ? (
            <ul className="qc-pick-grid">
              <li>
                <button type="button" className="qc-pick" aria-pressed={!draft.featuredBadge} onClick={() => set({ featuredBadge: null })}>
                  <span style={{ fontSize: '1.75rem' }} aria-hidden>
                    ▫️
                  </span>
                  None
                </button>
              </li>
              {earned.map((b) => (
                <li key={b.id}>
                  <button type="button" className="qc-pick" aria-pressed={draft.featuredBadge === b.id} onClick={() => set({ featuredBadge: b.id })}>
                    {draft.featuredBadge === b.id ? (
                      <span className="qc-pick-check">
                        <CheckIcon size={12} />
                      </span>
                    ) : null}
                    <span style={{ fontSize: '1.75rem' }} aria-hidden>
                      {b.emoji}
                    </span>
                    {b.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Earn a badge to feature it here.</p>
          )}
        </section>

        <section className="stack" style={{ gap: 10 }} aria-labelledby="ed-items">
          <div className="row-between">
            <h3 id="ed-items">Showcase items</h3>
            <span className="chip tabular">{draft.featuredItems.length} of 6 picked</span>
          </div>
          <p className="caption">Pick up to 6 items for your shelf. Hide items you don't want in your Hall.</p>
          <ul className="qc-pick-grid">
            {owned.map((c) => {
              const on = draft.featuredItems.includes(c.id);
              const hid = hiddenSet.has(c.id);
              const name = itemDisplayName(c, theme);
              return (
                <li key={c.id} className="stack" style={{ gap: 6 }}>
                  <button
                    type="button"
                    className="qc-pick"
                    aria-pressed={on}
                    disabled={!on && (draft.featuredItems.length >= 6 || hid)}
                    onClick={() => toggleFeature(c.id)}
                    style={{ opacity: hid ? 0.5 : 1 }}
                  >
                    {on ? (
                      <span className="qc-pick-check">
                        <CheckIcon size={12} />
                      </span>
                    ) : null}
                    <ItemArt itemId={c.id} theme={theme} size={48} />
                    {name}
                    <span className="caption">{SLOT_LABEL[c.slot]}</span>
                  </button>
                  <button type="button" className="btn btn-ghost qc-hide-toggle" aria-pressed={hid} onClick={() => toggleHide(c.id)} aria-label={`${hid ? 'Show' : 'Hide'} ${name} in my Hall`}>
                    {hid ? 'Hidden: show' : 'Hide'}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="stack" style={{ gap: 4 }} aria-label="Extras">
          <Switch id="hall-streak" label="Show my day streak" checked={draft.showStreak} onChange={(v) => set({ showStreak: v })} />
          <Switch id="hall-team" label="Show my team rank" checked={draft.showTeamRank} onChange={(v) => set({ showTeamRank: v })} />
        </section>
        <p className="caption">Reset layout clears your featured badge, items, and look. You keep every item.</p>
        <ErrorNote>{error}</ErrorNote>
      </div>
    </Modal>
  );
}

