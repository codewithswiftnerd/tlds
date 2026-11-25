import { useEffect, useState } from 'react';
import '../../styles/splash.css';

const WORDS = ['MEET,', 'LISTEN,', 'GROW', 'TOGETHER.'];
const NAME = 'TLDS LIVE';
const TOTAL_MS = 8000; // keep in step with the timings in styles/splash.css
const KEY = 'tlds-splash-seen';

function shouldShow() {
  try {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
    return !sessionStorage.getItem(KEY);
  } catch { return true; }
}

/**
 * Animated intro, shown once per visit (each time the app or tab is opened fresh).
 * A ball bounces out the tagline, drops, floods the screen green, the name writes itself in,
 * then the green shrinks away to reveal the white lockup. Tap to skip.
 */
export default function Splash() {
  const [show, setShow] = useState(shouldShow);
  useEffect(() => {
    if (!show) return undefined;
    try { sessionStorage.setItem(KEY, '1'); } catch { /* private mode */ }
    const t = setTimeout(() => setShow(false), TOTAL_MS);
    return () => clearTimeout(t);
  }, [show]);
  if (!show) return null;

  const lockup = (
    <div className="sp-lockup">
      <img className="sp-logo" src="/images/logo.jpg" alt="" width="64" height="64" />
      <span className="sp-name" aria-hidden="true">
        {NAME.split('').map((c, i) => <i key={i} style={{ animationDelay: `${4.65 + i * 0.08}s` }}>{c === ' ' ? ' ' : c}</i>)}
      </span>
    </div>
  );

  return (
    <div className="splash" onClick={() => setShow(false)} role="presentation" aria-label="TLDS LIVE">
      {/* 1. Tagline bounced out word by word */}
      <div className="sp-intro">
        <div className="sp-line">
          {WORDS.map((w, i) => <span key={w} className="sp-word" style={{ animationDelay: `${0.55 + i * 0.6}s` }}>{w}</span>)}
          <span className="sp-runner"><span className="sp-ball" /></span>
        </div>
      </div>
      {/* 2. Light lockup underneath, revealed when the green shrinks away */}
      <div className="sp-light">{lockup}</div>
      {/* 3. The ball drops and floods the screen green, the name writes in */}
      <div className="sp-dark">{lockup}</div>
      <div className="sp-flood" />
      <button type="button" className="sp-skip">Skip</button>
    </div>
  );
}
