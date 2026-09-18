import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth, homeFor } from '../../hooks/useAuth.jsx';
import { Button, Card, ErrorNote, Field, Loading } from '../../components/ui.jsx';
import { Owl, PublicPage } from '../../components/public/PublicLayout.jsx';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default function ParentLogin() {
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState(null);

  if (auth.loading) return <Loading full />;
  if (auth.role && !auth.user?.isAnonymous) return <Navigate to={homeFor(auth)} replace />;

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    const clean = email.trim();
    if (!EMAIL_RE.test(clean)) {
      setFieldError('Enter a valid email.');
      return;
    }
    setFieldError(null);
    setBusy(true);
    try {
      await auth.sendMagicLink(clean, '/onboarding/family');
      setSentTo(clean);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <PublicPage>
      <div className="auth-wrap stack-lg">
        <div className="auth-head">
          <Owl size={88} />
          <h1>Families</h1>
          <p className="muted">Sign in with a link we email you. No password needed.</p>
        </div>

        {sentTo ? (
          <Card className="auth-card stack-lg" style={{ textAlign: 'center' }}>
            <span style={{ fontSize: '3rem' }} aria-hidden="true">
              📬
            </span>
            <h2 role="status">Check your email</h2>
            <p>
              We sent a sign-in link to <strong>{sentTo}</strong>. The link opens this site and signs you in.
            </p>
            <p className="caption">Don’t see it after a few minutes? Check your spam folder.</p>
            <Button
              variant="ghost"
              onClick={() => {
                setSentTo(null);
                setError(null);
              }}
            >
              Use a different email
            </Button>
          </Card>
        ) : (
          <Card className="auth-card">
            <form className="stack-lg" onSubmit={onSubmit} noValidate>
              <Field label="Your email" error={fieldError} id="family-email">
                {(id) => (
                  <input
                    id={id}
                    type="email"
                    className="input input-lg"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    aria-invalid={!!fieldError}
                  />
                )}
              </Field>
              <ErrorNote error={error} />
              <Button type="submit" variant="primary" size="lg" block loading={busy}>
                Email me a sign-in link
              </Button>
              <p className="caption">Your child’s teacher gives you a family code. You’ll enter it after signing in.</p>
            </form>
          </Card>
        )}

        <p className="center muted">
          Not a family member? <Link to="/login">Pick a different sign-in</Link>
        </p>
      </div>
    </PublicPage>
  );
}
