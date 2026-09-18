// Teacher views of the v2 reward system: award school gear, a student's QuizBot + adventure stats,
// and the student's recent reward activity.
// Firestore reads: schoolThemes/{schoolId} (useSchoolTheme), students/{id}/events orderBy at desc limit 15
// Firestore writes: awardRequests/{auto} via request(): { uid, studentId, itemId, note, status: 'pending', createdAt }
import { useState } from 'react';
import { collection, limit, orderBy, query } from 'firebase/firestore';
import { db } from '../../firebase.js';
import { useQuery } from '../../hooks/useFirestore.js';
import { useSchoolTheme } from '../../hooks/useSchoolTheme.js';
import { ITEMS, RARITY, botEvolution, rewards, worldName } from '../../lib/rewards.js';
import { fmtNum, timeAgo } from '../../lib/format.js';
import { request } from '../../lib/requests.js';
import { ItemArt, QuizBot, itemDisplayName } from '../bot/index.js';
import { Avatar, Button, Card, Chip, EmptyState, ErrorNote, Field, Loading, Modal, friendlyError, useToast } from '../ui.jsx';

/** School gear a teacher may award, filtered by the school's approved catalog. */
export function awardableItems(rewardCatalog) {
  return rewards.cosmetics.filter(
    (c) => c.school && c.unlock?.type === 'teacher_award' && (!rewardCatalog?.approved || rewardCatalog.approved.includes(c.id))
  );
}

/**
 * Award school gear to one or more students. students: [{ id, displayName, avatar, inventory }].
 * With several students, the teacher picks who gets it inside the modal.
 */
export function AwardModal({ open, students, onClose }) {
  const toast = useToast();
  const { theme, rewardCatalog, loading } = useSchoolTheme();
  const items = awardableItems(rewardCatalog);
  const bulk = students.length > 1;
  const [itemId, setItemId] = useState('');
  const [note, setNote] = useState('');
  const [picked, setPicked] = useState(() => new Set(bulk ? [] : students.map((s) => s.id)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [results, setResults] = useState(null);

  const chosen = itemId || items[0]?.id || '';
  const hasIt = (s) => !!s.inventory?.[chosen];
  const eligible = students.filter((s) => !hasIt(s));
  // In bulk mode, skip anyone who already owns the chosen item.
  const targets = bulk ? eligible.filter((s) => picked.has(s.id)) : students;

  const close = () => {
    setResults(null);
    setError(null);
    setNote('');
    onClose();
  };

  const submit = async (e) => {
    e?.preventDefault();
    if (!chosen) return setError('Pick an item to award.');
    if (!targets.length) return setError('Pick at least one student.');
    setBusy(true);
    setError(null);
    const out = [];
    for (const s of targets) {
      try {
        await request('awardRequests', { studentId: s.id, itemId: chosen, note: note.trim().slice(0, 120) });
        out.push({ s, ok: true });
      } catch (err) {
        out.push({ s, ok: false, message: friendlyError(err) });
      }
    }
    setBusy(false);
    const okCount = out.filter((r) => r.ok).length;
    if (!bulk && out[0]?.ok) {
      toast(`${itemDisplayName(chosen, theme)} awarded to ${targets[0].displayName}`, { emoji: '🎁' });
      return close();
    }
    if (!bulk) return setError(out[0].message);
    if (okCount) toast(`Awarded to ${okCount} ${okCount === 1 ? 'student' : 'students'}`, { emoji: '🎁' });
    setResults(out);
  };

  if (!open) return null;
  const name = chosen ? itemDisplayName(chosen, theme) : '';

  return (
    <Modal
      open
      onClose={close}
      title="Award school gear"
      footer={
        results ? (
          <Button variant="primary" onClick={close}>
            Done
          </Button>
        ) : (
          <>
            <Button onClick={close}>Cancel</Button>
            <Button variant="primary" onClick={submit} loading={busy} disabled={!items.length}>
              {bulk ? `Award to ${targets.length} ${targets.length === 1 ? 'student' : 'students'}` : 'Award gear'}
            </Button>
          </>
        )
      }
    >
      {loading ? (
        <Loading />
      ) : !items.length ? (
        <EmptyState emoji="🛡️" title="No school gear to award">
          Your school admin can approve award gear under School.
        </EmptyState>
      ) : results ? (
        <ul className="t-list" aria-label="Award results">
          {results.map(({ s, ok, message }) => (
            <li key={s.id}>
              <Avatar emoji={s.avatar} />
              <span style={{ flex: 1, fontWeight: 700 }}>{s.displayName}</span>
              {ok ? <Chip tone="green">Awarded</Chip> : <span className="caption" style={{ color: 'var(--coral)', fontWeight: 700 }}>{message}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <form className="stack-lg" onSubmit={submit}>
          <fieldset className="t-fieldset">
            <legend className="label">Gear</legend>
            <div className="t-gear-grid" role="radiogroup" aria-label="Gear to award">
              {items.map((it) => (
                <label key={it.id} className="t-gear-item" data-on={chosen === it.id}>
                  <input type="radio" name="award-item" value={it.id} checked={chosen === it.id} onChange={() => setItemId(it.id)} />
                  <ItemArt itemId={it.id} theme={theme} size={56} title={itemDisplayName(it, theme)} />
                  <span className="stack" style={{ gap: 2, minWidth: 0 }}>
                    <strong>{itemDisplayName(it, theme)}</strong>
                    <span className="caption">{RARITY[it.rarity]?.name}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <Field label="Note to the student" hint="Optional. Up to 120 characters, like what they did to earn it.">
            {(id) => <input id={id} className="input" value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} autoComplete="off" />}
          </Field>
          {bulk ? (
            <fieldset className="t-fieldset">
              <legend className="label">Students</legend>
              <div className="row" style={{ gap: 8 }}>
                <Button size="sm" onClick={() => setPicked(new Set(eligible.map((s) => s.id)))}>
                  Select everyone without it
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>
                  Clear
                </Button>
              </div>
              <div className="t-check-grid">
                {students.map((s) => (
                  <label key={s.id} className="check">
                    <input
                      type="checkbox"
                      checked={picked.has(s.id) && !hasIt(s)}
                      disabled={hasIt(s)}
                      onChange={(e) =>
                        setPicked((p) => {
                          const n = new Set(p);
                          if (e.target.checked) n.add(s.id);
                          else n.delete(s.id);
                          return n;
                        })
                      }
                    />
                    <span aria-hidden>{s.avatar}</span>
                    {s.displayName}
                    {hasIt(s) ? <span className="caption">Has it</span> : null}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : hasIt(students[0]) ? (
            <div className="alert alert-info">{students[0].displayName} already has {name}.</div>
          ) : null}
          {error ? <ErrorNote>{error}</ErrorNote> : null}
        </form>
      )}
    </Modal>
  );
}

const count = (v) => (Array.isArray(v) ? v.length : 0);

/** QuizBot, level + evolution, and adventure progress for one student. */
export function StudentAdventureCard({ student, onAward }) {
  const { theme } = useSchoolTheme();
  const level = student.level || 1;
  const evo = botEvolution(level);
  const bosses = student.bossesDefeated || [];
  const mastered = student.masteredWorlds || [];
  const dex = Object.keys(student.dex || {}).length;
  return (
    <Card className="stack-lg" aria-labelledby="adv-title">
      <div className="row-between">
        <h2 id="adv-title">QuizBot and adventure</h2>
        {onAward ? (
          <Button onClick={onAward}>
            <span aria-hidden>🎁</span> Award school gear
          </Button>
        ) : null}
      </div>
      <div className="t-adv-layout">
        <div className="t-adv-bot">
          <QuizBot loadout={{ ...rewards.starterLoadout, ...(student.loadout || {}) }} theme={theme} size={160} title={`${student.displayName}'s QuizBot`} />
          <strong>{evo.title}</strong>
          <span className="caption">Level {level}</span>
        </div>
        <div className="stack t-adv-body">
          <div className="t-mini-stats">
            <MiniStat value={fmtNum(student.craftingStars || 0)} label="Crafting Stars" />
            <MiniStat value={fmtNum(student.questStars || 0)} label="Quest Stars" />
            <MiniStat value={fmtNum(bosses.length)} label="Bosses defeated" />
            <MiniStat value={fmtNum(mastered.length)} label="Worlds mastered" />
            <MiniStat value={fmtNum(dex)} label="QuizDex" />
            <MiniStat value={fmtNum(count(student.unlockedWorlds) || 1)} label="Worlds unlocked" />
          </div>
          {bosses.length || mastered.length ? (
            <div className="row" style={{ gap: 8 }}>
              {mastered.map((w) => (
                <Chip key={`m-${w}`} tone="sun">
                  ★ {worldName(w)} mastered
                </Chip>
              ))}
              {bosses.filter((w) => !mastered.includes(w)).map((w) => (
                <Chip key={`b-${w}`} tone="teal">
                  {worldName(w)} boss beaten
                </Chip>
              ))}
            </div>
          ) : (
            <span className="caption">No bosses beaten or worlds mastered yet.</span>
          )}
        </div>
      </div>
    </Card>
  );
}

function MiniStat({ value, label }) {
  return (
    <div className="t-mini-stat">
      <span className="t-mini-value tabular">{value}</span>
      <span className="caption">{label}</span>
    </div>
  );
}

function eventText(e, theme) {
  const item = (id) => (id && ITEMS[id] ? itemDisplayName(id, theme) : null);
  switch (e.type) {
    case 'REWARD_GRANTED': {
      const n = item(e.itemId) || 'a reward';
      if (e.source === 'teacher_award') return { emoji: '🎁', text: `Awarded ${n} by a teacher` };
      if (e.source === 'craft') return { emoji: '🛠️', text: `Crafted ${n}` };
      return { emoji: '🎉', text: `Earned ${n}` };
    }
    case 'CHEST_OPENED':
      return { emoji: '🧰', text: 'Found a treasure chest on the map' };
    case 'STAR_COLLECTED':
      return { emoji: '⭐', text: 'Collected a Quest Star' };
    case 'COSMETIC_EQUIPPED': {
      const names = (e.items || []).map(item).filter(Boolean);
      return { emoji: '🤖', text: names.length ? `Equipped ${names.join(', ')}` : 'Changed QuizBot gear' };
    }
    case 'QUIZ_HALL_UPDATED':
      return { emoji: '🏛️', text: 'Updated their Quiz Hall' };
    case 'REWARD_REVEALED':
      return { emoji: '✨', text: e.skipped ? 'Opened a reward (skipped the reveal)' : 'Opened a reward' };
    default:
      return { emoji: '•', text: 'Activity' };
  }
}

export function RewardActivityCard({ studentId }) {
  const { theme } = useSchoolTheme();
  const events = useQuery(() => query(collection(db, 'students', studentId, 'events'), orderBy('at', 'desc'), limit(15)), [studentId]);
  return (
    <Card className="stack" aria-labelledby="ra-title">
      <h2 id="ra-title">Recent reward activity</h2>
      {events.loading ? (
        <Loading label="Loading activity…" />
      ) : events.error ? (
        <ErrorNote error={events.error} />
      ) : !events.data.length ? (
        <EmptyState emoji="🎁" title="No reward activity yet">
          Chests, stars, and gear changes show up here.
        </EmptyState>
      ) : (
        <ul className="t-list">
          {events.data.map((e) => {
            const { emoji, text } = eventText(e, theme);
            const art = e.itemId && ITEMS[e.itemId];
            return (
              <li key={e.id}>
                {art ? <ItemArt itemId={e.itemId} theme={theme} size={36} /> : <span className="avatar" aria-hidden>{emoji}</span>}
                <span style={{ flex: 1, minWidth: 160 }}>{text}</span>
                <span className="caption" style={{ whiteSpace: 'nowrap' }}>
                  {timeAgo(e.at)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

