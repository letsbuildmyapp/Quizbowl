import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { Loading } from '../../components/ui.jsx';
import { useAuth, homeFor } from '../../hooks/useAuth.jsx';
import { Owl, PublicPage, safeNext } from '../../components/public/PublicLayout.jsx';

const CHOICES = [
  { to: '/login/student', emoji: '🎒', title: 'I’m a student', text: 'Use the class code and PIN from your teacher.' },
  { to: '/login/teacher', emoji: '🧑‍🏫', title: 'I’m a teacher or coach', text: 'Sign in with email or Google.' },
  { to: '/login/family', emoji: '👪', title: 'I’m a family member', text: 'Get a sign-in link by email.' }
];

export default function Login() {
  const auth = useAuth();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));

  if (auth.loading) return <Loading full />;
  if (auth.role || auth.isPlatformAdmin || auth.isContentAdmin) return <Navigate to={next || homeFor(auth)} replace />;

  const suffix = next ? `?next=${encodeURIComponent(next)}` : '';

  return (
    <PublicPage>
      <div className="auth-wrap auth-wrap-wide stack-xl">
        <div className="auth-head">
          <Owl size={110} />
          <h1>Who’s signing in?</h1>
        </div>
        <div className="role-choices">
          {CHOICES.map((c) => (
            <Link key={c.to} to={`${c.to}${suffix}`} className="role-choice">
              <span className="role-choice-emoji" aria-hidden="true">
                {c.emoji}
              </span>
              <h2>{c.title}</h2>
              <p className="muted">{c.text}</p>
              <span className="go" aria-hidden="true">
                Continue →
              </span>
            </Link>
          ))}
        </div>
      </div>
    </PublicPage>
  );
}
