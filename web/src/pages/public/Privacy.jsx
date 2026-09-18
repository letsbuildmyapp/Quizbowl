import { Link } from 'react-router-dom';
import { PageHeader } from '../../components/ui.jsx';
import { PublicPage } from '../../components/public/PublicLayout.jsx';

const WHO = [
  { emoji: '🎒', who: 'Students', text: 'Their own progress, rewards, and settings. On leaderboards, classmates see only a nickname, avatar, and weekly score.' },
  { emoji: '🧑‍🏫', who: 'Teachers', text: 'Progress and answers for students in their own classes.' },
  { emoji: '👪', who: 'Families', text: 'A summary of their linked child’s practice and rewards, plus privacy controls.' },
  { emoji: '🏫', who: 'School admins', text: 'Teacher accounts, school settings, and privacy requests for their school.' }
];

export default function Privacy() {
  return (
    <PublicPage narrow>
      <article className="stack-xl notice">
        <PageHeader eyebrow="Privacy" title="Privacy notice" subtitle="How QuizQuest handles student information, in plain language." />

        <div className="alert alert-info">QuizQuest is in pilot. Schools should review this notice with their own counsel before using it with students.</div>

        <section className="stack" aria-labelledby="collect">
          <h2 id="collect">What we collect</h2>
          <ul>
            <li>A nickname and avatar the teacher picks for each student</li>
            <li>Which class the student belongs to</li>
            <li>Practice answers and scores</li>
            <li>Rewards like XP, badges, cards, and unlocked worlds</li>
            <li>Settings such as reading speed, sound, and large text</li>
            <li>A parent’s email address, only if a family chooses to link an account</li>
          </ul>
        </section>

        <section className="stack" aria-labelledby="dont">
          <h2 id="dont">What we don’t collect or do</h2>
          <ul>
            <li>Full names aren’t required. Teachers can use first names or nicknames.</li>
            <li>We never ask for birthdays or location.</li>
            <li>Kids can’t chat or message each other.</li>
            <li>There are no public profiles.</li>
            <li>We show no ads and do no tracking for ads.</li>
            <li>Nothing is for sale inside the app.</li>
            <li>Voice answers are off by default. A teacher has to turn them on.</li>
          </ul>
        </section>

        <section className="stack" aria-labelledby="who">
          <h2 id="who">Who sees what</h2>
          <div className="who-grid">
            {WHO.map((w) => (
              <div key={w.who} className="card stack" style={{ gap: 8 }}>
                <span style={{ fontSize: '1.75rem' }} aria-hidden="true">
                  {w.emoji}
                </span>
                <h3>{w.who}</h3>
                <p className="muted">{w.text}</p>
              </div>
            ))}
          </div>
          <p>Leaderboards are classroom-only. Teachers can switch them off, and a student can opt out.</p>
        </section>

        <section className="stack" aria-labelledby="retention">
          <h2 id="retention">How long we keep data</h2>
          <p>
            Detailed game data, like each answer in a match, is kept for the school’s retention period. The default is 365 days. After that, we keep only
            totals, such as how many questions a student answered.
          </p>
        </section>

        <section className="stack" aria-labelledby="rights">
          <h2 id="rights">Parent rights</h2>
          <p>Parents can review, export, correct, or delete their child’s data. Linked families can do this from Family, then Privacy. Parents can also ask the child’s teacher.</p>
        </section>

        <section className="stack" aria-labelledby="schools">
          <h2 id="schools">For schools</h2>
          <ul>
            <li>Schools choose a consent mode: school authorization under COPPA, or parent consent for each student.</li>
            <li>Access follows FERPA-aware rules. Teachers see their own classes, and school admins see their own school.</li>
            <li>Each school sets its own retention period.</li>
          </ul>
        </section>

        <p className="muted">
          Questions? <Link to="/pilot">Contact us through the pilot form</Link>.
        </p>
      </article>
    </PublicPage>
  );
}
