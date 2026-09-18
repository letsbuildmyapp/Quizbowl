import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, limit, query } from 'firebase/firestore';
import { db } from '../firebase.js';
import QuestionCard from '../components/QuestionCard.jsx';

const SAMPLE_QUESTIONS = [
  {
    id: 'sample-1',
    category: 'Literature',
    difficulty: 'Easy',
    text: 'This American author wrote "The Great Gatsby".',
    answer: 'F. Scott Fitzgerald'
  },
  {
    id: 'sample-2',
    category: 'Science',
    difficulty: 'Medium',
    text: 'This element has the atomic number 79 and is used in fine jewelry.',
    answer: 'Gold'
  },
  {
    id: 'sample-3',
    category: 'History',
    difficulty: 'Easy',
    text: 'This 1969 mission first landed humans on the Moon.',
    answer: 'Apollo 11'
  }
];

export default function Practice() {
  const [questions, setQuestions] = useState([]);
  const [index, setIndex] = useState(0);
  const [answered, setAnswered] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const q = query(collection(db, 'questionBank'), limit(25));
        const snap = await getDocs(q);
        const remote = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setQuestions(remote.length > 0 ? remote : SAMPLE_QUESTIONS);
      } catch {
        setQuestions(SAMPLE_QUESTIONS);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const current = questions[index];
  const stats = useMemo(() => ({
    total: answered.length,
    correct: answered.filter((a) => a.correct).length
  }), [answered]);

  const handleAnswered = (result) => {
    setAnswered((prev) => [...prev, result]);
  };

  const next = () => setIndex((i) => (i + 1) % Math.max(questions.length, 1));

  if (loading) return <p className="muted">Loading questions…</p>;
  if (!current) return <p className="muted">No questions available.</p>;

  const accuracy = stats.total ? Math.round((stats.correct / stats.total) * 100) : 0;

  return (
    <section className="practice">
      <header className="practice-header">
        <h1>Solo Practice</h1>
        <div className="stats">
          <strong>{stats.correct}</strong> / {stats.total} correct
          {stats.total > 0 && <span className="muted">· {accuracy}%</span>}
        </div>
      </header>
      <QuestionCard
        key={current.id + index}
        question={current}
        onAnswered={handleAnswered}
      />
      <div style={{ textAlign: 'right' }}>
        <button className="btn-ghost" onClick={next}>Skip to next →</button>
      </div>
    </section>
  );
}
