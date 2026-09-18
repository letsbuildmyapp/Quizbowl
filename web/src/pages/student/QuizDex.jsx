// QuizDex (/play/dex): every rival, grouped by world. Beaten rivals in full color
// with wins and first-beaten date; the rest are silhouettes with where to find them.
// Reads: students/{id} (live via useAuth): dex { [rivalId]: { wins|count, firstAt|firstBeatenAt } },
//   plus beatenPersonas and bossesDefeated as fallbacks.
// Writes: none.
import { WORLDS } from '../../lib/catalog.js';
import { rewards } from '../../lib/rewards.js';
import { fmtDate } from '../../lib/format.js';
import { ProgressBar } from '../../components/ui.jsx';
import { StudentGate } from '../../components/student/common.jsx';
import '../../components/collection/collection.css';

const NUMBER = Object.fromEntries(rewards.rivals.map((r, i) => [r.id, i + 1]));

export default function QuizDex() {
  return <StudentGate>{(student) => <DexBody student={student} />}</StudentGate>;
}

/** Normalized dex entry, or null when not beaten yet. */
function entryFor(rival, student) {
  const d = student.dex?.[rival.id];
  if (d) {
    return {
      wins: d.wins ?? d.count ?? d.beaten ?? 1,
      firstAt: d.firstAt ?? d.firstBeatenAt ?? d.at ?? null
    };
  }
  if (rival.kind === 'persona' && (student.beatenPersonas || []).includes(rival.id)) return { wins: null, firstAt: null };
  if (rival.kind === 'boss' && (student.bossesDefeated || []).includes(rival.world)) return { wins: null, firstAt: null };
  return null;
}

function DexBody({ student }) {
  const all = rewards.rivals;
  const found = all.filter((r) => entryFor(r, student)).length;
  const groups = [
    ...WORLDS.map((w) => ({ id: w.id, title: w.name, emoji: w.emoji, rivals: all.filter((r) => r.world === w.id).sort((a, b) => (a.kind === 'boss') - (b.kind === 'boss')) })),
    { id: 'personas', title: 'Rival challengers', emoji: '⚔️', rivals: all.filter((r) => r.kind === 'persona') }
  ].filter((g) => g.rivals.length);

  return (
    <div className="page qc-page stack-xl">
      <header className="qc-head">
        <div className="stack" style={{ gap: 6 }}>
          <span className="eyebrow">QuizDex</span>
          <h1>Rival QuizDex</h1>
          <p className="muted">Beat a rival in battle to add it to your QuizDex.</p>
        </div>
        <div className="stack" style={{ gap: 8, minWidth: 220 }}>
          <span style={{ fontWeight: 800 }} className="tabular">
            {found} of {all.length} found
          </span>
          <ProgressBar value={found} max={all.length} label="QuizDex completion" color="var(--teal)" height={14} />
        </div>
      </header>

      <div className="qc-dex-worlds">
      {groups.map((g) => {
        const got = g.rivals.filter((r) => entryFor(r, student)).length;
        return (
          <section key={g.id} className={`qc-dex-world ${g.id === 'personas' ? 'qc-dex-wide' : ''}`} aria-labelledby={`dex-${g.id}`}>
            <div className="qq-section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <h2 id={`dex-${g.id}`}>
                <span aria-hidden>{g.emoji} </span>
                {g.title}
              </h2>
              <span className={`chip tabular ${got === g.rivals.length ? 'chip-green' : ''}`}>
                {got === g.rivals.length ? '✓ ' : ''}
                {got} of {g.rivals.length}
              </span>
            </div>
            <ul className="qc-dex-grid">
              {g.rivals.map((r) => (
                <DexCard key={r.id} rival={r} entry={entryFor(r, student)} worldName={g.id === 'personas' ? null : g.title} />
              ))}
            </ul>
          </section>
        );
      })}
      </div>
    </div>
  );
}

function DexCard({ rival, entry, worldName }) {
  const num = String(NUMBER[rival.id]).padStart(3, '0');
  const kind = rival.kind === 'boss' ? 'Boss' : rival.kind === 'wild' ? 'Wild' : 'Rival';
  if (!entry) {
    return (
      <li className="qc-dex-card qc-dex-unknown" aria-label={`Rival number ${num}, not found yet. ${worldName ? `Find it in ${worldName}` : 'Challenge it in Play modes'}.`}>
        <span className="qc-dex-num" aria-hidden>
          #{num}
        </span>
        <span className="chip chip-gray qc-dex-kind" aria-hidden>
          {kind}
        </span>
        <img src={rival.image} alt="" loading="lazy" decoding="async" />
        <span className="qc-dex-name" aria-hidden>
          ???
        </span>
        <span className="caption" aria-hidden>
          {worldName ? `Find it in ${worldName}` : 'Challenge it in Play modes'}
        </span>
      </li>
    );
  }
  return (
    <li className="qc-dex-card" style={{ '--tint': rival.color || 'var(--purple)' }}>
      <span className="qc-dex-num">#{num}</span>
      <span className={`chip qc-dex-kind ${rival.kind === 'boss' ? 'chip-coral' : 'chip-teal'}`}>{kind}</span>
      <img src={rival.image} alt="" loading="lazy" decoding="async" />
      <span className="qc-dex-name">{rival.name}</span>
      <span className="caption tabular" style={{ fontWeight: 800, color: 'var(--ink-2)' }}>
        {entry.wins != null ? `${entry.wins} ${entry.wins === 1 ? 'win' : 'wins'}` : 'Beaten'}
        {entry.firstAt ? ` · first ${fmtDate(entry.firstAt)}` : ''}
      </span>
    </li>
  );
}
