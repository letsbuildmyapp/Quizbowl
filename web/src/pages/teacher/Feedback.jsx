// Pilot feedback form.
// Firestore reads: classrooms (via useClassroom).
// Firestore writes: feedback/{auto} { uid, role: 'teacher', schoolId, classroomId, rating, message, createdAt: ts }.
import { useState } from 'react';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase.js';
import { useAuth } from '../../hooks/useAuth.jsx';
import { useClassroom } from '../../hooks/useClassroom.js';
import { Button, ButtonLink, Card, ErrorNote, Field, Segmented, friendlyError } from '../../components/ui.jsx';
import { TeacherHeader } from '../../components/teacher/TeacherPage.jsx';

const RATINGS = [
  { value: 1, label: '1' },
  { value: 2, label: '2' },
  { value: 3, label: '3' },
  { value: 4, label: '4' },
  { value: 5, label: '5' }
];

export default function Feedback() {
  const { user, claims } = useAuth();
  const cls = useClassroom();
  const [rating, setRating] = useState(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!rating) return setError('Pick a rating from 1 to 5.');
    if (!message.trim()) return setError('Add a short note so we know what to fix or keep.');
    setBusy(true);
    setError(null);
    try {
      await addDoc(collection(db, 'feedback'), {
        uid: user.uid,
        role: 'teacher',
        schoolId: claims.schoolId || null,
        classroomId: cls.classroomId || null,
        rating,
        message: message.trim(),
        createdAt: serverTimestamp()
      });
      setSent(true);
      setRating(null);
      setMessage('');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page page-narrow stack-lg">
      <TeacherHeader cls={cls} title="Pilot feedback" subtitle="Tell us what works and what gets in your way." />
      {sent ? (
        <Card tone="teal" className="stack">
          <h2>Thanks, we got it</h2>
          <p className="prose">We read every note during the pilot.</p>
          <div className="row">
            <Button onClick={() => setSent(false)}>Send more feedback</Button>
            <ButtonLink to="/teach" variant="primary">
              Back to dashboard
            </ButtonLink>
          </div>
        </Card>
      ) : (
        <Card>
          <form className="stack-lg" onSubmit={submit}>
            <div className="field">
              <span className="label" id="fb-rating">
                How is QuizQuest working for your class? (1 = not well, 5 = great)
              </span>
              <Segmented label="Rating from 1 to 5" value={rating} onChange={setRating} options={RATINGS} />
            </div>
            <Field label="Your note" hint="Skip student names. Aliases are fine.">
              {(id) => <textarea id={id} className="textarea" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={4000} />}
            </Field>
            {error ? <ErrorNote>{error}</ErrorNote> : null}
            <div className="row">
              <Button type="submit" variant="primary" loading={busy}>
                Send feedback
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
