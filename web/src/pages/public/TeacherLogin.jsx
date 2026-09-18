import { useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth as firebaseAuth } from '../../firebase.js';
import { useAuth, homeFor } from '../../hooks/useAuth.jsx';
import { Button, Card, ErrorNote, Field, Loading } from '../../components/ui.jsx';
import { Owl, PublicPage, safeNext } from '../../components/public/PublicLayout.jsx';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const TABS = [
  { id: 'signin', label: 'Sign in' },
  { id: 'create', label: 'Create account' }
];

function GoogleMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export default function TeacherLogin() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));

  const [tab, setTab] = useState('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [resetSent, setResetSent] = useState(false);
  const tabRefs = useRef({});

  if (auth.loading) return <Loading full />;
  if (!busy && auth.role && !auth.user?.isAnonymous) return <Navigate to={auth.isTeacher && next ? next : homeFor(auth)} replace />;

  async function routeAfterSignIn() {
    const claims = await auth.refreshClaims();
    if (claims.role === 'teacher') navigate(next || '/teach', { replace: true });
    else if (claims.role === 'parent') navigate('/family', { replace: true });
    else if (!claims.role && (claims.platformAdmin || claims.contentAdmin)) navigate('/admin', { replace: true });
    else navigate('/onboarding/teacher', { replace: true });
  }

  function validate() {
    const e = {};
    if (tab === 'create' && !name.trim()) e.name = 'Enter the name students will see, like Ms. Rivera.';
    if (!EMAIL_RE.test(email.trim())) e.email = 'Enter a valid email.';
    if (password.length < 8) e.password = 'Passwords need at least 8 characters.';
    setErrors(e);
    return !Object.keys(e).length;
  }

  async function onSubmit(ev) {
    ev.preventDefault();
    setError(null);
    setResetSent(false);
    if (!validate()) return;
    setBusy('email');
    try {
      if (tab === 'create') await auth.registerWithEmail(email.trim(), password, name.trim());
      else await auth.signInWithEmail(email.trim(), password);
      await routeAfterSignIn();
    } catch (err) {
      setError(err);
      setBusy(null);
    }
  }

  async function onGoogle() {
    setError(null);
    setResetSent(false);
    setBusy('google');
    try {
      await auth.signInWithGoogle();
      await routeAfterSignIn();
    } catch (err) {
      setError(err);
      setBusy(null);
    }
  }

  async function onForgot() {
    setError(null);
    setResetSent(false);
    if (!EMAIL_RE.test(email.trim())) {
      setErrors({ email: 'Enter your email above, then tap "Forgot password?" again.' });
      document.getElementById('teacher-email')?.focus();
      return;
    }
    setBusy('reset');
    try {
      await sendPasswordResetEmail(firebaseAuth, email.trim());
      setResetSent(true);
    } catch (err) {
      // Don't reveal whether an account exists.
      if (/user-not-found/.test(err?.code || err?.message || '')) setResetSent(true);
      else setError(err);
    } finally {
      setBusy(null);
    }
  }

  function onTabKey(e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const nextTab = tab === 'signin' ? 'create' : 'signin';
    setTab(nextTab);
    setErrors({});
    tabRefs.current[nextTab]?.focus();
  }

  return (
    <PublicPage>
      <div className="auth-wrap stack-lg">
        <div className="auth-head">
          <Owl size={88} />
          <h1>Teachers and coaches</h1>
          <p className="muted">Run your class, assign practice, and host live battles.</p>
        </div>

        <Card className="auth-card stack-lg">
          <div className="tabs" role="tablist" aria-label="Account">
            {TABS.map((t) => (
              <button
                key={t.id}
                ref={(el) => (tabRefs.current[t.id] = el)}
                type="button"
                role="tab"
                id={`tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls="teacher-panel"
                tabIndex={tab === t.id ? 0 : -1}
                onKeyDown={onTabKey}
                onClick={() => {
                  setTab(t.id);
                  setErrors({});
                  setError(null);
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div id="teacher-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="stack-lg">
            <Button size="lg" block onClick={onGoogle} loading={busy === 'google'} disabled={!!busy}>
              {busy === 'google' ? null : <GoogleMark />}
              Continue with Google
            </Button>

            <div className="or-divider">or use email</div>

            <form className="stack-lg" onSubmit={onSubmit} noValidate>
              {tab === 'create' ? (
                <Field label="Your name" hint="Students and families see this." error={errors.name} id="teacher-name">
                  {(id) => <input id={id} className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={80} aria-invalid={!!errors.name} />}
                </Field>
              ) : null}
              <Field label="Email" error={errors.email} id="teacher-email">
                {(id) => (
                  <input id={id} type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" aria-invalid={!!errors.email} />
                )}
              </Field>
              <Field label="Password" hint={tab === 'create' ? 'At least 8 characters.' : undefined} error={errors.password} id="teacher-password">
                {(id) => (
                  <input
                    id={id}
                    type="password"
                    className="input"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete={tab === 'create' ? 'new-password' : 'current-password'}
                    aria-invalid={!!errors.password}
                  />
                )}
              </Field>

              <ErrorNote error={error} />
              {resetSent ? (
                <div className="alert alert-success" role="status">
                  If that email has an account, a reset link is on its way.
                </div>
              ) : null}

              <Button type="submit" variant="primary" size="lg" block loading={busy === 'email'} disabled={!!busy}>
                {tab === 'create' ? 'Create account' : 'Sign in'}
              </Button>

              {tab === 'signin' ? (
                <div className="center">
                  <button type="button" className="link-button" onClick={onForgot} disabled={!!busy}>
                    Forgot password?
                  </button>
                </div>
              ) : (
                <p className="caption center">New schools start right away. Joining an existing school needs your school admin’s approval.</p>
              )}
            </form>
          </div>
        </Card>

        <p className="center muted">
          Not a teacher? <Link to="/login">Pick a different sign-in</Link>
        </p>
      </div>
    </PublicPage>
  );
}
