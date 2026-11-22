import { useCallback, useEffect, useRef, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../services/firebase';
import { writeMusicState } from '../services/music';

/**
 * Shared background music. The host/moderators write one small record (track, playing, position, start time);
 * every device plays the same file itself and keeps in step using the shared clock. Music volume dips
 * automatically while anyone is speaking.
 */
export function useMusic({ meetingId, uid, enabled, serverNow, activeUid, canModerate }) {
  const audioRef = useRef(null);
  const [state, setState] = useState(null);
  const [vol, setVolState] = useState(() => { const v = Number(localStorage.getItem('music-vol')); return v > 0 && v <= 1 ? v : 0.8; });
  const [muted, setMuted] = useState(false);
  const [ducked, setDucked] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const cur = useRef(null);
  cur.current = state;

  useEffect(() => {
    if (!enabled) { setState(null); return undefined; }
    return onSnapshot(doc(db, 'meetings', meetingId, 'music', 'state'), (s) => setState(s.exists() ? s.data() : null), () => setState(null));
  }, [meetingId, enabled]);

  const position = useCallback(() => {
    const s = cur.current;
    if (!s) return 0;
    return s.playing ? s.position + (serverNow() - s.startedAtMs) / 1000 : s.position;
  }, [serverNow]);

  const apply = useCallback(() => {
    const a = audioRef.current, s = cur.current;
    if (!a) return;
    if (!s?.url) { a.pause(); if (a.getAttribute('src')) { a.removeAttribute('src'); a.load(); } return; }
    if (a.getAttribute('src') !== s.url) a.src = s.url;
    a.loop = !!s.loop;
    let t = position();
    if (s.loop && a.duration) t %= a.duration;
    if (!s.playing) { a.pause(); if (a.readyState >= 1 && Math.abs(a.currentTime - s.position) > 0.3) a.currentTime = s.position; return; }
    if (a.duration && t > a.duration) { a.pause(); return; }
    if (a.readyState >= 1 && Math.abs(a.currentTime - t) > 0.8) a.currentTime = Math.max(0, t);
    a.play().then(() => setBlocked(false)).catch((e) => { if (e.name === 'NotAllowedError') setBlocked(true); });
  }, [position]);

  useEffect(() => { apply(); }, [state, apply]);
  // Re-check every few seconds so devices that drift get pulled back in step.
  useEffect(() => {
    if (!state?.playing) return undefined;
    const i = setInterval(apply, 5000);
    return () => clearInterval(i);
  }, [state?.playing, state?.url, apply]);

  // Dip the music while somebody talks; come back up 1.2 s after they stop.
  useEffect(() => {
    if (activeUid) { setDucked(true); return undefined; }
    const t = setTimeout(() => setDucked(false), 1200);
    return () => clearTimeout(t);
  }, [activeUid]);
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = muted ? 0 : Math.min(1, vol * (ducked ? 0.25 : 1));
  }, [vol, muted, ducked, state?.url]);

  const keep = () => {
    const c = cur.current || {};
    return { trackId: c.trackId || null, title: c.title || '', url: c.url || '', playing: !!c.playing, position: c.position || 0, startedAtMs: c.startedAtMs || 0, loop: !!c.loop };
  };
  const write = (data) => writeMusicState(meetingId, uid, data);
  const controls = {
    play: (t) => write({ trackId: t.id, title: t.title, url: t.url, playing: true, position: 0, startedAtMs: serverNow(), loop: !!cur.current?.loop }),
    pause: () => write({ ...keep(), playing: false, position: position(), startedAtMs: serverNow() }),
    resume: () => write({ ...keep(), playing: true, startedAtMs: serverNow() }),
    stop: () => write({}),
    seek: (d) => { const dur = audioRef.current?.duration || Infinity; write({ ...keep(), position: Math.max(0, Math.min(dur - 1, position() + d)), startedAtMs: serverNow() }); },
    toggleLoop: () => write({ ...keep(), loop: !cur.current?.loop, position: position(), startedAtMs: serverNow() }),
  };

  return {
    state, blocked, unblock: apply, vol, muted, setMuted, ducked, controls,
    setVol: (v) => { setVolState(v); localStorage.setItem('music-vol', String(v)); },
    audioProps: {
      ref: audioRef, preload: 'auto', onLoadedMetadata: apply,
      onEnded: () => { if (canModerate && !cur.current?.loop) write({ ...keep(), playing: false, position: 0, startedAtMs: serverNow() }).catch(() => {}); },
    },
  };
}
