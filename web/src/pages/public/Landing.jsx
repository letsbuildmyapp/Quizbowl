import { Link } from 'react-router-dom';
import { ButtonLink } from '../../components/ui.jsx';
import { Owl, PublicFooter, PublicHeader } from '../../components/public/PublicLayout.jsx';
import { PERSONAS, WORLDS } from '../../lib/catalog.js';

const PILLS = [
  { word: 'PLAY', line: 'Practice real tossups', tone: 'purple' },
  { word: 'EXPLORE', line: 'Unlock learning worlds', tone: 'teal' },
  { word: 'COMPETE', line: 'Challenge people or the computer', tone: 'sun' }
];

const LOOP = [
  { n: 1, title: 'Hear a clue', text: 'A real tossup appears one clue at a time.', tone: 'purple' },
  { n: 2, title: 'Buzz', text: 'Answer early for more points.', tone: 'coral' },
  { n: 3, title: 'Learn', text: 'See why the answer is right.', tone: 'teal' },
  { n: 4, title: 'Unlock', text: 'Earn XP, cards, badges, and worlds.', tone: 'sun' }
];

const ROLES = [
  { emoji: '🎒', who: 'Students', title: 'Kids play', text: 'Buzz on real tossups, beat computer rivals, and open new worlds.', tone: 'purple' },
  { emoji: '🧑‍🏫', who: 'Teachers and coaches', title: 'Teachers guide', text: 'Assign practice, run live team battles, and spot the topics that need work.', tone: 'teal' },
  { emoji: '👪', who: 'Families', title: 'Parents cheer', text: 'Follow progress at home and manage your child’s privacy settings.', tone: 'sun' }
];

const SAFETY = [
  { emoji: '🏷️', text: 'Teacher-managed nicknames. No full names needed.' },
  { emoji: '🏫', text: 'Leaderboards stay inside the classroom.' },
  { emoji: '🤐', text: 'No chat or messaging between kids.' },
  { emoji: '🙈', text: 'Profiles are never public.' },
  { emoji: '🚫', text: 'Zero ads and zero tracking for ads.' },
  { emoji: '🪙', text: 'Nothing to buy, ever.' }
];

const FIXED_RIVALS = PERSONAS.filter((p) => !p.adaptive).sort((a, b) => a.tier - b.tier);
const BEST_FIT = PERSONAS.find((p) => p.adaptive);

export default function Landing() {
  return (
    <div className="pub-shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>

      <div className="hero">
        <div className="hero-bg" aria-hidden="true" />
        <PublicHeader dark />
        <div className="hero-inner">
          <span className="hero-tag">A passion project by Meridian</span>
          <h1 className="hero-wordmark">QUIZQUEST</h1>
          <p className="hero-headline">Turn quiz bowl practice into an adventure kids choose to play.</p>
          <ul className="hero-pills" aria-label="What you can do">
            {PILLS.map((p) => (
              <li key={p.word} className={`hero-pill hero-pill-${p.tone}`}>
                <strong>{p.word}</strong>
                <span>{p.line}</span>
              </li>
            ))}
          </ul>
          <div className="hero-ctas">
            <ButtonLink to="/login/student" variant="sun" size="lg">
              Student sign in
            </ButtonLink>
            <ButtonLink to="/login/teacher" variant="primary" size="lg">
              Teacher sign in
            </ButtonLink>
            <Link to="/login/family" className="btn btn-lg hero-ghost">
              Families
            </Link>
          </div>
          <p className="hero-note">Students sign in with a class code and PIN from their teacher.</p>
        </div>
      </div>

      <main id="main" tabIndex={-1}>
        <section className="pub-section" aria-labelledby="loop-title">
          <div className="pub-wrap loop-wrap">
            <div className="stack-lg">
              <div className="stack" style={{ gap: 8 }}>
                <span className="eyebrow">The game loop</span>
                <h2 id="loop-title" className="pub-h2">
                  Every tossup is a quick quest
                </h2>
                <p className="muted prose">The same format kids see at tournaments, turned into a game.</p>
              </div>
              <ol className="loop">
                {LOOP.map((s) => (
                  <li key={s.n} className="loop-step">
                    <span className={`loop-num tone-${s.tone}`} aria-hidden="true">
                      {s.n}
                    </span>
                    <div className="stack" style={{ gap: 4 }}>
                      <h3>{s.title}</h3>
                      <p className="muted">{s.text}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
            <Owl size={220} className="loop-owl" />
          </div>
        </section>

        <section className="pub-section pub-section-tint" aria-labelledby="worlds-title">
          <div className="pub-wrap stack-lg">
            <div className="stack" style={{ gap: 8 }}>
              <span className="eyebrow">Explore</span>
              <h2 id="worlds-title" className="pub-h2">
                Choose a world. Complete quests. Unlock the next adventure.
              </h2>
            </div>
            <div className="worlds-map">
              <img src="/art/world-map.webp" alt="Illustrated map of the QuizQuest worlds with a path of stars between them" width="1536" height="1024" loading="lazy" />
            </div>
            <ul className="worlds-list">
              {WORLDS.map((w) => (
                <li key={w.id} className="world-item">
                  <span className="world-emoji" aria-hidden="true">
                    {w.emoji}
                  </span>
                  <div className="stack" style={{ gap: 2 }}>
                    <strong>{w.name}</strong>
                    <span className="caption">{w.blurb}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="pub-section" aria-labelledby="roles-title">
          <div className="pub-wrap stack-lg">
            <h2 id="roles-title" className="pub-h2 center">
              Kids play. Teachers guide. Parents cheer.
            </h2>
            <div className="grid-3 pub-grid">
              {ROLES.map((r) => (
                <div key={r.who} className={`card role-card card-${r.tone}`}>
                  <span className="role-emoji" aria-hidden="true">
                    {r.emoji}
                  </span>
                  <span className="eyebrow">{r.who}</span>
                  <h3>{r.title}</h3>
                  <p className="muted">{r.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="pub-section pub-section-tint" aria-labelledby="rivals-title">
          <div className="pub-wrap stack-lg">
            <div className="stack" style={{ gap: 8 }}>
              <span className="eyebrow">Compete</span>
              <h2 id="rivals-title" className="pub-h2">
                Computer rivals for every level
              </h2>
              <p className="muted prose">Start with Rookie Robot and work up to the Quiz Master.</p>
            </div>
            <ul className="rivals">
              {FIXED_RIVALS.map((p) => (
                <li key={p.id} className="card rival">
                  <span className="rival-avatar" aria-hidden="true">
                    {p.avatar}
                  </span>
                  <strong className="rival-name">{p.name}</strong>
                  <span className={`chip ${['chip-green', 'chip-teal', 'chip-sun', 'chip-coral'][p.tier] || ''}`}>{p.difficulty}</span>
                  <p className="caption">{p.strengths}</p>
                </li>
              ))}
            </ul>
            {BEST_FIT ? (
              <div className="card card-hero bestfit">
                <span className="rival-avatar bestfit-avatar" aria-hidden="true">
                  {BEST_FIT.avatar}
                </span>
                <div className="stack" style={{ gap: 6 }}>
                  <h3>{BEST_FIT.name}</h3>
                  <p>Adapts to how each kid plays, so matches stay close.</p>
                </div>
              </div>
            ) : null}
          </div>
        </section>

        <section className="pub-section" aria-labelledby="safety-title">
          <div className="pub-wrap stack-lg">
            <div className="stack" style={{ gap: 8 }}>
              <span className="eyebrow">Safety</span>
              <h2 id="safety-title" className="pub-h2">
                Privacy-first from the start
              </h2>
              <p className="muted prose">Teachers set up every student profile. Kids never enter an email address.</p>
            </div>
            <ul className="safety">
              {SAFETY.map((s) => (
                <li key={s.text} className="safety-item">
                  <span aria-hidden="true">{s.emoji}</span>
                  {s.text}
                </li>
              ))}
            </ul>
            <p>
              <Link to="/privacy">Read the privacy notice</Link>
            </p>
          </div>
        </section>

        <section className="pub-section pub-section-flush" aria-labelledby="pilot-title">
          <div className="pub-wrap">
            <div className="pilot-cta">
              <Owl size={140} className="pilot-owl" />
              <div className="stack" style={{ gap: 8 }}>
                <h2 id="pilot-title" className="pub-h2">
                  Bring QuizQuest to your class
                </h2>
                <p className="prose">We’re running pilots with teachers and coaches in grades 4 to 8.</p>
              </div>
              <ButtonLink to="/pilot" variant="sun" size="lg">
                Request a pilot
              </ButtonLink>
            </div>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}
