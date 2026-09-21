// Shared helpers for the student area pages (Worlds, Rewards, Progress, Leaderboard,
// Settings, TeamQuest, ReviewDeck).
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase.js';
import { catalog, categoryMeta } from '../../lib/catalog.js';
import { startSession } from '../../lib/game.js';
import { Button, EmptyState, ErrorNote, friendlyError, Loading, useToast } from '../ui.jsx';
import { useAuth } from '../../hooks/useAuth.jsx';
import { useDoc } from '../../hooks/useFirestore.js';

export const STAR_THRESHOLDS = catalog.worldStarThresholds;

/** Stars, correct count and the next goal for one world. */
export function worldProgress(world, student) {
  const correct = student?.stats?.categories?.[world.category]?.correct || 0;
  const stars = student?.worldStars?.[world.id] ?? STAR_THRESHOLDS.filter((t) => correct >= t).length;
  const next = STAR_THRESHOLDS[stars] ?? null;
  const prev = stars > 0 ? STAR_THRESHOLDS[stars - 1] : 0;
  const unlocked = (student?.unlockedWorlds || ['science-lab']).includes(world.id);
  return { correct, stars, next, prev, unlocked };
}

/** Start a match and go to it. `busy` holds the key of the button that started it. */
export function useStartMatch() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const start = useCallback(
    async (key, mode, options) => {
      setBusy(key);
      setError(null);
      try {
        const id = await startSession(mode, options);
        navigate(`/play/match/${id}`);
      } catch (e) {
        setError({ key, message: friendlyError(e) || 'We could not start that match. Try again.' });
        setBusy(null);
      }
    },
    [navigate]
  );
  return { start, busy, error };
}

/** Stars shown with a text equivalent so status never relies on color. */
export function Stars({ count = 0, max = 3, size }) {
  return (
    <span className={`qq-stars ${size === 'lg' ? 'qq-stars-lg' : ''}`} role="img" aria-label={`${count} of ${max} stars`}>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={i < count ? 'on' : 'off'} aria-hidden>
          {i < count ? '★' : '☆'}
        </span>
      ))}
    </span>
  );
}

export function CategoryChip({ category }) {
  if (!category) return null;
  const m = categoryMeta(category);
  return (
    <span className="chip qq-cat-chip" style={{ '--cat': m.color }}>
      <span aria-hidden>{m.emoji}</span>
      {category}
    </span>
  );
}

/** Accessible on/off switch with a visible label. */
export function Switch({ checked, onChange, label, hint, disabled, id }) {
  return (
    <label className="qq-switch-row" htmlFor={id}>
      <span className="stack" style={{ gap: 2 }}>
        <span className="qq-switch-label">{label}</span>
        {hint ? <span className="caption">{hint}</span> : null}
      </span>
      <span className="qq-switch-wrap">
        <span className="qq-switch-state" aria-hidden>
          {checked ? 'On' : 'Off'}
        </span>
        <input
          id={id}
          type="checkbox"
          role="switch"
          className="qq-switch"
          checked={!!checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
      </span>
    </label>
  );
}

/**
 * The spinner every student screen shows while the profile loads, plus a way
 * out when it is never going to arrive (removed from the class, or a read that
 * kept failing). Without this a kid just watches the spinner forever.
 */
export function StudentLoading({ label = 'Loading your adventure…', full = true }) {
  const { claims, studentStatus, signOut } = useAuth();
  if (studentStatus === 'missing') {
    return (
      <div className="page page-narrow">
        <EmptyState emoji="🔎" title="We can't find you in this class" action={<Button variant="primary" size="lg" onClick={signOut}>Sign in again</Button>}>
          Your teacher may have taken you off the roster. Ask your teacher, then sign in again.
        </EmptyState>
      </div>
    );
  }
  if (studentStatus === 'error') {
    return (
      <div className="page page-narrow">
        <EmptyState
          emoji="📡"
          title="We couldn't load your stuff"
          action={
            <div className="row" style={{ justifyContent: 'center' }}>
              <Button variant="primary" size="lg" onClick={() => window.location.reload()}>
                Try again
              </Button>
              <Button size="lg" onClick={signOut}>
                Sign in again
              </Button>
            </div>
          }
        >
          Check that you're connected to the internet, then try again.
        </EmptyState>
      </div>
    );
  }
  return <Loading full={full} label={claims?.studentId ? label : 'Signing you in…'} />;
}

/** Render children only once the signed-in student's doc is loaded. */
export function StudentGate({ children }) {
  const { student } = useAuth();
  if (!student) return <StudentLoading label="Loading your profile…" full={false} />;
  return children(student);
}

/** The student's classroom doc (settings). */
export function useMyClassroom() {
  const { claims } = useAuth();
  return useDoc(claims?.classroomId ? `classrooms/${claims.classroomId}` : null);
}

export const DAY_MS = 86400000;

/** "Show me on the leaderboard" switch bound to students/{id}.leaderboardOptOut. */
export function LeaderboardToggle({ student }) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const onChange = async (show) => {
    setSaving(true);
    setError(null);
    try {
      await updateDoc(doc(db, 'students', student.id), { leaderboardOptOut: !show });
      toast(show ? "You'll show on the leaderboard" : "You're hidden from the leaderboard");
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="stack" style={{ gap: 8 }}>
      <Switch
        id="lb-optout"
        label="Show me on the leaderboard"
        hint="Changes show up after your next quest."
        checked={!student.leaderboardOptOut}
        disabled={saving}
        onChange={onChange}
      />
      <ErrorNote>{error}</ErrorNote>
    </div>
  );
}
