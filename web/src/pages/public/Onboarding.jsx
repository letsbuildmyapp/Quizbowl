import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase.js';
import { request } from '../../lib/requests.js';
import { useAuth, homeFor } from '../../hooks/useAuth.jsx';
import { Button, Card, ErrorNote, Field, Loading, friendlyError } from '../../components/ui.jsx';
import { Owl, PublicPage } from '../../components/public/PublicLayout.jsx';

function cleanCode(v, len) {
  return v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, len);
}

function SignOutLink() {
  const auth = useAuth();
  return (
    <p className="center muted">
      Signed in as {auth.user?.email || 'this account'}.{' '}
      <button type="button" className="link-button" onClick={auth.signOut}>
        Sign out
      </button>
    </p>
  );
}

function Chooser() {
  return (
    <div className="auth-wrap auth-wrap-wide stack-xl">
      <div className="auth-head">
        <Owl size={100} />
        <h1>Finish setting up</h1>
        <p className="muted">Tell us how you’ll use QuizQuest.</p>
      </div>
      <div className="role-choices">
        <Link to="/onboarding/teacher" className="role-choice">
          <span className="role-choice-emoji" aria-hidden="true">
            🧑‍🏫
          </span>
          <h2>I teach or coach</h2>
          <p className="muted">Start a school or join yours.</p>
          <span className="go" aria-hidden="true">
            Continue →
          </span>
        </Link>
        <Link to="/onboarding/family" className="role-choice">
          <span className="role-choice-emoji" aria-hidden="true">
            👪
          </span>
          <h2>I’m a family member</h2>
          <p className="muted">Link to your child with a family code.</p>
          <span className="go" aria-hidden="true">
            Continue →
          </span>
        </Link>
      </div>
      <SignOutLink />
    </div>
  );
}

function TeacherPending() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [schoolName, setSchoolName] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [error, setError] = useState(null);
  const schoolId = auth.claims.schoolId;

  useEffect(() => {
    if (!schoolId) return;
    getDoc(doc(db, 'schools', schoolId))
      .then((snap) => setSchoolName(snap.data()?.name || null))
      .catch(() => setSchoolName(null));
  }, [schoolId]);

  async function check() {
    setBusy(true);
    setNote(null);
    setError(null);
    try {
      const claims = await auth.refreshClaims();
      if (claims.role === 'teacher') navigate('/teach', { replace: true });
      else setNote('Still waiting. We’ll let you in as soon as you’re approved.');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap stack-lg">
      <Card className="auth-card stack-lg" style={{ textAlign: 'center', alignItems: 'center' }}>
        <Owl size={110} />
        <h1>Waiting for approval</h1>
        <p className="prose">
          You asked to join <strong>{schoolName || 'your school'}</strong>. Your school admin needs to approve you before you can set up classes.
        </p>
        <p className="muted">Checked with your admin? Tap below to see if you’re in.</p>
        <div aria-live="polite" className="stack" style={{ width: '100%' }}>
          {note ? <div className="alert alert-info">{note}</div> : null}
          <ErrorNote error={error} />
        </div>
        <Button variant="primary" size="lg" onClick={check} loading={busy}>
          Check again
        </Button>
      </Card>
      <SignOutLink />
    </div>
  );
}

function TeacherSetup() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState('new');
  const [displayName, setDisplayName] = useState(auth.user?.displayName || auth.profile?.displayName || '');
  const [schoolName, setSchoolName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    const found = {};
    if (!displayName.trim()) found.displayName = 'Enter the name students will see.';
    if (mode === 'new' && !schoolName.trim()) found.schoolName = 'Enter your school or team name.';
    if (mode === 'join' && joinCode.length !== 8) found.joinCode = 'School join codes have 8 letters and numbers.';
    setErrors(found);
    if (Object.keys(found).length) return;

    setBusy(true);
    setError(null);
    try {
      const payload = mode === 'new' ? { displayName: displayName.trim(), schoolName: schoolName.trim() } : { displayName: displayName.trim(), schoolJoinCode: joinCode };
      try {
        await request('teacherRequests', payload, { id: auth.user.uid });
      } catch (err) {
        // The request doc is keyed by uid and can only be created once.
        if (/permission|insufficient/i.test(err?.message || '')) {
          throw new Error('We couldn’t send another setup request from this account. Contact us from the pilot page and we’ll fix it.');
        }
        throw err;
      }
      const claims = await auth.refreshClaims();
      if (claims.role === 'teacher') navigate('/teach', { replace: true });
      // teacher_pending re-renders into the waiting screen.
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap stack-lg">
      <div className="auth-head">
        <Owl size={88} />
        <h1>Set up your teacher account</h1>
      </div>
      <Card className="auth-card">
        <form className="stack-lg" onSubmit={onSubmit} noValidate>
          <Field label="Your name" hint="Students and families see this, like Ms. Rivera." error={errors.displayName} id="ob-name">
            {(id) => (
              <input id={id} className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="name" maxLength={80} aria-invalid={!!errors.displayName} />
            )}
          </Field>

          <div className="stack" style={{ gap: 8 }}>
            <span className="label" id="ob-mode">
              Your school
            </span>
            <div className="tabs" role="group" aria-labelledby="ob-mode">
              <button type="button" aria-pressed={mode === 'new'} onClick={() => setMode('new')}>
                Start a new school
              </button>
              <button type="button" aria-pressed={mode === 'join'} onClick={() => setMode('join')}>
                Join my school
              </button>
            </div>
          </div>

          {mode === 'new' ? (
            <Field label="School or team name" hint="You’ll be the school admin and can invite other teachers." error={errors.schoolName} id="ob-school">
              {(id) => <input id={id} className="input" value={schoolName} onChange={(e) => setSchoolName(e.target.value)} maxLength={120} aria-invalid={!!errors.schoolName} />}
            </Field>
          ) : (
            <Field label="School join code" hint="Your school admin can find it on their School page. They’ll approve you after you join." error={errors.joinCode} id="ob-join">
              {(id) => (
                <input
                  id={id}
                  className="input input-lg code-input"
                  value={joinCode}
                  onChange={(e) => setJoinCode(cleanCode(e.target.value, 8))}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  maxLength={8}
                  aria-invalid={!!errors.joinCode}
                />
              )}
            </Field>
          )}

          {error ? <ErrorNote>{error}</ErrorNote> : null}
          <Button type="submit" variant="primary" size="lg" block loading={busy}>
            {mode === 'new' ? 'Create school' : 'Ask to join'}
          </Button>
        </form>
      </Card>
      <SignOutLink />
    </div>
  );
}

function FamilySetup({ onLinked }) {
  const auth = useAuth();
  const [code, setCode] = useState('');
  const [fieldError, setFieldError] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    if (code.length !== 8) {
      setFieldError('Family codes have 8 letters and numbers.');
      return;
    }
    setFieldError(null);
    setError(null);
    setBusy(true);
    try {
      const result = await request('parentRequests', { type: 'link', code });
      onLinked(result?.displayName || null);
      await auth.refreshClaims();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap stack-lg">
      <div className="auth-head">
        <Owl size={88} />
        <h1>Link to your child</h1>
      </div>
      <Card className="auth-card">
        <form className="stack-lg" onSubmit={onSubmit} noValidate>
          <Field label="Family code" hint="Enter the family code from your child’s teacher." error={fieldError} id="ob-family">
            {(id) => (
              <input
                id={id}
                className="input input-lg code-input"
                value={code}
                onChange={(e) => setCode(cleanCode(e.target.value, 8))}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={8}
                aria-invalid={!!fieldError}
              />
            )}
          </Field>
          <ErrorNote error={error} />
          <Button type="submit" variant="primary" size="lg" block loading={busy}>
            Link my child
          </Button>
          <p className="caption">No code yet? Ask your child’s teacher. Each code works for one child.</p>
        </form>
      </Card>
      <SignOutLink />
    </div>
  );
}

function Linked({ name }) {
  const navigate = useNavigate();
  useEffect(() => {
    const t = setTimeout(() => navigate('/family', { replace: true }), 1800);
    return () => clearTimeout(t);
  }, [navigate]);
  return (
    <div className="auth-wrap">
      <Card className="auth-card stack-lg" style={{ textAlign: 'center', alignItems: 'center' }}>
        <Owl size={120} />
        <h1 role="status">{name ? `You’re linked to ${name}!` : 'You’re linked!'}</h1>
        <p className="muted">Opening your family page…</p>
      </Card>
    </div>
  );
}

export default function Onboarding() {
  const auth = useAuth();
  const location = useLocation();
  const sub = (useParams()['*'] || '').split('/')[0];
  const [linked, setLinked] = useState(undefined);

  if (auth.loading) return <Loading full />;

  if (linked !== undefined) {
    return (
      <PublicPage narrow footer={false}>
        <Linked name={linked} />
      </PublicPage>
    );
  }

  if (!auth.user || auth.user.isAnonymous) {
    const login = sub === 'teacher' ? '/login/teacher' : sub === 'family' ? '/login/family' : '/login';
    return <Navigate to={`${login}?next=${encodeURIComponent(location.pathname)}`} replace />;
  }

  if (auth.role === 'teacher_pending') {
    if (sub !== 'teacher') return <Navigate to="/onboarding/teacher" replace />;
    return (
      <PublicPage narrow footer={false}>
        <TeacherPending />
      </PublicPage>
    );
  }

  if (auth.role) return <Navigate to={homeFor(auth)} replace />;

  return (
    <PublicPage narrow={sub !== ''} footer={false}>
      {sub === 'teacher' ? <TeacherSetup /> : sub === 'family' ? <FamilySetup onLinked={setLinked} /> : <Chooser />}
    </PublicPage>
  );
}
