import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';

export default function Home() {
  const { user, profile } = useAuth();
  return (
    <>
      <section className="hero">
        <span className="eyebrow">Solo Practice · Async Classroom</span>
        <h1>Sharpen every buzzer instinct.</h1>
        <p className="subtitle">
          Drill through curated quiz-bowl questions on your own, or run graded
          async quizzes for your classroom. All your progress, one clean home.
        </p>
        <div className="cta">
          {user ? (
            <>
              <Link className="btn btn-primary" to="/practice">Start practicing</Link>
              <Link className="btn btn-outline" to="/classroom">Open classroom</Link>
            </>
          ) : (
            <>
              <Link className="btn btn-primary" to="/login">Get started</Link>
              <Link className="btn btn-outline" to="/login">Try the demo</Link>
            </>
          )}
        </div>
      </section>

      <section className="feature-grid">
        <div className="card">
          <div className="feature-icon">◎</div>
          <h3>Solo drills</h3>
          <p>Cycle through a personalized question bank with running stats and category tags.</p>
        </div>
        <div className="card">
          <div className="feature-icon">✎</div>
          <h3>Author quizzes</h3>
          <p>Teachers assemble question sets from the shared bank and publish them to students.</p>
        </div>
        <div className="card">
          <div className="feature-icon">✓</div>
          <h3>Server-side grading</h3>
          <p>Answers are checked in a Cloud Function so scoring is tamper-proof.</p>
        </div>
      </section>
    </>
  );
}
