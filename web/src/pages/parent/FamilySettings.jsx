// Family settings: email and notification preferences.
// Reads:  users/{uid} (via useAuth().profile)
// Writes: users/{uid} { prefs: { weeklyEmail, notifications: { badges, weeklySummary } } } (setDoc merge)
import { useState } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../../firebase.js';
import { Card, ErrorNote, Loading, PageHeader, useToast } from '../../components/ui.jsx';
import { useAuth } from '../../hooks/useAuth.jsx';
import './parent.css';

function readPrefs(p = {}) {
  return {
    weeklyEmail: !!p.weeklyEmail,
    notifications: { badges: p.notifications?.badges ?? true, weeklySummary: p.notifications?.weeklySummary ?? true }
  };
}

function Toggle({ id, label, hint, checked, onChange, disabled }) {
  return (
    <div className="fam-toggle-row">
      <label htmlFor={id} className="stack" style={{ gap: 4, cursor: 'pointer' }}>
        <span style={{ fontWeight: 800 }}>{label}</span>
        <span className="muted">{hint}</span>
      </label>
      <input id={id} type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </div>
  );
}

export default function FamilySettings() {
  const { user, profile } = useAuth();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  if (!user) return <Loading full />;
  const prefs = readPrefs(profile?.prefs);

  const save = async (next) => {
    setSaving(true);
    setError(null);
    try {
      await setDoc(doc(db, 'users', user.uid), { prefs: next }, { merge: true });
      toast('Saved');
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page page-narrow stack-xl">
      <PageHeader eyebrow="Settings" title="Family settings" />

      <Card className="stack" aria-labelledby="account-title">
        <h2 id="account-title">Account</h2>
        <div className="stack" style={{ gap: 4 }}>
          <span className="label">Email</span>
          <span style={{ overflowWrap: 'anywhere' }}>{user.email || 'No email on this account'}</span>
        </div>
      </Card>

      <Card className="stack-lg" aria-labelledby="notify-title">
        <div className="stack" style={{ gap: 6 }}>
          <h2 id="notify-title">Updates</h2>
          <p className="muted prose">Summaries celebrate your child's own progress. They never include rankings or classmates.</p>
        </div>
        <Toggle
          id="pref-weekly-email"
          label="Weekly email"
          hint="Send a short summary of the week to your email."
          checked={prefs.weeklyEmail}
          disabled={saving}
          onChange={(v) => save({ ...prefs, weeklyEmail: v })}
        />
        <hr className="divider" />
        <Toggle
          id="pref-badges"
          label="New badges"
          hint="Show a notice here when your child earns a badge."
          checked={prefs.notifications.badges}
          disabled={saving}
          onChange={(v) => save({ ...prefs, notifications: { ...prefs.notifications, badges: v } })}
        />
        <hr className="divider" />
        <Toggle
          id="pref-weekly-summary"
          label="Weekly summary notice"
          hint="Show a notice here when a new weekly summary is ready."
          checked={prefs.notifications.weeklySummary}
          disabled={saving}
          onChange={(v) => save({ ...prefs, notifications: { ...prefs.notifications, weeklySummary: v } })}
        />
        <ErrorNote error={error} />
      </Card>
    </div>
  );
}
