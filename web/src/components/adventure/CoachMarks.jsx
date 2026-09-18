// First-visit coach marks with Questy the owl. Three steps, skippable, remembered per device.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export const TUTORIAL_KEY = 'quizquest:tutorial_seen:student';

export function tutorialSeen() {
  try {
    return window.localStorage.getItem(TUTORIAL_KEY) === '1';
  } catch {
    return true;
  }
}

function markSeen() {
  try {
    window.localStorage.setItem(TUTORIAL_KEY, '1');
  } catch {
    /* storage blocked: it just shows again next time */
  }
}

const STEPS = [
  { target: 'player', title: 'Walk to a world', body: 'This is your QuizBot. Click a gate or use the arrow keys to walk.' },
  { target: 'gate', title: 'Battle creatures to learn', body: 'Every world has wild creatures and a boss. Answer questions to win.' },
  { target: 'hud', title: 'Open chests for gear', body: 'Collect Quest Stars on the paths to open chests. New gear lands in your Vault.' }
];

export default function CoachMarks({ getRect, onStep, onDone, reducedMotion }) {
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState(null);
  const nextRef = useRef(null);
  const s = STEPS[step];

  const measure = useCallback(() => {
    const r = getRect(s.target);
    setRect(r ? { left: r.left, top: r.top, width: r.width, height: r.height } : null);
  }, [getRect, s.target]);

  useLayoutEffect(() => {
    onStep?.(s.target);
    measure();
    // The camera may glide to the target first; measure again once it settles.
    const t = setTimeout(measure, reducedMotion ? 30 : 700);
    return () => clearTimeout(t);
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  useEffect(() => {
    nextRef.current?.focus({ preventScroll: true });
  }, [step]);

  const finish = () => {
    markSeen();
    onDone();
  };

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && finish();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const bubbleW = Math.min(340, vw - 32);
  let bubble = { left: (vw - bubbleW) / 2, top: vh / 2 - 90 };
  let ring = null;
  if (rect) {
    const pad = 10;
    ring = { left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 };
    const below = rect.top + rect.height + 16;
    const fitsBelow = below + 200 < vh;
    const left = Math.max(16, Math.min(vw - bubbleW - 16, rect.left + rect.width / 2 - bubbleW / 2));
    bubble = { left, top: fitsBelow ? below : Math.max(16, rect.top - 216) };
  }

  return (
    <div className={`adv-coach ${reducedMotion ? 'is-static' : ''}`} role="dialog" aria-modal="true" aria-labelledby="adv-coach-title" aria-describedby="adv-coach-body">
      <div className="adv-coach-scrim" />
      {ring ? <div className="adv-coach-ring" style={ring} /> : null}
      <div className="adv-coach-bubble" style={{ left: bubble.left, top: bubble.top, width: bubbleW }} key={step}>
        <img className="adv-coach-owl" src="/art/owl.png" alt="" width="84" height="76" loading="lazy" decoding="async" />
        <div className="adv-coach-text">
          <span className="adv-coach-step">
            Tip {step + 1} of {STEPS.length}
          </span>
          <strong id="adv-coach-title">{s.title}</strong>
          <p id="adv-coach-body">{s.body}</p>
          <div className="adv-coach-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={finish}>
              Skip
            </button>
            <button type="button" ref={nextRef} className="btn btn-primary btn-sm" onClick={() => (step < STEPS.length - 1 ? setStep(step + 1) : finish())}>
              {step < STEPS.length - 1 ? 'Next' : "Let's go!"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
