// Family home: linked children, consent prompts, link-a-child form.
// Reads:  guardianLinks (parentUid == uid, status == 'active'), students/{id},
//         sessionSummaries (studentId == id, completedAt this week)
// Writes: parentRequests via request() { type: 'link', code } and { type: 'consent', studentId, grant }
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Avatar, Button, Card, Chip, EmptyState, ErrorNote, Field, Loading, PageHeader, Stat, useToast } from '../../components/ui.jsx';
import ConsentCard from '../../components/parent/ConsentCard.jsx';
import { summarize, useFamily, useWeekSummaries, weekRange } from '../../components/parent/family.js';
import { useAuth } from '../../hooks/useAuth.jsx';
import { request } from '../../lib/requests.js';
import { titleForLevel } from '../../lib/catalog.js';
import './parent.css';

function ChildCard({ child }) {
  const { start, end } = weekRange(0);
  const week = useWeekSummaries(child.id, start, end);
  const s = summarize(week.data, start);
  const streak = child.streak?.current || 0;
  const level = child.level || 1;

  return (
    <Link to={`/family/child/${child.id}`} className="card card-link fam-child-card">
      <div className="fam-child-head">
        <Avatar emoji={child.avatar} size="lg" />
        <div className="stack" style={{ gap: 4, minWidth: 0 }}>
          <span className="fam-child-name">{child.displayName || 'Your child'}</span>
          <span className="muted">
            Level <span className="tabular">{level}</span> {child.title || titleForLevel(level)}
          </span>
        </div>
      </div>
      {child.consent === 'pending' ? <Chip tone="sun">Waiting for your OK</Chip> : null}
      {child.consent === 'revoked' ? <Chip tone="gray">Consent withdrawn</Chip> : null}
      {week.error ? (
        <ErrorNote error={week.error} />
      ) : (
        <div className="fam-child-stats">
          <Stat value={week.loading ? '…' : s.seen} label="Questions this week" color="var(--purple)" />
          <Stat value={week.loading ? '…' : s.accuracy == null ? 'None yet' : `${s.accuracy}%`} label="Accuracy" color="var(--teal)" />
          <Stat value={streak} label="Day streak" color="var(--coral)" />
        </div>
      )}
      <span style={{ color: 'var(--purple)', fontWeight: 800 }}>See this week's summary</span>
    </Link>
  );
}

function LinkChildForm() {
  const { refreshClaims } = useAuth();
  const toast = useToast();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    const clean = code.trim().toUpperCase();
    if (clean.length < 4) {
      setError('Enter the code from your child’s teacher.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await request('parentRequests', { type: 'link', code: clean });
      await refreshClaims();
      setCode('');
      toast(result?.displayName ? `${result.displayName} is linked to your account.` : 'Your child is linked to your account.', { emoji: '🎉' });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card aria-labelledby="link-child-title">
      <form className="stack-lg" onSubmit={submit}>
        <div className="stack" style={{ gap: 6 }}>
          <h2 id="link-child-title">Link a child</h2>
          <p className="muted prose">Enter the family code from your child’s teacher.</p>
        </div>
        <Field label="Family code" hint="Letters and numbers, no spaces.">
          {(id) => (
            <input
              id={id}
              className="input input-lg code-input"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={12}
              placeholder="ABC234"
            />
          )}
        </Field>
        <ErrorNote error={error} />
        <div>
          <Button type="submit" variant="primary" size="lg" loading={busy}>
            Link child
          </Button>
        </div>
      </form>
    </Card>
  );
}

export default function FamilyHome() {
  const { user, profile } = useAuth();
  const family = useFamily(user?.uid);
  const pending = family.children.filter((c) => c.consent === 'pending');
  const firstName = (profile?.displayName || user?.displayName || '').split(' ')[0];

  return (
    <div className="page stack-xl">
      <PageHeader
        eyebrow="My family"
        title={firstName ? `Hi, ${firstName}` : 'Your family'}
        subtitle="See what your kids are learning each week. Summaries cheer progress and never compare kids to classmates."
      />

      {family.loading ? <Loading label="Loading your family…" /> : null}
      {family.error ? <ErrorNote error={family.error} /> : null}

      {pending.map((c) => (
        <ConsentCard key={c.id} child={c} />
      ))}

      {!family.loading && !family.error ? (
        family.children.length ? (
          <section className="stack" aria-labelledby="kids-title">
            <h2 id="kids-title">Your kids</h2>
            <div className="grid-2">
              {family.children.map((c) =>
                c.loading ? (
                  <Card key={c.id}>
                    <Loading label="Loading profile…" />
                  </Card>
                ) : c.missing || c.error ? (
                  <Card key={c.id}>
                    <p className="muted">This profile is no longer available.</p>
                  </Card>
                ) : (
                  <ChildCard key={c.id} child={c} />
                )
              )}
            </div>
          </section>
        ) : (
          <EmptyState emoji="👋" title="No kids linked yet">
            Ask your child’s teacher for a family code, then enter it below.
          </EmptyState>
        )
      ) : null}

      <LinkChildForm />
    </div>
  );
}
