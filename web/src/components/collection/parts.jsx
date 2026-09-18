// Shared pieces for the collection screens (Garage, Vault, Quiz Hall, QuizDex, Team HQ)
// and the reward reveal. Everything visual is prefixed qc- (see collection.css).
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase.js';
import { ITEMS, RARITY, CHESTS, rewards, isStarter, owns } from '../../lib/rewards.js';
import { itemDisplayName } from '../bot/index.js';
import './collection.css';

export const SLOT_LABEL = {
  paint: 'Paint',
  face: 'Face',
  headgear: 'Headgear',
  back: 'Back',
  held: 'Buzzer',
  companion: 'Companion',
  effect: 'Effect',
  emote: 'Emote'
};
export const REQUIRED_SLOTS = new Set(rewards.slots.filter((s) => s.required).map((s) => s.id));

export const rarityName = (r) => RARITY[r]?.name || 'Common';
export const rarityColor = (r) => RARITY[r]?.color || '#8a94a6';

/** Rarity shown as color AND text (never color alone). */
export function RarityChip({ rarity, small }) {
  return (
    <span className={`qc-rarity qc-rarity-${rarity || 'common'} ${small ? 'qc-rarity-sm' : ''}`} style={{ '--rar': rarityColor(rarity) }}>
      <span className="qc-rarity-gem" aria-hidden />
      {rarityName(rarity)}
    </span>
  );
}

export function StarsBalance({ value }) {
  return (
    <span className="qc-stars-balance" title="Crafting Stars">
      <span aria-hidden>✦</span>
      <span className="tabular">{value || 0}</span>
      <span className="qc-stars-balance-label">Crafting Stars</span>
    </span>
  );
}

/** Chest display name with the school mascot filled in. */
export function chestName(chestId, theme) {
  const c = CHESTS[chestId];
  if (!c) return 'Treasure Chest';
  return c.name.replace(/\{mascot\}/g, theme?.mascotName || 'School');
}

export function craftCost(item) {
  if (!item || item.school || item.unlock?.type !== 'chest') return null;
  return RARITY[item.rarity]?.craftCost || null;
}

/** Exact requirement plus measurable progress when there is one. */
export function lockProgress(item, student) {
  const u = item.unlock || {};
  if (u.type === 'level') return { have: Math.min(student?.level || 1, u.value), need: u.value, unit: 'level' };
  if (u.type === 'streak') {
    const have = Math.max(student?.streak?.current || 0, student?.streak?.best || 0);
    return { have: Math.min(have, u.value), need: u.value, unit: 'days' };
  }
  if (u.type === 'all_worlds_mastered') {
    const need = 7;
    return { have: Math.min((student?.masteredWorlds || []).length, need), need, unit: 'worlds' };
  }
  return null;
}

/** equipped | owned | locked, plus the "New!" flag from the inventory. */
export function itemState(item, student, loadout) {
  const owned = owns(student, item.id);
  return {
    owned,
    equipped: owned && loadout?.[item.slot] === item.id,
    isNew: !!student?.inventory?.[item.id]?.isNew,
    starter: isStarter(item.id)
  };
}

export function isApprovedSchoolItem(item, rewardCatalog) {
  if (!item.school) return true;
  return !rewardCatalog?.approved || rewardCatalog.approved.includes(item.id);
}

/** Reduced motion from the student setting, the OS, or the root flag. */
export function lessMotion(student) {
  if (student?.settings?.reducedMotion) return true;
  if (typeof window === 'undefined') return false;
  if (document.documentElement?.dataset?.reducedMotion === 'true') return true;
  return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export function logAnalytics(type) {
  addDoc(collection(db, 'analyticsEvents'), { type, createdAt: serverTimestamp() }).catch(() => {});
}

const SOURCE_LABEL = {
  map: 'Map treasure',
  craft: 'Crafted',
  teacher_award: 'From your teacher',
  'school-quest': 'School quest',
  unlock: 'Unlocked',
  'level-chest': 'Level reward',
  'streak-3': '3-day streak',
  'streak-7': '7-day streak',
  'world-mastery': 'World mastered',
  'first-win': 'First win',
  'boss-defeat': 'Boss defeated'
};
export const grantSourceLabel = (g) => SOURCE_LABEL[g?.source?.rule] || 'Reward';

/** Human name of what a grant turned into. */
export function grantTitle(g, theme) {
  if (g.itemId && !g.duplicate) return itemDisplayName(ITEMS[g.itemId], theme);
  if (g.type === 'chest' && !g.itemId) return `${chestName(g.chestId, theme)}: +${g.craftingStars || 0} Crafting Stars`;
  if (g.itemId && g.duplicate) return `${itemDisplayName(ITEMS[g.itemId], theme)} (extra): +${g.craftingStars || 0} Crafting Stars`;
  return 'Reward';
}

/** A glowing pedestal to put a chest or item on. */
export function Pedestal({ rarity = 'common', children, label, className = '' }) {
  return (
    <div className={`qc-pedestal ${className}`} style={{ '--rar': rarityColor(rarity) }}>
      <div className="qc-pedestal-art">{children}</div>
      <div className="qc-pedestal-base" aria-hidden>
        <span className="qc-pedestal-gem" />
      </div>
      {label ? <div className="qc-pedestal-label">{label}</div> : null}
    </div>
  );
}

/** Small wrapped gift for item grants waiting in the Vault (keeps the surprise). */
export function GiftArt({ rarity = 'common', size = 110 }) {
  const c = rarityColor(rarity);
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} role="img" aria-label={`${rarityName(rarity)} gift`}>
      <ellipse cx="60" cy="108" rx="40" ry="7" fill="#1e1b4b" opacity="0.18" />
      <rect x="22" y="50" width="76" height="56" rx="8" fill={c} stroke="#1e1b4b" strokeWidth="3" />
      <rect x="16" y="38" width="88" height="18" rx="6" fill={c} stroke="#1e1b4b" strokeWidth="3" />
      <rect x="52" y="38" width="16" height="68" fill="#ffffff" stroke="#1e1b4b" strokeWidth="3" />
      <path d="M60 38C44 18 30 26 38 36C42 40 52 39 60 38Z" fill="#ffffff" stroke="#1e1b4b" strokeWidth="3" strokeLinejoin="round" />
      <path d="M60 38C76 18 90 26 82 36C78 40 68 39 60 38Z" fill="#ffffff" stroke="#1e1b4b" strokeWidth="3" strokeLinejoin="round" />
      <path d="M30 58L30 96" stroke="#ffffff" strokeWidth="4" strokeLinecap="round" opacity="0.35" />
      <text x="84" y="92" textAnchor="middle" fontSize="18" fontWeight="800" fill="#ffffff" fontFamily="Fredoka, Nunito, sans-serif">?</text>
    </svg>
  );
}

/** Crafting Star burst art for duplicate conversions. */
export function StarBurstArt({ size = 140 }) {
  const pts = (cx, cy, r, inner) =>
    Array.from({ length: 10 }, (_, i) => {
      const a = ((-90 + i * 36) * Math.PI) / 180;
      const rr = i % 2 ? r * inner : r;
      return `${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`;
    }).join(' ');
  return (
    <svg viewBox="0 0 140 140" width={size} height={size} aria-hidden>
      <circle cx="70" cy="70" r="58" fill="#ffc940" opacity="0.18" />
      <polygon points={pts(70, 72, 46, 0.48)} fill="#ffc940" stroke="#1e1b4b" strokeWidth="3.5" strokeLinejoin="round" />
      <polygon points={pts(70, 72, 30, 0.48)} fill="#ffe28a" />
      <polygon points={pts(28, 32, 11, 0.45)} fill="#ffe28a" stroke="#1e1b4b" strokeWidth="2" strokeLinejoin="round" />
      <polygon points={pts(114, 40, 9, 0.45)} fill="#ffe28a" stroke="#1e1b4b" strokeWidth="2" strokeLinejoin="round" />
      <polygon points={pts(112, 110, 7, 0.45)} fill="#ffe28a" stroke="#1e1b4b" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

export function LockIcon({ size = 16 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden style={{ flex: 'none' }}>
      <rect x="4" y="10" width="16" height="12" rx="3" fill="currentColor" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" strokeWidth="2.6" />
    </svg>
  );
}

export function CheckIcon({ size = 14 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden style={{ flex: 'none' }}>
      <path d="M4 12.5l5 5L20 6.5" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** One member of the school ("Warrior", "Quester"): mascot names can be plural. */
export function mascotOne(theme) {
  const m = theme?.mascotName || 'Quester';
  return m.endsWith('s') ? m.slice(0, -1) : m;
}
