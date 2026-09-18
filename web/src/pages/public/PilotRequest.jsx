import { useState } from 'react';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase.js';
import { Button, ButtonLink, Card, ErrorNote, Field, PageHeader } from '../../components/ui.jsx';
import { Owl, PublicPage } from '../../components/public/PublicLayout.jsx';

const ROLES = ['Teacher', 'Coach', 'School admin', 'Parent', 'Other'];
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const EMPTY = { name: '', role: 'Teacher', school: '', email: '', students: '', message: '' };

function validate(f) {
  const e = {};
  if (!f.name.trim()) e.name = 'Enter your name.';
  else if (f.name.trim().length > 120) e.name = 'Keep your name under 120 characters.';
  if (!f.email.trim()) e.email = 'Enter your email.';
  else if (!EMAIL_RE.test(f.email.trim()) || f.email.trim().length > 200) e.email = 'That email doesn’t look right.';
  if (f.school.trim().length > 200) e.school = 'Keep the school name under 200 characters.';
  if (f.message.length > 3000) e.message = 'Keep your message under 3,000 characters.';
  return e;
}

export default function PilotRequest() {
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    if (errors[key]) setErrors((x) => ({ ...x, [key]: undefined }));
  };

  async function onSubmit(e) {
    e.preventDefault();
    const found = validate(form);
    setErrors(found);
    if (Object.keys(found).length) {
      document.getElementById(`pilot-${Object.keys(found)[0]}`)?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await addDoc(collection(db, 'pilotRequests'), {
        name: form.name.trim(),
        role: form.role,
        school: form.school.trim(),
        email: form.email.trim(),
        students: form.students.trim().slice(0, 20),
        message: form.message.trim(),
        createdAt: serverTimestamp()
      });
      setSent(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <PublicPage narrow>
        <Card className="auth-card stack-lg" style={{ alignItems: 'center', textAlign: 'center' }}>
          <Owl size={120} />
          <h1 role="status">Thanks, {form.name.trim().split(' ')[0]}!</h1>
          <p className="muted prose">We got your request and will email {form.email.trim()} soon.</p>
          <ButtonLink to="/" variant="primary" size="lg">
            Back to home
          </ButtonLink>
        </Card>
      </PublicPage>
    );
  }

  return (
    <PublicPage narrow>
      <div className="stack-xl">
        <PageHeader eyebrow="Pilot" title="Request a pilot" subtitle="Tell us about your class. We’ll reply by email with next steps." />
        <Card className="auth-card">
          <form className="stack-lg" onSubmit={onSubmit} noValidate>
            <Field label="Your name" error={errors.name} id="pilot-name">
              {(id) => <input id={id} className="input" value={form.name} onChange={set('name')} autoComplete="name" maxLength={120} aria-invalid={!!errors.name} required />}
            </Field>
            <Field label="Role" id="pilot-role">
              {(id) => (
                <select id={id} className="select" value={form.role} onChange={set('role')}>
                  {ROLES.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="School" hint="Optional" error={errors.school} id="pilot-school">
              {(id) => <input id={id} className="input" value={form.school} onChange={set('school')} autoComplete="organization" maxLength={200} aria-invalid={!!errors.school} />}
            </Field>
            <Field label="Email" error={errors.email} id="pilot-email">
              {(id) => (
                <input id={id} type="email" className="input" value={form.email} onChange={set('email')} autoComplete="email" maxLength={200} aria-invalid={!!errors.email} required />
              )}
            </Field>
            <Field label="About how many students?" hint="Optional" id="pilot-students">
              {(id) => <input id={id} className="input" value={form.students} onChange={set('students')} inputMode="numeric" maxLength={20} placeholder="e.g. 25" />}
            </Field>
            <Field label="Anything else we should know?" hint="Optional" error={errors.message} id="pilot-message">
              {(id) => (
                <textarea
                  id={id}
                  className="textarea"
                  value={form.message}
                  onChange={set('message')}
                  maxLength={3000}
                  aria-invalid={!!errors.message}
                  placeholder="Grades, how often your team practices, what you'd like to try"
                />
              )}
            </Field>
            <ErrorNote error={error} />
            <Button type="submit" variant="primary" size="lg" block loading={busy}>
              Send request
            </Button>
          </form>
        </Card>
      </div>
    </PublicPage>
  );
}
