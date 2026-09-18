// Parent consent prompt for a child whose school needs a parent's OK.
// Writes: parentRequests (via request()) { type: 'consent', studentId, grant }
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Avatar, Button, Card, ErrorNote, useToast } from '../ui.jsx';
import { request } from '../../lib/requests.js';

export default function ConsentCard({ child }) {
  const toast = useToast();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const name = child.displayName || 'your child';

  const decide = async (grant) => {
    setBusy(grant ? 'yes' : 'no');
    setError(null);
    try {
      await request('parentRequests', { type: 'consent', studentId: child.id, grant });
      toast(grant ? `Thanks. ${name} is all set.` : 'Saved. You can approve later on the Privacy page.', { emoji: grant ? '✅' : '👍' });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card tone="sun" className="stack-lg" aria-labelledby={`consent-${child.id}`}>
      <div className="row" style={{ gap: 16 }}>
        <Avatar emoji={child.avatar} size="lg" />
        <div className="stack" style={{ gap: 4 }}>
          <span className="eyebrow">Your OK is needed</span>
          <h2 id={`consent-${child.id}`}>Can {name} use QuizQuest?</h2>
        </div>
      </div>
      <div className="stack" style={{ gap: 12 }}>
        <p className="prose">{name}'s school asks for a parent's OK before your child uses QuizQuest.</p>
        <p className="prose" style={{ fontWeight: 800 }}>What QuizQuest keeps:</p>
        <ul className="prose" style={{ margin: 0, paddingLeft: 22, display: 'grid', gap: 6 }}>
          <li>The nickname and avatar the teacher set up</li>
          <li>Practice answers and scores</li>
          <li>Badges and knowledge cards earned</li>
        </ul>
        <p className="prose">No full name, no chat, and no ads. You can change your answer at any time.</p>
        <Link to="/privacy">Read the privacy notice</Link>
      </div>
      <ErrorNote error={error} />
      <div className="row">
        <Button variant="primary" size="lg" onClick={() => decide(true)} loading={busy === 'yes'} disabled={!!busy}>
          Approve
        </Button>
        <Button size="lg" onClick={() => decide(false)} loading={busy === 'no'} disabled={!!busy}>
          Not now
        </Button>
      </div>
    </Card>
  );
}
