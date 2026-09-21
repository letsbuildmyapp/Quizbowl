import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';
import { music } from '../lib/music.js';
import { SOUND_ENABLED } from '../lib/sound.js';

/** Picks background music by route for students; silent everywhere else. */
export default function MusicController() {
  const { pathname } = useLocation();
  const { student, isStudent } = useAuth();
  const enabled = SOUND_ENABLED && isStudent && student?.settings?.music !== false && student?.settings?.sound !== false;
  const world = student?.lastWorld || 'science-lab';
  useEffect(() => {
    music.setEnabled(enabled);
    if (!enabled) return;
    if (pathname.startsWith('/play/match/')) music.play('battle', world);
    else if (pathname === '/play' || pathname.startsWith('/play/')) music.play('overworld', world);
    else music.stop();
  }, [pathname, enabled, world]);
  useEffect(() => () => music.stop(), []);
  return null;
}
