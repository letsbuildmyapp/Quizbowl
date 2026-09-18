import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth.jsx';
import { Button, ButtonLink, Card, ErrorNote, Field, Loading } from '../../components/ui.jsx';
import { Owl, PublicPage, homeForClaims, safeNext } from '../../components/public/PublicLayout.jsx';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function isBadLink(err) {
  return /invalid-action-code|expired-action-code|invalid-email-link/i.test(err?.code || err?.message || '');
}

export default function FinishSignIn() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const [state, setState] = useState('working'); // working | need-email | invalid
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  async function finish(emailOverride) {
    const href = window.location.href;
    const cred = await auth.completeMagicLink(href, emailOverride);
    const claims = await auth.refreshClaims();
    navigate(next || homeForClaims(claims, cred.user), { replace: true });
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!auth.isMagicLink(window.location.href)) {
      setState('invalid');
      return;
    }
    finish().catch((err) => {
      if (err?.message === 'need-email') setState('need-email');
      else if (isBadLink(err)) setState('invalid');
      else {
        setError(err);
        setState('need-email');
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSubmit(e) {
    e.preventDefault();
    const clean = email.trim();
    if (!EMAIL_RE.test(clean)) {
      setFieldError('Enter the email you used to request the link.');
      return;
    }
    setFieldError(null);
    setError(null);
    setBusy(true);
    try {
      await finish(clean);
    } catch (err) {
      if (isBadLink(err)) setState('invalid');
      else setError(err);
      setBusy(false);
    }
  }

  return (
    <PublicPage narrow footer={false}>
      <div className="auth-wrap stack-lg">
        <div className="auth-head">
          <Owl size={88} />
        </div>
        {state === 'working' ? (
          <Card className="auth-card">
            <Loading label="Signing you in…" />
          </Card>
        ) : state === 'need-email' ? (
          <Card className="auth-card">
            <form className="stack-lg" onSubmit={onSubmit} noValidate>
              <div className="stack" style={{ gap: 6 }}>
                <h1>Confirm your email</h1>
                <p className="muted">This link was opened on a different device or browser. Enter the email you used so we can finish signing you in.</p>
              </div>
              <Field label="Email" error={fieldError} id="finish-email">
                {(id) => (
                  <input id={id} type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" aria-invalid={!!fieldError} />
                )}
              </Field>
              <ErrorNote error={error} />
              <Button type="submit" variant="primary" size="lg" block loading={busy}>
                Finish signing in
              </Button>
            </form>
          </Card>
        ) : (
          <Card className="auth-card stack-lg" style={{ textAlign: 'center' }}>
            <h1>That link didn’t work</h1>
            <p className="muted">Sign-in links expire and work only once. Ask for a new one.</p>
            <ButtonLink to="/login/family" variant="primary" size="lg">
              Get a new link
            </ButtonLink>
          </Card>
        )}
      </div>
    </PublicPage>
  );
}
