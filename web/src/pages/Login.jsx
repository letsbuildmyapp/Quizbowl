import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';

export default function Login() {
  const { signInWithGoogle, signInWithEmail, registerWithEmail, signInAsDemo } = useAuth();
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname ?? '/';

  const run = async (fn) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
      navigate(from, { replace: true });
    } catch (err) {
      setError(prettyAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="auth-shell">
      <div className="auth-card">
        <div className="auth-header">
          <span className="eyebrow">Quiz Bowl</span>
          <h1>{mode === 'signin' ? 'Welcome back' : 'Create your account'}</h1>
          <p className="muted">
            {mode === 'signin'
              ? 'Sign in to continue practicing and running classroom quizzes.'
              : 'Start practicing and hosting quizzes in seconds.'}
          </p>
        </div>

        <button
          className="btn btn-demo"
          onClick={() => run(signInAsDemo)}
          disabled={busy}
        >
          <span className="btn-badge">Fastest</span>
          Try the demo — no signup
        </button>

        <div className="divider"><span>or</span></div>

        <button
          className="btn btn-outline"
          onClick={() => run(signInWithGoogle)}
          disabled={busy}
        >
          <GoogleGlyph /> Continue with Google
        </button>

        <form
          className="auth-form"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => (mode === 'signin' ? signInWithEmail(email, password) : registerWithEmail(email, password)));
          }}
        >
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoComplete="email"
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters"
              required
              minLength={6}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            />
          </label>
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        {error && <p className="alert alert-error">{error}</p>}

        <p className="switch-mode">
          {mode === 'signin' ? "Don't have an account?" : 'Already have an account?'}
          <button
            type="button"
            className="link"
            onClick={() => { setError(null); setMode(mode === 'signin' ? 'signup' : 'signin'); }}
          >
            {mode === 'signin' ? 'Create one' : 'Sign in'}
          </button>
        </p>
      </div>
    </section>
  );
}

function prettyAuthError(err) {
  const code = err?.code ?? '';
  if (code === 'auth/operation-not-allowed' && err?.message?.includes('anonymous')) {
    return 'Anonymous sign-in is disabled. Enable it in Firebase Console → Authentication → Sign-in method.';
  }
  const map = {
    'auth/invalid-email': 'That email doesn\'t look right.',
    'auth/user-not-found': 'No account with that email.',
    'auth/wrong-password': 'Incorrect password.',
    'auth/invalid-credential': 'Incorrect email or password.',
    'auth/email-already-in-use': 'An account with that email already exists.',
    'auth/weak-password': 'Password should be at least 6 characters.',
    'auth/popup-closed-by-user': 'Sign-in popup was closed before completing.',
    'auth/operation-not-allowed': 'This sign-in method is disabled in Firebase settings.'
  };
  return map[code] ?? err?.message ?? 'Something went wrong. Please try again.';
}

function GoogleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/>
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.2 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.5-5.2l-6.2-5.2c-2 1.4-4.5 2.4-7.3 2.4-5.2 0-9.7-3.4-11.3-8l-6.5 5C9.6 39.6 16.2 44 24 44z"/>
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.6l6.2 5.2C41.4 35.6 44 30.2 44 24c0-1.3-.1-2.4-.4-3.5z"/>
    </svg>
  );
}
