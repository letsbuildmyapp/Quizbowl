// Adventure (/play): the student's main hub. An island overworld the QuizBot walks
// around; gates open world panels (wild / boss / practice), stars and chests are claimed
// on the map. A list view offers the same info and actions without the map.
// Reads: students/{id} (useAuth), classrooms/{cid}, sessions (mine, active), assignments,
//        assignments/{id}/progress/{sid}, students/{sid}/grants (pending + claimed chest)
// Writes: sessionRequests (startSession), mapClaims/{sid}_{objectId}, analyticsEvents
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { addDoc, collection, doc, getDoc, query, serverTimestamp, where } from 'firebase/firestore';
import { List, Map as MapIcon, RotateCcw, Swords, X } from 'lucide-react';
import { db } from '../../firebase.js';
import { useAuth } from '../../hooks/useAuth.jsx';
import { useDoc, useQuery } from '../../hooks/useFirestore.js';
import { useSchoolTheme } from '../../hooks/useSchoolTheme.js';
import { usePendingGrants } from '../../hooks/usePendingGrants.js';
import { prefersReducedMotion } from '../../hooks/useAccessibility.js';
import { Loading, friendlyError } from '../../components/ui.jsx';
import RewardReveal from '../../components/rewards/RewardReveal.jsx';
import { startSession } from '../../lib/game.js';
import { request } from '../../lib/requests.js';
import { currentLoadout } from '../../lib/rewards.js';
import { dayKey, toMillis } from '../../lib/format.js';
import Overworld from '../../components/adventure/Overworld.jsx';
import WorldPanel from '../../components/adventure/WorldPanel.jsx';
import MapList from '../../components/adventure/MapList.jsx';
import CoachMarks, { tutorialSeen } from '../../components/adventure/CoachMarks.jsx';
import { PlayerCard, QuickLinks } from '../../components/adventure/Hud.jsx';
import { GATE_BY_WORLD, gateInfo, neighbors, startWorld } from '../../components/adventure/mapModel.js';
import '../../components/adventure/adventure.css';

const ACTIVE = ['READY', 'READING_CLUE', 'BUZZ_LOCKED', 'AWAITING_ANSWER', 'SCORED', 'BONUS', 'PAUSED'];
const VIEW_KEY = 'quizquest:adventure_view';
const PANEL_W = 412;
const positions = {}; // where each student's bot stood last, for this tab's lifetime

const readView = () => {
  try {
    return window.localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'map';
  } catch {
    return 'map';
  }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function claimMapObject(studentId, objectId) {
  const id = `${studentId}_${objectId}`;
  try {
    return await request('mapClaims', { objectId }, { id });
  } catch (e) {
    // A finished claim can't be rewritten; read its result instead.
    if (e?.code === 'permission-denied') {
      const d = (await getDoc(doc(db, 'mapClaims', id)).catch(() => null))?.data();
      if (d?.status === 'done') return d.result || { alreadyClaimed: true };
    }
    throw e;
  }
}

function useMedia(q) {
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return m;
}

export default function Adventure() {
  const { student, claims } = useAuth();
  if (!student) return <Loading full label="Loading your adventure..." />;
  return <AdventureHub student={student} sid={claims.studentId} cid={claims.classroomId} />;
}

function AdventureHub({ student, sid, cid }) {
  const navigate = useNavigate();
  const { theme } = useSchoolTheme();
  const { pending } = usePendingGrants();
  const { data: classroom } = useDoc(cid ? `classrooms/${cid}` : null);
  const { data: activeSessions } = useQuery(() => (sid ? query(collection(db, 'sessions'), where('participantIds', 'array-contains', sid), where('status', 'in', ACTIVE)) : null), [sid]);
  const { data: assignments } = useQuery(() => (cid ? query(collection(db, 'assignments'), where('classroomId', '==', cid)) : null), [cid]);

  const ovRef = useRef(null);
  const starRef = useRef(null);
  const hudRef = useRef(null);
  const [view, setView] = useState(readView);
  const [playerWorld, setPlayerWorldState] = useState(() => positions[sid] || startWorld(student));
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(null);
  const [startErr, setStartErr] = useState(null);
  const [entering, setEntering] = useState(null);
  const [flash, setFlash] = useState(false);
  const [busyObject, setBusyObject] = useState(null);
  const [openingChest, setOpeningChest] = useState(null);
  const [notice, setNotice] = useState(null); // { text, tone, retry? }
  const [reveal, setReveal] = useState(null);
  const [starBump, setStarBump] = useState(false);
  const [coach, setCoach] = useState(() => !tutorialSeen());
  const [announce, setAnnounce] = useState('');
  const [hidden, setHidden] = useState(document.hidden);
  const [dailyBusy, setDailyBusy] = useState(false);
  const desktop = useMedia('(min-width: 769px)');

  const reducedMotion = prefersReducedMotion(student.settings) || document.documentElement.dataset.reducedMotion === 'true';
  const rewardsSettings = classroom?.settings?.rewards || {};
  const calm = rewardsSettings.celebrations === 'calm';
  const showStreak = rewardsSettings.showStreaks !== false;
  const loadout = useMemo(() => currentLoadout(student), [student]);

  const setPlayerWorld = useCallback(
    (w) => {
      positions[sid] = w;
      setPlayerWorldState(w);
    },
    [sid]
  );

  useEffect(() => {
    const on = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);

  // ---- Quests badge: live battle, or assignments due that aren't finished ----
  const liveInvite = activeSessions.find((s) => s.mode === 'live_battle');
  const dueIds = useMemo(() => {
    const now = Date.now();
    return assignments
      .filter((a) => !a.archived)
      .filter((a) => {
        const t = a.targets || { type: 'class' };
        return t.type === 'class' || (t.type === 'team' && t.ids?.includes(student.teamId)) || (t.type === 'students' && t.ids?.includes(sid));
      })
      .filter((a) => {
        const due = toMillis(a.dueAt);
        return !due || due > now - 86400000;
      })
      .map((a) => a.id)
      .slice(0, 12)
      .join(',');
  }, [assignments, student.teamId, sid]);
  const [openAssignments, setOpenAssignments] = useState(0);
  useEffect(() => {
    let alive = true;
    const ids = dueIds ? dueIds.split(',') : [];
    Promise.all(ids.map((id) => getDoc(doc(db, `assignments/${id}/progress/${sid}`)).then((s) => (s.data()?.completed ? 0 : 1)).catch(() => 0))).then((r) => alive && setOpenAssignments(r.reduce((a, b) => a + b, 0)));
    return () => {
      alive = false;
    };
  }, [dueIds, sid]);
  const questsAlert = !!liveInvite || openAssignments > 0;
  const questsAlertLabel = liveInvite ? 'live battle now' : `${openAssignments} ${openAssignments === 1 ? 'assignment' : 'assignments'} to do`;

  // ---- world selection + walking ----
  const logSelect = () => addDoc(collection(db, 'analyticsEvents'), { type: 'map_select', createdAt: serverTimestamp() }).catch(() => {});

  const panelFocus = useRef(true);
  const onArrive = useCallback(
    (w) => {
      setPlayerWorld(w);
      setSelected((s) => {
        if (s && s !== w) panelFocus.current = false; // keep focus on the map while walking with arrows
        return s && s !== w ? w : s;
      });
    },
    [setPlayerWorld]
  );

  const selectGate = useCallback(
    (worldId) => {
      logSelect();
      panelFocus.current = true;
      setStartErr(null);
      setSelected(worldId);
      const open = gateInfo(worldId, student).ws.state !== 'locked';
      if (open && worldId !== playerWorld) {
        if (ovRef.current && view === 'map') ovRef.current.walkTo(worldId);
        else setPlayerWorld(worldId);
      }
    },
    [student, playerWorld, view, setPlayerWorld]
  );

  const closePanel = useCallback(() => {
    const w = selected;
    setSelected(null);
    setStartErr(null);
    if (w && view === 'map') setTimeout(() => ovRef.current?.focusGate(w), 0);
  }, [selected, view]);

  // ---- starting battles ----
  const playEnter = async (worldId) => {
    if (reducedMotion) return;
    setEntering(worldId);
    await wait(380);
    setFlash(true);
    await wait(420);
  };

  const startBattle = async (kind) => {
    const world = selected;
    if (!world || busy) return;
    setBusy(kind);
    setStartErr(null);
    try {
      const id = kind === 'practice' ? await startSession('practice', { world, count: 5, readingSpeed: 'manual', untimed: true }) : await startSession('versus', { world, battle: kind });
      await playEnter(world);
      navigate(`/play/match/${id}`);
    } catch (e) {
      setStartErr(e);
      setBusy(null);
      setEntering(null);
      setFlash(false);
    }
  };

  const startDaily = async () => {
    if (dailyBusy) return;
    setDailyBusy(true);
    setNotice(null);
    try {
      const id = await startSession('daily');
      navigate(`/play/match/${id}`);
    } catch (e) {
      setNotice({ text: friendlyError(e), tone: 'error' });
      setDailyBusy(false);
    }
  };

  // ---- claiming stars + chests ----
  const bump = () => {
    setStarBump(true);
    setTimeout(() => setStarBump(false), 650);
  };

  const flyStar = (objectId) => {
    const from = ovRef.current?.rectOf(objectId);
    const to = starRef.current?.getBoundingClientRect();
    if (!from || !to || reducedMotion || !from.width) {
      bump();
      return;
    }
    const el = document.createElement('div');
    el.className = 'adv-flystar';
    el.textContent = '★';
    el.setAttribute('aria-hidden', 'true');
    const fx = from.left + from.width / 2;
    const fy = from.top + from.height / 2;
    el.style.left = `${fx - 20}px`;
    el.style.top = `${fy - 20}px`;
    document.body.appendChild(el);
    const dx = to.left + 18 - fx;
    const dy = to.top + to.height / 2 - fy;
    const anim = el.animate(
      [
        { transform: 'translate(0,0) scale(1)', opacity: 1 },
        { transform: `translate(${dx * 0.35}px, ${dy * 0.35 - 70}px) scale(1.5)`, opacity: 1, offset: 0.4 },
        { transform: `translate(${dx}px, ${dy}px) scale(0.55)`, opacity: 0.9 }
      ],
      { duration: 800, easing: 'cubic-bezier(.45,0,.3,1)' }
    );
    anim.onfinish = () => {
      el.remove();
      bump();
    };
  };

  const claim = async (obj, kind) => {
    if (busyObject) return;
    setBusyObject(obj.id);
    setNotice(null);
    try {
      const res = await claimMapObject(sid, obj.id);
      if (res?.alreadyClaimed) {
        setNotice({ text: kind === 'star' ? 'You already collected that star.' : 'You already opened that chest.', tone: 'info' });
        return;
      }
      if (kind === 'star') {
        flyStar(obj.id);
        setAnnounce(`Quest Star collected! You have ${res?.questStars ?? (student.questStars || 0) + 1}.`);
        return;
      }
      setOpeningChest(obj.id);
      setAnnounce('Chest opened!');
      const [snap] = await Promise.all([res?.grantId ? getDoc(doc(db, `students/${sid}/grants/${res.grantId}`)).catch(() => null) : null, wait(reducedMotion ? 0 : 1100)]);
      if (snap?.exists()) setReveal([{ id: snap.id, ...snap.data() }]);
      else {
        setOpeningChest(null);
        setNotice({ text: 'Chest opened! Your gear is waiting in the Vault.', tone: 'info' });
      }
    } catch (e) {
      setNotice({ text: friendlyError(e), tone: 'error', retry: () => claim(obj, kind) });
    } finally {
      setBusyObject(null);
    }
  };

  const onRevealDone = () => {
    setReveal(null);
    setOpeningChest(null);
  };

  // ---- coach marks ----
  const coachGate = useMemo(() => {
    const open = neighbors(playerWorld).find((w) => gateInfo(w, student).ws.state !== 'locked');
    return open || playerWorld;
  }, [playerWorld, student]);
  const coachRect = useCallback(
    (target) => {
      if (target === 'player') return ovRef.current?.playerRect();
      if (target === 'gate') return ovRef.current?.rectOf(GATE_BY_WORLD[coachGate].id);
      return hudRef.current?.getBoundingClientRect();
    },
    [coachGate]
  );
  const coachStep = (target) => {
    if (target === 'gate') ovRef.current?.centerOn(coachGate, 600);
    if (target === 'player') ovRef.current?.centerOn(playerWorld, 600);
  };

  const changeView = (v) => {
    setView(v);
    try {
      window.localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* ignore */
    }
  };

  const doneToday = student.dailyQuestDay === dayKey();
  const panelOpen = !!selected;
  const consentBlocked = student.consent === 'pending' || student.consent === 'revoked';

  const banners = liveInvite || consentBlocked ? (
    <div className="adv-banners">
      {liveInvite ? (
        <Link to={`/play/match/${liveInvite.id}`} className="adv-live">
          <Swords size={22} aria-hidden />
          <span>
            <strong>Live Team Battle!</strong>
            <small>
              {Object.values(liveInvite.sides || {})
                .map((s) => `${s.emoji || ''} ${s.name}`.trim())
                .join(' vs ')}
            </small>
          </span>
          <span className="adv-live-join">Join</span>
        </Link>
      ) : null}
      {consentBlocked ? <div className="adv-consent">A grown-up in your family needs to say yes before you can battle. Your teacher can help.</div> : null}
    </div>
  ) : null;

  const hud = (
    <PlayerCard ref={starRef} student={student} loadout={loadout} theme={theme} reducedMotion={reducedMotion} showStreak={showStreak} pendingCount={pending.length} starBump={starBump} />
  );

  return (
    <div className={`adv-root ${view === 'list' ? 'is-list' : ''} ${hidden ? 'is-paused' : ''} ${reducedMotion ? 'is-rm' : ''} ${calm ? 'is-calm' : ''} ${panelOpen ? 'has-panel' : ''}`}>
      <h1 className="sr-only">Adventure map</h1>

      {view === 'map' ? (
        <Overworld
          ref={ovRef}
          student={student}
          theme={theme}
          loadout={loadout}
          playerWorld={playerWorld}
          followWorld={selected || playerWorld}
          selectedWorld={selected}
          panelOffset={panelOpen && desktop ? PANEL_W : 0}
          reducedMotion={reducedMotion}
          calm={calm}
          entering={entering}
          busyObject={busyObject}
          openingChest={openingChest}
          onSelectGate={selectGate}
          onArrive={onArrive}
          onClaim={claim}
          onAnnounce={setAnnounce}
        />
      ) : null}

      {view === 'map' ? (
        <>
          <div className="adv-hud-wrap" ref={hudRef}>
            {hud}
          </div>
          <QuickLinks questsAlert={questsAlert} questsAlertLabel={questsAlertLabel} />
        </>
      ) : (
        <div className="adv-list-scroll">
          {banners}
          <div className="adv-list-top">
            <div ref={hudRef}>{hud}</div>
            <QuickLinks questsAlert={questsAlert} questsAlertLabel={questsAlertLabel} />
          </div>
          <MapList student={student} theme={theme} selectedWorld={selected} playerWorld={playerWorld} busyObject={busyObject} reducedMotion={reducedMotion} onSelectGate={selectGate} onClaim={claim} />
        </div>
      )}

      {view === 'map' ? banners : null}

      <div className="adv-bottom">
        <div className="adv-toggle" role="group" aria-label="View">
          <button type="button" aria-pressed={view === 'map'} onClick={() => changeView('map')}>
            <MapIcon size={18} aria-hidden /> Map
          </button>
          <button type="button" aria-pressed={view === 'list'} onClick={() => changeView('list')}>
            <List size={18} aria-hidden /> List
          </button>
        </div>
        {!doneToday ? (
          <button type="button" className="adv-daily" onClick={startDaily} aria-busy={dailyBusy || undefined} disabled={dailyBusy}>
            <span className="adv-daily-star" aria-hidden="true">
              ★
            </span>
            {dailyBusy ? 'Starting...' : "Today's Quest"}
          </button>
        ) : null}
      </div>

      {notice ? (
        <div className={`adv-notice adv-notice--${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>
          <span>{notice.text}</span>
          {notice.retry ? (
            <button type="button" className="btn btn-sm" onClick={notice.retry}>
              <RotateCcw size={14} aria-hidden /> Try again
            </button>
          ) : null}
          <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => setNotice(null)} aria-label="Dismiss message">
            <X size={16} aria-hidden />
          </button>
        </div>
      ) : null}

      {selected ? (
        <WorldPanel
          key={selected}
          worldId={selected}
          student={student}
          theme={theme}
          busy={busy}
          error={startErr}
          reducedMotion={reducedMotion}
          autoFocus={panelFocus.current}
          onStart={startBattle}
          onClose={closePanel}
          onGoTo={(w) => selectGate(w)}
        />
      ) : null}

      {flash ? <div className="adv-flash" aria-hidden="true" style={{ '--flash': theme.primaryColor }} /> : null}

      {coach && view === 'map' && !reveal ? <CoachMarks getRect={coachRect} onStep={coachStep} onDone={() => setCoach(false)} reducedMotion={reducedMotion} /> : null}

      {reveal ? <RewardReveal grants={reveal} studentId={sid} onDone={onRevealDone} theme={theme} reducedMotion={reducedMotion} calm={calm} /> : null}

      <div className="sr-only" aria-live="polite">
        {announce}
      </div>
    </div>
  );
}
