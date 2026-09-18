// Treasure Vault (/play/vault): unopened rewards on pedestals, recent reveals,
// and the published contents of every chest type so rewards are transparent.
// Reads: students/{id}/grants where acknowledgedAt == null (usePendingGrants),
//   students/{id}/grants orderBy createdAt desc limit 20, schoolThemes/{schoolId}, classrooms/{cid}.
// Writes: grant acknowledgements (inside RewardReveal).
import { useMemo, useState } from 'react';
import { collection, limit, orderBy, query } from 'firebase/firestore';
import { db } from '../../firebase.js';
import { usePendingGrants } from '../../hooks/usePendingGrants.js';
import { useSchoolTheme } from '../../hooks/useSchoolTheme.js';
import { useQuery } from '../../hooks/useFirestore.js';
import { CHESTS, ITEMS, RARITY, chestPool, owns, rewards } from '../../lib/rewards.js';
import { fmtDate } from '../../lib/format.js';
import { ChestArt, ItemArt, itemDisplayName } from '../../components/bot/index.js';
import { Button, ButtonLink, Card, EmptyState, ErrorNote, Loading, Segmented } from '../../components/ui.jsx';
import { StudentGate, useMyClassroom } from '../../components/student/common.jsx';
import RewardReveal from '../../components/rewards/RewardReveal.jsx';
import {
  CheckIcon,
  GiftArt,
  Pedestal,
  RarityChip,
  SLOT_LABEL,
  StarBurstArt,
  StarsBalance,
  chestName,
  grantSourceLabel,
  lessMotion,
  rarityColor
} from '../../components/collection/parts.jsx';

export default function Vault() {
  return <StudentGate>{(student) => <VaultBody student={student} />}</StudentGate>;
}

function VaultBody({ student }) {
  const { theme, rewardCatalog } = useSchoolTheme();
  const { pending, loading } = usePendingGrants();
  const cls = useMyClassroom();
  const calm = cls.data?.settings?.rewards?.celebrations === 'calm';
  const quiet = lessMotion(student);
  const [opening, setOpening] = useState(null);
  const recent = useQuery(() => query(collection(db, `students/${student.id}/grants`), orderBy('createdAt', 'desc'), limit(20)), [student.id]);
  const revealed = recent.data.filter((g) => g.acknowledgedAt);

  return (
    <div className="page qc-page stack-xl">
      <header className="qc-head">
        <div className="stack" style={{ gap: 6 }}>
          <span className="eyebrow">Vault</span>
          <h1>Treasure Vault</h1>
          <p className="muted">Chests and gifts you earned wait here until you open them.</p>
        </div>
        <div className="qc-head-meta">
          <StarsBalance value={student.craftingStars} />
        </div>
      </header>

      <section className="qc-vault-hero stack-lg" aria-labelledby="waiting-h">
        <div className="row-between">
          <div className="stack" style={{ gap: 4 }}>
            <h2 id="waiting-h">Waiting to open</h2>
            <span className="caption">{loading ? ' ' : pending.length ? `${pending.length} ${pending.length === 1 ? 'reward' : 'rewards'} ready` : 'All opened'}</span>
          </div>
          {pending.length > 1 ? (
            <Button variant="sun" size="lg" onClick={() => setOpening(pending.slice())}>
              Open all ({pending.length})
            </Button>
          ) : null}
        </div>
        {loading ? (
          <Loading label="Checking your vault…" />
        ) : pending.length === 0 ? (
          <EmptyState emoji="🗝️" title="Nothing to open right now" action={<ButtonLink to="/play" variant="primary" size="lg">Go on a quest</ButtonLink>}>
            Win battles, level up, and explore the map to earn chests.
          </EmptyState>
        ) : (
          <ul className="qc-pedestals">
            {pending.map((g) => (
              <li key={g.id}>
                <WaitingReward grant={g} theme={theme} quiet={quiet} onOpen={() => setOpening([g])} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <Card aria-labelledby="dup-h" tone="sun">
        <div className="stack" style={{ gap: 10 }}>
          <h2 id="dup-h">
            <span aria-hidden>✦ </span>Already have it? You still win.
          </h2>
          <p className="prose">
            Chests only give items you don't own yet. If you already own everything a chest can hold, or you get something twice, it turns into Crafting Stars. Spend them in My QuizBot to
            craft the exact item you want.
          </p>
          <div className="qc-dup-table">
            {rewards.rarities.map((r) => (
              <span key={r.id} className="row" style={{ gap: 6 }}>
                <RarityChip rarity={r.id} small />
                <span className="caption tabular" style={{ fontWeight: 800 }}>
                  extra = +{r.duplicateStars} ✦{r.craftCost ? `, craft = ${r.craftCost} ✦` : ''}
                </span>
              </span>
            ))}
          </div>
        </div>
      </Card>

      <section className="stack" aria-labelledby="recent-h">
        <h2 id="recent-h">Recently opened</h2>
        {recent.loading ? (
          <Loading />
        ) : recent.error ? (
          <ErrorNote error={recent.error} />
        ) : revealed.length === 0 ? (
          <p className="muted">Rewards you open will show up here.</p>
        ) : (
          <ul className="qc-grant-list">
            {revealed.map((g) => (
              <RecentRow key={g.id} grant={g} theme={theme} />
            ))}
          </ul>
        )}
      </section>

      <ChestContents student={student} theme={theme} rewardCatalog={rewardCatalog} />

      {opening ? <RewardReveal grants={opening} studentId={student.id} theme={theme} calm={calm} reducedMotion={quiet} onDone={() => setOpening(null)} /> : null}
    </div>
  );
}

function WaitingReward({ grant, theme, quiet, onOpen }) {
  const isChest = grant.type === 'chest';
  const rarity = isChest ? grant.chestRarity || CHESTS[grant.chestId]?.rarity || 'common' : grant.rarity || 'common';
  const name = isChest ? chestName(grant.chestId, theme) : 'Mystery gift';
  return (
    <Pedestal
      rarity={rarity}
      label={
        <>
          <strong>{name}</strong>
          <span className="row" style={{ gap: 6, justifyContent: 'center' }}>
            <RarityChip rarity={rarity} small />
            <span className="caption">{grantSourceLabel(grant)}</span>
          </span>
          <Button variant="primary" onClick={onOpen} aria-label={`Open ${name}`}>
            Open
          </Button>
        </>
      }
    >
      {isChest ? (
        <ChestArt rarity={rarity} state="ready" school={grant.chestId === 'chest-school'} theme={theme} size={140} reducedMotion={quiet} title={name} />
      ) : (
        <GiftArt rarity={rarity} size={120} />
      )}
    </Pedestal>
  );
}

function RecentRow({ grant, theme }) {
  const item = grant.itemId ? ITEMS[grant.itemId] : null;
  const stars = !item || grant.duplicate;
  const rarity = item?.rarity || grant.chestRarity || 'common';
  return (
    <li className="qc-grant-row" style={{ '--rar': rarityColor(rarity) }}>
      <span className="qc-grant-art">{item ? <ItemArt itemId={item.id} theme={theme} size={46} /> : <StarBurstArt size={46} />}</span>
      <div className="stack" style={{ gap: 4, minWidth: 0 }}>
        <strong>{item ? itemDisplayName(item, theme) : `+${grant.craftingStars || 0} Crafting Stars`}</strong>
        <span className="row" style={{ gap: 6 }}>
          {item ? <RarityChip rarity={item.rarity} small /> : null}
          {item ? <span className="caption">{SLOT_LABEL[item.slot]}</span> : null}
          <span className="caption">
            {grant.type === 'chest' ? `${chestName(grant.chestId, theme)} · ` : ''}
            {grantSourceLabel(grant)}
          </span>
        </span>
        {stars && item ? <span className="caption">Already had it, so it became +{grant.craftingStars || 0} Crafting Stars.</span> : null}
        {!item ? <span className="caption">You already had everything in this chest.</span> : null}
      </div>
      <span className="caption tabular">{fmtDate(grant.createdAt)}</span>
    </li>
  );
}

function ChestContents({ student, theme, rewardCatalog }) {
  const chestIds = rewards.chests.map((c) => c.id);
  const [chestId, setChestId] = useState(chestIds[0]);
  const chest = CHESTS[chestId];
  const pool = useMemo(() => chestPool(chestId, { schoolCatalog: rewardCatalog }), [chestId, rewardCatalog]);
  const groups = rewards.rarities.map((r) => ({ rarity: r, items: pool.filter((c) => c.rarity === r.id) })).filter((g) => g.items.length);
  const ownedCount = pool.filter((c) => owns(student, c.id)).length;

  return (
    <Card aria-labelledby="pool-h">
      <div className="stack-lg">
        <div className="stack" style={{ gap: 6 }}>
          <h2 id="pool-h">What can be inside</h2>
          <p className="muted prose">Every chest shows exactly what it can hold. You never get an item you already own from a chest.</p>
        </div>
        <div className="qc-seg-scroll">
          <Segmented label="Chest type" value={chestId} onChange={setChestId} options={chestIds.map((id) => ({ value: id, label: chestName(id, theme) }))} />
        </div>
        <div className="row" style={{ gap: 16, flexWrap: 'nowrap', alignItems: 'center' }}>
          <ChestArt rarity={chest.rarity} state="closed" school={!!chest.schoolOnly} theme={theme} size={84} />
          <div className="stack" style={{ gap: 4 }}>
            <strong style={{ fontSize: '1.125rem' }}>{chestName(chestId, theme)}</strong>
            <span className="caption">
              {chest.schoolOnly ? 'School gear only. ' : `Up to ${RARITY[chest.maxItemRarity]?.name} items. `}
              You own {ownedCount} of {pool.length}.
            </span>
          </div>
        </div>
        <div className="qc-pool">
          {groups.map((g) => (
            <div key={g.rarity.id} className="qc-pool-group">
              <h4>
                <RarityChip rarity={g.rarity.id} />
                <span className="caption">{g.items.length}</span>
              </h4>
              <ul className="qc-pool-items">
                {g.items.map((c) => {
                  const have = owns(student, c.id);
                  return (
                    <li key={c.id} className="qc-pool-item" style={{ '--rar': rarityColor(c.rarity) }}>
                      <ItemArt itemId={c.id} theme={theme} size={40} />
                      <span className="stack" style={{ gap: 2, minWidth: 0 }}>
                        {itemDisplayName(c, theme)}
                        <span className="row" style={{ gap: 8 }}>
                          <span className="caption">{SLOT_LABEL[c.slot]}</span>
                          {have ? (
                            <span className="qc-owned-mark">
                              <CheckIcon size={12} /> Owned
                            </span>
                          ) : (
                            <span className="qc-missing-mark">Not yet</span>
                          )}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
