// Platform admin: preview which rewards a scenario would grant (nothing is granted), plus the
// read-only XP and grant rules from functions/shared/rewards.json.
// Writes: rulePreviews/{auto} via request(): { uid, scenario, status: 'pending', createdAt } -> result { grants }
import { useState } from 'react';
import { CHESTS, ITEMS, RARITY, rewards } from '../../lib/rewards.js';
import { WORLDS } from '../../lib/catalog.js';
import { request } from '../../lib/requests.js';
import { ChestArt, ItemArt, itemDisplayName } from '../bot/index.js';
import { Button, Card, Chip, EmptyState, ErrorNote, Field } from '../ui.jsx';

const XP_LABELS = {
  attempt: 'Each answer attempt',
  correct: 'Correct answer',
  earlyMax: 'Early buzz bonus cap',
  powerBonus: 'Power bonus',
  earlyBonus: 'Early buzz bonus',
  bonusPart: 'Bonus part correct',
  sessionComplete: 'Finish a quest',
  beatComputer: 'Beat the computer',
  dailyQuest: "Today's Quest",
  assignmentFirstComplete: 'First assignment completion',
  maxAttemptXpPerSession: 'Max attempt XP per session'
};

const initial = { levelFrom: 4, levelTo: 5, streakFrom: 2, streakTo: 3, masteredWorld: '', firstWin: false, randomChests: true };

function NumberInput({ label, value, onChange, min = 0, max = 100 }) {
  return (
    <Field label={label}>
      {(id) => (
        <input
          id={id}
          type="number"
          inputMode="numeric"
          className="input tabular"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        />
      )}
    </Field>
  );
}

function GrantRow({ g }) {
  const chest = g.chestId ? CHESTS[g.chestId] : null;
  const item = g.itemId ? ITEMS[g.itemId] : null;
  return (
    <li className="adm-grant">
      <div className="adm-grant-art">
        {item ? <ItemArt itemId={g.itemId} size={56} /> : chest ? <ChestArt rarity={chest.rarity} school={!!chest.schoolOnly} size={64} /> : null}
      </div>
      <div className="stack" style={{ gap: 4, flex: 1, minWidth: 0 }}>
        <strong>{item ? itemDisplayName(item) : chest ? itemDisplayName(chest) : 'Crafting Stars only'}</strong>
        <span className="caption">
          {g.type === 'chest' ? `From ${chest ? itemDisplayName(chest) : 'a chest'}` : 'Direct unlock'}
          {g.craftingStars ? ` · ${g.craftingStars} Crafting Stars (everything in the pool is owned)` : ''}
        </span>
        <span className="adm-mono">{g.id}</span>
      </div>
      {g.rarity ? (
        <Chip style={{ background: `color-mix(in srgb, ${RARITY[g.rarity]?.color || '#888'} 18%, transparent)`, color: 'var(--ink)' }}>{RARITY[g.rarity]?.name || g.rarity}</Chip>
      ) : null}
    </li>
  );
}

export default function RewardRules() {
  const [sc, setSc] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [grants, setGrants] = useState(null);
  const set = (k) => (v) => setSc((s) => ({ ...s, [k]: v }));

  const preview = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const scenario = {
        levelFrom: Number(sc.levelFrom) || 1,
        levelTo: Math.max(Number(sc.levelTo) || 1, Number(sc.levelFrom) || 1),
        streakFrom: Number(sc.streakFrom) || 0,
        streakTo: Number(sc.streakTo) || 0,
        masteredWorld: sc.masteredWorld || null,
        firstWin: sc.firstWin,
        randomChests: sc.randomChests
      };
      const res = await request('rulePreviews', { scenario });
      setGrants(res.grants || []);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="stack-lg" aria-labelledby="rules-title">
      <div className="stack" style={{ gap: 6 }}>
        <h2 id="rules-title">Reward rules</h2>
        <p className="muted prose">Preview what one match would grant a new student in a scenario. Nothing is granted.</p>
      </div>

      <form className="stack-lg" onSubmit={preview}>
        <div className="adm-filters">
          <NumberInput label="Level before" value={sc.levelFrom} onChange={set('levelFrom')} min={1} />
          <NumberInput label="Level after" value={sc.levelTo} onChange={set('levelTo')} min={1} />
          <NumberInput label="Streak before (days)" value={sc.streakFrom} onChange={set('streakFrom')} />
          <NumberInput label="Streak after (days)" value={sc.streakTo} onChange={set('streakTo')} />
          <Field label="World mastered">
            {(id) => (
              <select id={id} className="select" value={sc.masteredWorld} onChange={(e) => set('masteredWorld')(e.target.value)}>
                <option value="">None</option>
                {WORLDS.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.emoji} {w.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        <div className="row" style={{ gap: 24 }}>
          <label className="check">
            <input type="checkbox" checked={sc.firstWin} onChange={(e) => set('firstWin')(e.target.checked)} />
            First win against the computer
          </label>
          <label className="check">
            <input type="checkbox" checked={sc.randomChests} onChange={(e) => set('randomChests')(e.target.checked)} />
            Random chests (off = best unowned item)
          </label>
        </div>
        <div>
          <Button type="submit" variant="primary" loading={busy}>
            Preview grants
          </Button>
        </div>
      </form>

      <ErrorNote error={error} />
      {grants ? (
        grants.length ? (
          <section className="stack" aria-labelledby="grants-title" aria-live="polite">
            <h3 id="grants-title">
              {grants.length} {grants.length === 1 ? 'grant' : 'grants'} in this scenario
            </h3>
            <ul className="adm-grants">
              {grants.map((g) => (
                <GrantRow key={g.id} g={g} />
              ))}
            </ul>
          </section>
        ) : (
          <div aria-live="polite">
            <EmptyState emoji="🧰" title="No grants in this scenario">
              Try crossing a level that's a multiple of 5, a 3 or 7 day streak, or a mastered world.
            </EmptyState>
          </div>
        )
      ) : null}

      <hr className="divider" />

      <div className="grid-2" style={{ alignItems: 'start' }}>
        <section className="stack" aria-labelledby="xp-title">
          <h3 id="xp-title">XP rules</h3>
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {Object.entries(rewards.xpRules).map(([k, v]) => (
                  <tr key={k}>
                    <th scope="row" style={{ textTransform: 'none', letterSpacing: 0, fontSize: '0.9375rem', color: 'var(--ink)', background: 'none' }}>
                      {XP_LABELS[k] || k}
                    </th>
                    <td className="num">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="stack" aria-labelledby="gr-title">
          <h3 id="gr-title">Grant rules</h3>
          <ul className="adm-rule-list">
            {rewards.grantRules.map((r) => {
              const chest = CHESTS[r.chest];
              return (
                <li key={r.id}>
                  <ChestArt rarity={chest?.rarity} school={!!chest?.schoolOnly} size={40} />
                  <span style={{ flex: 1 }}>
                    <strong>{r.label}</strong>
                    <span className="caption"> gives {chest ? itemDisplayName(chest) : r.chest}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
      <p className="caption">
        These rules live in <span className="adm-mono">functions/shared/rewards.json</span>. Edit them there and they ship with the next app deploy.
      </p>
    </Card>
  );
}
