// My QuizBot garage (/play/garage): preview any item on the stage, equip owned
// items, save up to 3 presets, craft chest items with Crafting Stars.
// Reads: students/{id} (live via useAuth), schoolThemes/{schoolId} (useSchoolTheme),
//   classrooms/{cid} (celebrations setting), students/{id}/grants/{craft grant} after crafting.
// Writes: loadoutRequests (equip / savePreset / applyPreset / deletePreset), craftRequests,
//   analyticsEvents { type: 'cosmetic_preview' } (once per item per visit).
import { useEffect, useMemo, useRef, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase.js';
import { useSchoolTheme } from '../../hooks/useSchoolTheme.js';
import { ITEMS, SLOTS, rewards, botEvolution, currentLoadout, owns, unlockLabel } from '../../lib/rewards.js';
import { request } from '../../lib/requests.js';
import { ItemArt, QuizBot, itemDisplayName } from '../../components/bot/index.js';
import { Button, Card, ConfirmModal, ErrorNote, friendlyError, useToast } from '../../components/ui.jsx';
import { StudentGate, useMyClassroom } from '../../components/student/common.jsx';
import RewardReveal from '../../components/rewards/RewardReveal.jsx';
import {
  REQUIRED_SLOTS,
  SLOT_LABEL,
  StarsBalance,
  craftCost,
  isApprovedSchoolItem,
  itemState,
  lessMotion,
  logAnalytics
} from '../../components/collection/parts.jsx';
import { BotStage, EvolutionTrack, ItemTile } from '../../components/collection/widgets.jsx';

const RARITY_RANK = Object.fromEntries(rewards.rarities.map((r, i) => [r.id, i]));
const byRarity = (a, b) => RARITY_RANK[a.rarity] - RARITY_RANK[b.rarity] || a.name.localeCompare(b.name);

export default function Garage() {
  return <StudentGate>{(student) => <GarageBody student={student} />}</StudentGate>;
}

function sameLoadout(a, b) {
  return SLOTS.every((s) => (a[s.id] ?? null) === (b[s.id] ?? null));
}

function GarageBody({ student }) {
  const toast = useToast();
  const { theme, rewardCatalog } = useSchoolTheme();
  const cls = useMyClassroom();
  const calm = cls.data?.settings?.rewards?.celebrations === 'calm';
  const quiet = lessMotion(student);
  const saved = useMemo(() => currentLoadout(student), [student]);
  const [draft, setDraft] = useState(saved);
  const [slot, setSlot] = useState('paint');
  const [pose, setPose] = useState({ name: 'idle', key: 0 });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [craftItem, setCraftItem] = useState(null);
  const [crafting, setCrafting] = useState(false);
  const [reveal, setReveal] = useState(null);
  const previewed = useRef(new Set());
  const dirty = !sameLoadout(draft, saved);

  // When the saved loadout changes (equip / preset applied elsewhere) and nothing is being previewed, follow it.
  const savedKey = JSON.stringify(saved);
  const lastSaved = useRef(saved);
  useEffect(() => {
    // Follow the new saved look unless the kid was previewing something else.
    if (sameLoadout(draft, lastSaved.current)) setDraft(saved);
    lastSaved.current = saved;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  const lockedInDraft = SLOTS.map((s) => draft[s.id]).filter((id) => id && !owns(student, id));
  const level = student.level || 1;
  const evo = botEvolution(level);

  const slotItems = useMemo(() => {
    const out = {};
    for (const s of SLOTS) out[s.id] = rewards.cosmetics.filter((c) => c.slot === s.id && !c.school).sort(byRarity);
    return out;
  }, []);
  const schoolItems = useMemo(() => rewards.cosmetics.filter((c) => c.school && isApprovedSchoolItem(c, rewardCatalog)).sort(byRarity), [rewardCatalog]);

  const preview = (item) => {
    if (!previewed.current.has(item.id)) {
      previewed.current.add(item.id);
      logAnalytics('cosmetic_preview');
    }
    setError(null);
    setDraft((d) => ({ ...d, [item.slot]: d[item.slot] === item.id && !REQUIRED_SLOTS.has(item.slot) ? null : item.id }));
    if (item.slot === 'emote') setPose((p) => ({ name: 'emote', key: p.key + 1 }));
  };
  const clearSlot = (s) => setDraft((d) => ({ ...d, [s]: null }));

  const playEmote = () => setPose((p) => ({ name: 'emote', key: p.key + 1 }));
  useEffect(() => {
    if (pose.name !== 'emote') return undefined;
    const t = setTimeout(() => setPose((p) => ({ ...p, name: 'idle' })), 1600);
    return () => clearTimeout(t);
  }, [pose]);

  const equip = async () => {
    setSaving(true);
    setError(null);
    try {
      await request('loadoutRequests', { action: 'equip', loadout: draft });
      toast('Your QuizBot is ready!', { emoji: '🤖' });
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSaving(false);
    }
  };

  const craft = async () => {
    const item = craftItem;
    setCrafting(true);
    setError(null);
    try {
      const res = await request('craftRequests', { itemId: item.id });
      const snap = await getDoc(doc(db, `students/${student.id}/grants/${res.grantId || `craft-${item.id}`}`));
      setCraftItem(null);
      if (snap.exists()) setReveal([{ id: snap.id, ...snap.data() }]);
      else toast(`${itemDisplayName(item, theme)} crafted!`, { emoji: '✦' });
    } catch (e) {
      setCraftItem(null);
      setError(friendlyError(e));
    } finally {
      setCrafting(false);
    }
  };

  const tileProps = (item) => ({
    item,
    theme,
    student,
    status: itemState(item, student, saved),
    previewing: draft[item.slot] === item.id && saved[item.slot] !== item.id,
    craftingStars: student.craftingStars || 0,
    onPreview: preview,
    onCraft: setCraftItem
  });

  const onTabKey = (e) => {
    const ids = SLOTS.map((s) => s.id);
    const i = ids.indexOf(slot);
    let n = null;
    if (e.key === 'ArrowRight') n = ids[(i + 1) % ids.length];
    if (e.key === 'ArrowLeft') n = ids[(i - 1 + ids.length) % ids.length];
    if (e.key === 'Home') n = ids[0];
    if (e.key === 'End') n = ids[ids.length - 1];
    if (n) {
      e.preventDefault();
      setSlot(n);
      document.getElementById(`garage-tab-${n}`)?.focus();
    }
  };

  const items = slotItems[slot];
  const ownedCount = (list) => list.filter((c) => owns(student, c.id)).length;
  const current = ITEMS[draft[slot]];

  return (
    <div className="page qc-page stack-lg">
      <header className="qc-head">
        <div className="stack" style={{ gap: 6 }}>
          <span className="eyebrow">Garage</span>
          <h1>My QuizBot</h1>
          <p className="muted">Tap any item to try it on. Equip the ones you own.</p>
        </div>
        <div className="qc-head-meta">
          <span className="chip tabular">Level {level}</span>
          <span className="chip chip-teal">{evo.title}</span>
          <StarsBalance value={student.craftingStars} />
        </div>
      </header>

      <div className="qc-garage">
        <section className="qc-stage-card" aria-labelledby="garage-bot-h">
          <h2 id="garage-bot-h" className="sr-only">
            Your QuizBot preview
          </h2>
          <BotStage
            loadout={draft}
            theme={theme}
            size={250}
            pose={pose.name}
            botKey={pose.key}
            reducedMotion={quiet}
            title={dirty ? 'Your QuizBot, previewing changes' : 'Your QuizBot'}
          >
            {dirty ? (
              <span className="chip chip-sun qc-stage-tag" role="status">
                Previewing
              </span>
            ) : null}
            <div className="qc-stage-tools">
              <Button size="sm" onClick={playEmote} disabled={!draft.emote || quiet} title={quiet ? 'Emotes are paused while Less motion is on' : undefined}>
                <span aria-hidden>▶</span> Emote
              </Button>
            </div>
          </BotStage>
          <div className="qc-nameplate">
            <h2>{student.displayName}</h2>
            <span className="caption">{current ? `${SLOT_LABEL[slot]}: ${itemDisplayName(current, theme)}` : `${SLOT_LABEL[slot]}: none`}</span>
          </div>
          <div className="qc-equipbar">
            <Button variant="primary" size="lg" onClick={equip} loading={saving} disabled={!dirty || lockedInDraft.length > 0}>
              Equip
            </Button>
            <Button size="lg" onClick={() => setDraft(saved)} disabled={!dirty || saving}>
              Cancel
            </Button>
          </div>
          {lockedInDraft.length ? (
            <p className="qc-note qc-note-warn" role="status">
              Preview only. {itemDisplayName(ITEMS[lockedInDraft[0]], theme)} is locked: {unlockLabel(ITEMS[lockedInDraft[0]])}.
            </p>
          ) : !dirty ? (
            <p className="qc-note">This is your saved look.</p>
          ) : (
            <p className="qc-note">Press Equip to keep this look, or Cancel to go back.</p>
          )}
          <ErrorNote>{error}</ErrorNote>
        </section>

        <section className="qc-locker" aria-labelledby="locker-h">
          <div className="qc-shelf-title">
            <h2 id="locker-h">Locker</h2>
            <span className="caption">Locked items can be previewed too.</span>
          </div>
          <div className="qc-tabs" role="tablist" aria-label="Item slots" onKeyDown={onTabKey}>
            {SLOTS.map((s) => {
              const list = slotItems[s.id];
              const sel = slot === s.id;
              return (
                <button
                  key={s.id}
                  id={`garage-tab-${s.id}`}
                  type="button"
                  role="tab"
                  className="qc-tab"
                  aria-selected={sel}
                  aria-controls="garage-panel"
                  tabIndex={sel ? 0 : -1}
                  onClick={() => setSlot(s.id)}
                >
                  <span className="qc-tab-art" aria-hidden>
                    {draft[s.id] ? <ItemArt itemId={draft[s.id]} theme={theme} size={34} /> : <span className="muted">·</span>}
                  </span>
                  <span className="stack" style={{ gap: 0, alignItems: 'flex-start' }}>
                    {SLOT_LABEL[s.id]}
                    <span className="qc-tab-count tabular">
                      {ownedCount(list)}/{list.length}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <div id="garage-panel" role="tabpanel" aria-labelledby={`garage-tab-${slot}`} className="stack" style={{ gap: 12 }}>
            <ul className="qc-tiles">
              {!REQUIRED_SLOTS.has(slot) ? (
                <li className="qc-tile" style={{ '--rar': 'var(--line-strong)' }}>
                  <button type="button" className="qc-tile-main" aria-pressed={draft[slot] == null} onClick={() => clearSlot(slot)}>
                    <span className="qc-tile-art" aria-hidden style={{ color: 'var(--muted)' }}>
                      <svg viewBox="0 0 48 48" width="52" height="52">
                        <circle cx="24" cy="24" r="18" fill="none" stroke="currentColor" strokeWidth="4" />
                        <path d="M11 37L37 11" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
                      </svg>
                    </span>
                    <span className="qc-tile-name">No {SLOT_LABEL[slot].toLowerCase()}</span>
                    <span className="caption">Take it off</span>
                  </button>
                </li>
              ) : null}
              {items.map((item) => (
                <ItemTile key={item.id} {...tileProps(item)} />
              ))}
            </ul>
          </div>
        </section>
      </div>

      {schoolItems.length ? (
        <Card aria-labelledby="school-gear-h" style={{ '--school': theme.primaryColor }}>
          <div className="stack">
            <div className="qc-shelf-title">
              <h2 id="school-gear-h">{theme.mascotName} Gear</h2>
              <span className="caption">Earned through school quests and teacher awards.</span>
            </div>
            <ul className="qc-tiles">
              {schoolItems.map((item) => (
                <ItemTile key={item.id} {...tileProps(item)} />
              ))}
            </ul>
          </div>
        </Card>
      ) : null}

      <div className="grid-2">
        <Card aria-labelledby="presets-h">
          <Presets student={student} draft={draft} theme={theme} lockedInDraft={lockedInDraft} />
        </Card>
        <Card aria-labelledby="evo-h">
          <div className="stack">
            <h2 id="evo-h">Bot evolution</h2>
            <EvolutionTrack level={level} loadout={saved} theme={theme} />
          </div>
        </Card>
      </div>

      <ConfirmModal
        open={!!craftItem}
        title="Craft this item?"
        confirmLabel={craftItem ? `Craft for ${craftCost(craftItem)} ✦` : 'Craft'}
        busy={crafting}
        onCancel={() => !crafting && setCraftItem(null)}
        onConfirm={craft}
        body={
          craftItem ? (
            <div className="row" style={{ gap: 16, flexWrap: 'nowrap' }}>
              <ItemArt itemId={craftItem.id} theme={theme} size={80} />
              <p className="prose">
                Spend {craftCost(craftItem)} of your {student.craftingStars || 0} Crafting Stars to get <strong>{itemDisplayName(craftItem, theme)}</strong>. You pick it, so there is no luck
                involved.
              </p>
            </div>
          ) : null
        }
      />

      {reveal ? <RewardReveal grants={reveal} studentId={student.id} theme={theme} calm={calm} reducedMotion={quiet} onDone={() => setReveal(null)} /> : null}
    </div>
  );
}

function Presets({ student, draft, theme, lockedInDraft }) {
  const toast = useToast();
  const presets = student.presets || {};
  const names = Object.keys(presets).sort();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const clean = name.replace(/[^A-Za-z0-9 ]/g, '').trim().slice(0, 20);
  const full = names.length >= rewards.maxPresets && !presets[clean];

  const run = async (key, payload, done) => {
    setBusy(key);
    setError(null);
    try {
      await request('loadoutRequests', payload);
      done?.();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(null);
    }
  };

  const save = (e) => {
    e.preventDefault();
    if (!clean) return;
    run('save', { action: 'savePreset', name: clean, loadout: draft }, () => {
      toast(`Saved "${clean}"`, { emoji: '💾' });
      setName('');
    });
  };

  return (
    <div className="stack">
      <div className="qc-shelf-title">
        <h2 id="presets-h">Saved looks</h2>
        <span className="caption tabular">
          {names.length} of {rewards.maxPresets}
        </span>
      </div>
      {names.length ? (
        <ul className="qc-presets">
          {names.map((n) => (
            <li key={n} className="qc-preset">
              <PresetBot loadout={presets[n]} theme={theme} />
              <span className="qc-preset-name">{n}</span>
              <Button size="sm" variant="primary" loading={busy === `apply:${n}`} disabled={busy != null} onClick={() => run(`apply:${n}`, { action: 'applyPreset', name: n }, () => toast(`Wearing "${n}"`, { emoji: '🤖' }))}>
                Wear
              </Button>
              <Button size="sm" variant="ghost" disabled={busy != null} onClick={() => setConfirmDelete(n)} aria-label={`Delete ${n}`}>
                Delete
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Save up to 3 looks, like "Space", "Tournament", or your school colors, and switch in one tap.</p>
      )}
      <form className="qc-preset-form" onSubmit={save}>
        <label htmlFor="preset-name" className="sr-only">
          Name for this look
        </label>
        <input
          id="preset-name"
          className="input"
          value={name}
          maxLength={20}
          placeholder="Name this look"
          onChange={(e) => setName(e.target.value)}
          disabled={full}
        />
        <Button type="submit" loading={busy === 'save'} disabled={!clean || full || busy != null || lockedInDraft.length > 0}>
          {presets[clean] ? 'Update look' : 'Save look'}
        </Button>
      </form>
      {full ? <p className="caption">You have 3 saved looks. Delete one to save a new look.</p> : null}
      {lockedInDraft.length ? <p className="caption">Take off locked items to save this look.</p> : null}
      <ErrorNote>{error}</ErrorNote>
      <ConfirmModal
        open={!!confirmDelete}
        title={`Delete "${confirmDelete}"?`}
        body="Your items stay in your collection. Only this saved look goes away."
        confirmLabel="Delete look"
        danger
        busy={busy === 'delete'}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => run('delete', { action: 'deletePreset', name: confirmDelete }, () => setConfirmDelete(null))}
      />
    </div>
  );
}

function PresetBot({ loadout, theme }) {
  // Static pose keeps a list of bots cheap on Chromebooks.
  return (
    <span aria-hidden style={{ width: 48, height: 52, display: 'grid', placeItems: 'center', flex: 'none' }}>
      <QuizBot loadout={loadout} theme={theme} size={44} pose="static" />
    </span>
  );
}
