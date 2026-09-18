import { useEffect, useState } from 'react';
import {
  addDoc,
  collection,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where
} from 'firebase/firestore';
import { db } from '../firebase.js';
import { useAuth } from '../hooks/useAuth.jsx';

export default function Classroom() {
  const { user, profile } = useAuth();
  const [quizzes, setQuizzes] = useState([]);
  const [title, setTitle] = useState('');
  const isTeacher = profile?.role === 'teacher';

  useEffect(() => {
    if (!user) return;
    const q = isTeacher
      ? query(
          collection(db, 'quizzes'),
          where('ownerUid', '==', user.uid),
          orderBy('createdAt', 'desc')
        )
      : query(collection(db, 'quizzes'), orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snap) => {
      setQuizzes(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
  }, [user, isTeacher]);

  const createQuiz = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    await addDoc(collection(db, 'quizzes'), {
      title: title.trim(),
      ownerUid: user.uid,
      questionIds: [],
      published: false,
      createdAt: serverTimestamp()
    });
    setTitle('');
  };

  return (
    <section className="classroom">
      <header className="classroom-header">
        <h1>Classroom</h1>
        <p className="muted">
          Signed in as <span className="role-pill">{profile?.role ?? 'student'}</span>
          {!isTeacher && ' — ask an admin to promote you to a teacher to author quizzes.'}
        </p>
      </header>

      {isTeacher && (
        <form onSubmit={createQuiz} className="new-quiz">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="New quiz title…"
          />
          <button className="btn btn-primary" type="submit">Create quiz</button>
        </form>
      )}

      <ul className="quiz-list">
        {quizzes.length === 0 && (
          <li className="empty">No quizzes yet. {isTeacher ? 'Create one above.' : 'Check back soon.'}</li>
        )}
        {quizzes.map((q) => (
          <li key={q.id}>
            <span className={`status-dot ${q.published ? 'published' : 'draft'}`}></span>
            <strong>{q.title}</strong>
            <span className="meta">
              {q.questionIds?.length ?? 0} question{q.questionIds?.length === 1 ? '' : 's'}
              {' · '}
              {q.published ? 'Published' : 'Draft'}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
