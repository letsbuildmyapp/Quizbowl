import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { Delete } from 'lucide-react';
import { db } from '../../firebase.js';
import { useAuth } from '../../hooks/useAuth.jsx';
import { Avatar, Button, ButtonLink, Card, EmptyState, ErrorNote, Loading, friendlyError } from '../../components/ui.jsx';
import { Owl, PublicPage, safeNext } from '../../components/public/PublicLayout.jsx';

const PIN_LENGTH = 4;
const BUBBLES = {
  1: 'Hoo! Type your class code.',
  2: 'Find your name and tap it.',
  3: 'Now type your secret PIN.'
};
const JOIN_BUBBLES = { 2: 'What should we call you?', 3: 'Pick a PIN you can remember.' };

function StepDots({ step }) {
  return (
    <div className="kid-steps" aria-label={`Step ${step} of 3`} role="img">
      {[1, 2, 3].map((n) => (
        <span key={n} className={n <= step ? 'on' : ''} />
      ))}
    </div>
  );
}

export default function StudentLogin() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next')) || '/play';

  const [step, setStep] = useState(1);
  const [code, setCode] = useState('');
  const [classInfo, setClassInfo] = useState(null);
  const [me, setMe] = useState(null);
  const [joining, setJoining] = useState(false);
  const [newName, setNewName] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [shake, setShake] = useState(false);
  const headingRef = useRef(null);
  const codeRef = useRef(null);
  const nameRef = useRef(null);
  const attempted = useRef(false);
  const submitting = useRef(false);

  useEffect(() => {
    if (step === 1) codeRef.current?.focus();
    else if (step === 2 && joining) nameRef.current?.focus();
    else headingRef.current?.focus();
  }, [step, joining, auth.loading]);

  async function onCode(e) {
    e.preventDefault();
    const clean = code.trim().toUpperCase();
    if (clean.length !== 6) {
      setError('Class codes have 6 letters and numbers.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await auth.ensureAnonymous();
      const snap = await getDoc(doc(db, 'classCodes', clean));
      if (!snap.exists()) {
        setError("That class code doesn't match any class. Check with your teacher.");
        return;
      }
      const data = snap.data();
      if (data.expiresAt && data.expiresAt < Date.now()) {
        setError('That class code has expired. Ask your teacher for a new one.');
        return;
      }
      const roster = [...(data.roster || [])].sort((a, b) => String(a.displayName).localeCompare(String(b.displayName), undefined, { sensitivity: 'base' }));
      setClassInfo({ code: clean, className: data.className, roster, selfJoin: data.selfJoin !== false });
      setStep(2);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  function pickStudent(s) {
    setMe(s);
    setJoining(false);
    setPin('');
    setError(null);
    setStep(3);
  }

  function startJoin() {
    setJoining(true);
    setMe(null);
    setNewName('');
    setPin('');
    setError(null);
  }

  function onName(e) {
    e.preventDefault();
    if (newName.trim().length < 2) {
      setError('Type at least 2 letters.');
      return;
    }
    setError(null);
    setStep(3);
  }

  const submitPin = useCallback(
    async (value) => {
      if (submitting.current || value.length !== PIN_LENGTH) return;
      submitting.current = true;
      setBusy(true);
      setError(null);
      try {
        // Each sign-in request doc is keyed by the device's uid and can only be created once,
        // so a retry needs a fresh anonymous session.
        if (attempted.current) await auth.signOut();
        attempted.current = true;
        if (joining) await auth.studentJoin({ code: classInfo.code, name: newName.trim(), pin: value });
        else await auth.studentSignIn({ code: classInfo.code, studentId: me.id, pin: value });
        navigate(next, { replace: true });
      } catch (err) {
        setError(friendlyError(err));
        setPin('');
        setShake(true);
        setTimeout(() => setShake(false), 450);
      } finally {
        submitting.current = false;
        setBusy(false);
      }
    },
    [auth, classInfo, me, joining, newName, navigate, next]
  );

  const press = useCallback(
    (digit) => {
      if (busy) return;
      setError(null);
      setPin((p) => (p.length >= PIN_LENGTH ? p : p + digit));
    },
    [busy]
  );

  // The fourth digit submits on its own.
  useEffect(() => {
    if (joining || step !== 3 || pin.length !== PIN_LENGTH) return undefined;
    const t = setTimeout(() => submitPin(pin), 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, step, joining]);

  const backspace = useCallback(() => {
    if (!busy) setPin((p) => p.slice(0, -1));
  }, [busy]);

  // Typing digits works anywhere on the PIN step.
  useEffect(() => {
    if (step !== 3) return undefined;
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        press(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        backspace();
      } else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') {
        e.preventDefault();
        submitPin(pin);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, press, backspace, submitPin, pin]);

  if (auth.loading) return <Loading full />;
  if (auth.isStudent) return <Navigate to={next} replace />;

  const adultSignedIn = auth.user && !auth.user.isAnonymous;

  return (
    <PublicPage footer={false}>
      <div className="auth-wrap stack-lg" style={{ maxWidth: step === 2 ? 760 : 560 }}>
        <StepDots step={step} />
        <div className="owl-bubble" style={{ justifyContent: 'center' }}>
          <Owl size={96} />
          <p className="bubble" aria-hidden="true">
            {(joining && JOIN_BUBBLES[step]) || BUBBLES[step]}
          </p>
        </div>

        {adultSignedIn && !auth.isStudent ? (
          <Card className="auth-card stack-lg">
            <h1 ref={headingRef} tabIndex={-1}>
              You’re signed in as an adult
            </h1>
            <p className="muted">Sign out first so a student can sign in on this device.</p>
            <div className="row">
              <Button variant="primary" size="lg" onClick={auth.signOut}>
                Sign out
              </Button>
              <ButtonLink to="/" size="lg" variant="ghost">
                Back to home
              </ButtonLink>
            </div>
          </Card>
        ) : step === 1 ? (
          <Card className="auth-card">
            <form className="stack-lg" onSubmit={onCode} noValidate>
              <h1 ref={headingRef} tabIndex={-1} className="center">
                What’s your class code?
              </h1>
              <div className="field">
                <label htmlFor="class-code" className="sr-only">
                  Class code
                </label>
                <input
                  id="class-code"
                  ref={codeRef}
                  className="input input-lg code-input code-field"
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6));
                    setError(null);
                  }}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  maxLength={6}
                  placeholder="ABC123"
                  aria-describedby="code-hint"
                  aria-invalid={!!error}
                />
                <span id="code-hint" className="hint center">
                  Your teacher has it. It’s 6 letters and numbers.
                </span>
              </div>
              {error ? <ErrorNote>{error}</ErrorNote> : null}
              <Button type="submit" variant="primary" size="xl" block loading={busy} disabled={code.length !== 6}>
                Next
              </Button>
              <ButtonLink to="/login" variant="ghost" size="lg" block>
                Back
              </ButtonLink>
            </form>
          </Card>
        ) : step === 2 && joining ? (
          <Card className="auth-card">
            <form className="stack-lg" onSubmit={onName} noValidate>
              <div className="stack center" style={{ gap: 4 }}>
                <h1 ref={headingRef} tabIndex={-1}>
                  What’s your name?
                </h1>
                {classInfo?.className ? <p className="muted">Joining {classInfo.className}</p> : null}
              </div>
              <div className="field">
                <label htmlFor="join-name" className="sr-only">
                  Your name
                </label>
                <input
                  id="join-name"
                  ref={nameRef}
                  className="input input-lg"
                  value={newName}
                  onChange={(e) => {
                    setNewName(e.target.value.replace(/[^A-Za-z0-9 .'-]/g, '').slice(0, 20));
                    setError(null);
                  }}
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={20}
                  placeholder="Sam R."
                  aria-describedby="join-name-hint"
                  aria-invalid={!!error}
                />
                <span id="join-name-hint" className="hint center">
                  Your first name and last initial works great.
                </span>
              </div>
              {error ? <ErrorNote>{error}</ErrorNote> : null}
              <Button type="submit" variant="primary" size="xl" block disabled={newName.trim().length < 2}>
                Next
              </Button>
              <Button
                size="lg"
                variant="ghost"
                block
                onClick={() => {
                  setJoining(false);
                  setError(null);
                }}
              >
                Back
              </Button>
            </form>
          </Card>
        ) : step === 2 ? (
          <Card className="auth-card stack-lg">
            <div className="stack center" style={{ gap: 4 }}>
              <h1 ref={headingRef} tabIndex={-1}>
                Who are you?
              </h1>
              {classInfo?.className ? <p className="muted">{classInfo.className}</p> : null}
            </div>
            {classInfo?.roster.length ? (
              <ul className="roster" aria-label="Students in this class">
                {classInfo.roster.map((s) => (
                  <li key={s.id}>
                    <button type="button" onClick={() => pickStudent(s)}>
                      <Avatar emoji={s.avatar} size="lg" />
                      {s.displayName}
                    </button>
                  </li>
                ))}
              </ul>
            ) : classInfo?.selfJoin ? null : (
              <EmptyState emoji="🪺" title="No students here yet">
                Ask your teacher to add you to this class.
              </EmptyState>
            )}
            {classInfo?.selfJoin ? (
              <Button variant="primary" size="xl" block onClick={startJoin}>
                ✨ I’m new here
              </Button>
            ) : null}
            <Button
              size="lg"
              variant="ghost"
              block
              onClick={() => {
                setError(null);
                setStep(1);
              }}
            >
              Back
            </Button>
          </Card>
        ) : (
          <Card className="auth-card stack-lg">
            <div className="me-chip">
              <Avatar emoji={joining ? '✨' : me?.avatar} size="lg" />
              <span>{joining ? newName.trim() : me?.displayName}</span>
            </div>
            <h1 ref={headingRef} tabIndex={-1} className="center">
              {joining ? 'Pick a secret PIN' : 'Type your PIN'}
            </h1>
            {joining ? (
              <div className="pin-chosen tabular" aria-label={`Your PIN so far: ${pin.split('').join(' ') || 'empty'}`}>
                {Array.from({ length: PIN_LENGTH }, (_, i) => (
                  <span key={i}>{pin[i] || ''}</span>
                ))}
              </div>
            ) : (
            <div className={`pin-dots ${shake ? 'shake' : ''}`} role="img" aria-label={`${pin.length} of ${PIN_LENGTH} digits entered`}>
              {Array.from({ length: PIN_LENGTH }, (_, i) => (
                <span key={i} className={i < pin.length ? 'filled' : ''} />
              ))}
            </div>
            )}
            <div aria-live="polite" className="stack" style={{ gap: 8 }}>
              {busy ? <Loading label={joining ? 'Setting up your account…' : 'Checking your PIN…'} /> : null}
              {error ? <ErrorNote>{error}</ErrorNote> : null}
            </div>
            <div className="pin-pad" role="group" aria-label="PIN pad">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
                <button key={d} type="button" onClick={() => press(d)} disabled={busy}>
                  {d}
                </button>
              ))}
              <button type="button" className="pin-back" onClick={backspace} disabled={busy || !pin} aria-label="Delete last digit">
                <Delete size={26} aria-hidden />
              </button>
              <button type="button" onClick={() => press('0')} disabled={busy}>
                0
              </button>
              <button type="button" className="pin-go" onClick={() => submitPin(pin)} disabled={busy || pin.length !== PIN_LENGTH}>
                Go
              </button>
            </div>
            <p className="caption center">
              {joining ? 'Remember these 4 numbers. You’ll type them every time you play.' : 'Forgot your PIN? Ask your teacher.'}
            </p>
            <Button
              size="lg"
              variant="ghost"
              block
              onClick={() => {
                setPin('');
                setError(null);
                setStep(2);
              }}
              disabled={busy}
            >
              Back
            </Button>
          </Card>
        )}
      </div>
    </PublicPage>
  );
}
