// Student settings (/play/settings): accessibility + sound, avatar, nickname request,
// leaderboard visibility. Everything saves as soon as it changes.
// Firestore reads: students/{id} (live, via useAuth), classrooms/{classroomId} (accessibility defaults)
// Firestore writes: students/{id} { 'settings.<key>' } | { avatar } | { nicknameRequest: { name, status: 'pending' } }
//   | { leaderboardOptOut } (LeaderboardToggle)
import { useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase.js';
import { AVATARS, READING_SPEEDS } from '../../lib/catalog.js';
import { SOUND_ENABLED } from '../../lib/sound.js';
import { Avatar, Button, Card, ErrorNote, Field, PageHeader, Segmented, friendlyError, useToast } from '../../components/ui.jsx';
import { LeaderboardToggle, StudentGate, Switch, useMyClassroom } from '../../components/student/common.jsx';
import './student.css';

const SPEEDS = ['slow', 'medium', 'fast'];
const NICK_RE = /^[A-Za-z0-9 ]+$/;

export default function Settings() {
  return <StudentGate>{(student) => <SettingsBody student={student} />}</StudentGate>;
}

function useSave(student) {
  const toast = useToast();
  const [error, setError] = useState(null);
  const save = async (patch, message) => {
    setError(null);
    try {
      await updateDoc(doc(db, 'students', student.id), patch);
      toast(message || 'Saved');
      return true;
    } catch (e) {
      setError(friendlyError(e));
      return false;
    }
  };
  return { save, error };
}

function SettingsBody({ student }) {
  const cls = useMyClassroom();
  const defaults = cls.data?.settings?.accessibility || {};
  const mine = student.settings || {};
  const value = (key, fallback) => mine[key] ?? defaults[key] ?? fallback;
  const { save, error } = useSave(student);

  const setPref = (key, v, label) => save({ [`settings.${key}`]: v }, label);
  const onOff = (v) => (v ? 'on' : 'off');

  return (
    <div className="page page-narrow stack-xl">
      <PageHeader eyebrow="Settings" title="Make it yours" subtitle="Changes save on their own." />
      <ErrorNote>{error}</ErrorNote>

      <Card aria-labelledby="play-h">
        <div className="stack">
          <h2 id="play-h">How questions play</h2>
          <div className="stack" style={{ gap: 8 }}>
            <span className="label">
              Reading speed
            </span>
            <Segmented
              label="Reading speed"
              value={value('readingSpeed', 'medium')}
              onChange={(v) => setPref('readingSpeed', v, `Reading speed: ${READING_SPEEDS[v]?.label || v}`)}
              options={SPEEDS.map((s) => ({ value: s, label: READING_SPEEDS[s]?.label || s }))}
            />
            <span className="caption">How fast clues appear on screen.</span>
          </div>
          <div className="qq-divided">
            <Switch
              id="pref-readAloud"
              label="Read questions aloud"
              hint="Hear each clue as it appears."
              checked={value('readAloud', false)}
              onChange={(v) => setPref('readAloud', v, `Read aloud ${onOff(v)}`)}
            />
            {SOUND_ENABLED ? (
              <>
                <Switch
                  id="pref-sound"
                  label="Sound effects"
                  hint="Buzzer and celebration sounds."
                  checked={value('sound', true)}
                  onChange={(v) => setPref('sound', v, `Sound ${onOff(v)}`)}
                />
                <Switch
                  id="pref-music"
                  label="Music"
                  hint="Adventure and battle music. Turns off with sound effects too."
                  checked={value('music', true)}
                  onChange={(v) => setPref('music', v, `Music ${onOff(v)}`)}
                />
              </>
            ) : null}
          </div>
        </div>
      </Card>

      <Card aria-labelledby="see-h">
        <div className="stack">
          <h2 id="see-h">Easier to see</h2>
          <div className="qq-divided">
            <Switch
              id="pref-largeText"
              label="Large text"
              hint="Makes words bigger everywhere."
              checked={value('largeText', false)}
              onChange={(v) => setPref('largeText', v, `Large text ${onOff(v)}`)}
            />
            <Switch
              id="pref-reducedMotion"
              label="Less motion"
              hint="Turns off moving and bouncing effects."
              checked={value('reducedMotion', false)}
              onChange={(v) => setPref('reducedMotion', v, `Less motion ${onOff(v)}`)}
            />
          </div>
        </div>
      </Card>

      <AvatarPicker student={student} save={save} />
      <NicknameCard student={student} save={save} />

      <Card aria-labelledby="lb-h">
        <div className="stack" style={{ gap: 8 }}>
          <h2 id="lb-h">Leaderboard</h2>
          <LeaderboardToggle student={student} />
        </div>
      </Card>
    </div>
  );
}

function AvatarPicker({ student, save }) {
  const [busy, setBusy] = useState(null);
  const pick = async (a) => {
    if (a === student.avatar) return;
    setBusy(a);
    await save({ avatar: a }, 'Avatar updated');
    setBusy(null);
  };
  return (
    <Card aria-labelledby="avatar-h">
      <div className="stack">
        <div className="row" style={{ gap: 16 }}>
          <Avatar emoji={student.avatar} size="lg" label={`Your avatar ${student.avatar || ''}`} />
          <div className="stack" style={{ gap: 2 }}>
            <h2 id="avatar-h">Avatar</h2>
            <span className="caption">Pick the one that feels like you.</span>
          </div>
        </div>
        <div className="qq-avatars" role="group" aria-labelledby="avatar-h">
          {AVATARS.map((a) => (
            <button
              key={a}
              type="button"
              className="qq-avatar-btn"
              aria-pressed={student.avatar === a}
              aria-label={`Avatar ${a}`}
              disabled={busy != null}
              onClick={() => pick(a)}
            >
              <span aria-hidden>{a}</span>
            </button>
          ))}
        </div>
      </div>
    </Card>
  );
}

function NicknameCard({ student, save }) {
  const req = student.nicknameRequest;
  const [name, setName] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const trimmed = name.trim().replace(/\s+/g, ' ');
  const invalid =
    !trimmed ? 'Type a nickname first.' : trimmed.length < 2 ? 'Use at least 2 characters.' : !NICK_RE.test(trimmed) ? 'Use only letters, numbers, and spaces.' : null;

  const submit = async (e) => {
    e.preventDefault();
    setTouched(true);
    if (invalid) return;
    setBusy(true);
    const ok = await save({ nicknameRequest: { name: trimmed, status: 'pending' } }, 'Nickname sent to your teacher');
    setBusy(false);
    if (ok) {
      setName('');
      setTouched(false);
    }
  };

  return (
    <Card aria-labelledby="nick-h">
      <form className="stack" onSubmit={submit} noValidate>
        <div className="stack" style={{ gap: 4 }}>
          <h2 id="nick-h">Nickname</h2>
          <p className="muted">
            You're <strong>{student.displayName}</strong> right now. Ask for a new name, and your teacher decides if it works.
          </p>
        </div>

        {req?.status === 'pending' ? (
          <div className="alert alert-info" role="status">
            <span aria-hidden className="qq-ico">⏳</span>Waiting for your teacher to approve "{req.name}".
          </div>
        ) : null}
        {req?.status === 'approved' ? (
          <div className="alert alert-success" role="status">
            <span aria-hidden className="qq-ico">✓</span>Approved! Your teacher said yes to "{req.name}".
          </div>
        ) : null}
        {req?.status === 'rejected' ? (
          <div className="alert alert-error" role="status">
            Your teacher didn't approve "{req.name}". Try a different one.
          </div>
        ) : null}

        <Field label={req?.status === 'pending' ? 'Change your request' : 'New nickname'} hint={`Letters, numbers, and spaces. ${trimmed.length}/24`} error={touched ? invalid : null}>
          {(id) => (
            <input
              id={id}
              className="input"
              value={name}
              maxLength={24}
              autoComplete="off"
              aria-invalid={touched && !!invalid}
              onChange={(e) => setName(e.target.value.replace(/[^A-Za-z0-9 ]/g, '').slice(0, 24))}
            />
          )}
        </Field>
        <Button type="submit" variant="primary" size="lg" loading={busy} style={{ alignSelf: 'flex-start' }}>
          Send to my teacher
        </Button>
      </form>
    </Card>
  );
}
