import { useState } from 'react';

export default function QuestionCard({ question, onAnswered }) {
  const [guess, setGuess] = useState('');
  const [revealed, setRevealed] = useState(false);

  const check = (e) => {
    e.preventDefault();
    const correct = normalize(guess) === normalize(question.answer);
    setRevealed(true);
    onAnswered?.({ questionId: question.id, guess, correct });
  };

  return (
    <article className="question-card">
      <header>
        <span className="tag">{question.category ?? 'General'}</span>
        {question.difficulty && <span className="tag">{question.difficulty}</span>}
      </header>
      <p className="question-text">{question.text}</p>
      {!revealed ? (
        <form onSubmit={check}>
          <input
            autoFocus
            value={guess}
            onChange={(e) => setGuess(e.target.value)}
            placeholder="Your answer"
          />
          <button type="submit">Submit</button>
        </form>
      ) : (
        <div className="reveal">
          <p>
            <strong>Answer:</strong> {question.answer}
          </p>
          <button onClick={() => { setGuess(''); setRevealed(false); }}>Next</button>
        </div>
      )}
    </article>
  );
}

function normalize(s) {
  return (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}
