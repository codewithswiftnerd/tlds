import { useEffect, useRef, useState } from 'react';
import { Download, RotateCcw, RotateCw, Share2 } from 'lucide-react';
import Modal from '../common/Modal';
import { Spinner } from '../common/States';
import { useToast } from '../../context/ToastContext';
import { fmtDate, fmtDuration } from '../../utils/format';

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];
export const progressKey = (id) => `rec-progress:${id}`;
export const isVideoRec = (r) => r.mediaType === 'video' || r.contentType?.startsWith('video');

/**
 * Audio/video playback: resumes where the member stopped, speed control, 15 s back / 30 s forward,
 * and lock-screen / headphone controls on phones (Media Session API).
 */
export default function PlayerModal({ rec, onClose, canDownload }) {
  const toast = useToast();
  const ref = useRef(null);
  const lastSave = useRef(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [speed, setSpeed] = useState(() => Number(localStorage.getItem('rec-speed')) || 1);
  const video = isVideoRec(rec);
  const key = progressKey(rec.id);
  const Tag = video ? 'video' : 'audio';

  const save = () => {
    const el = ref.current;
    if (!el) return;
    const d = el.duration || rec.durationSec || Infinity;
    if (el.currentTime > 5 && el.currentTime < d - 10) localStorage.setItem(key, String(Math.floor(el.currentTime)));
    else if (el.currentTime >= d - 10) localStorage.removeItem(key);
  };
  useEffect(() => () => save(), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (ref.current) ref.current.playbackRate = speed; localStorage.setItem('rec-speed', String(speed)); }, [speed]);

  const skip = (s) => { const el = ref.current; if (el) el.currentTime = Math.max(0, Math.min((el.duration || Infinity) - 0.5, el.currentTime + s)); };

  useEffect(() => {
    const ms = navigator.mediaSession;
    if (!ms || typeof window.MediaMetadata === 'undefined') return undefined;
    ms.metadata = new window.MediaMetadata({
      title: rec.meetingTitle || 'Recording', artist: rec.hostName || 'TLDS LIVE', album: 'TLDS LIVE',
      artwork: [{ src: rec.posterUrl || '/images/favicon-512.png', sizes: '512x512', type: rec.posterUrl ? 'image/jpeg' : 'image/png' }],
    });
    const set = (a, fn) => { try { ms.setActionHandler(a, fn); } catch { /* unsupported action */ } };
    set('seekbackward', () => skip(-15));
    set('seekforward', () => skip(30));
    set('play', () => ref.current?.play());
    set('pause', () => ref.current?.pause());
    set('seekto', (d) => { if (ref.current && d.seekTime != null) ref.current.currentTime = d.seekTime; });
    return () => { ['seekbackward', 'seekforward', 'play', 'pause', 'seekto'].forEach((a) => set(a, null)); ms.metadata = null; };
  }, [rec]); // eslint-disable-line react-hooks/exhaustive-deps

  const share = async () => {
    const url = `${window.location.origin}/recordings?play=${rec.id}`;
    try {
      if (navigator.share) await navigator.share({ title: rec.meetingTitle, text: `Listen to "${rec.meetingTitle}" on TLDS LIVE`, url });
      else { await navigator.clipboard.writeText(url); toast('Link copied. Members can open it after signing in.', 'success'); }
    } catch { /* cancelled */ }
  };

  return (
    <Modal title={rec.meetingTitle || 'Recording'} onClose={onClose} wide>
      <p className="muted small player-meta">{fmtDate(rec.recordedAt || rec.createdAt)}{rec.hostName ? ` · ${rec.hostName}` : ''}{rec.durationSec ? ` · ${fmtDuration(rec.durationSec)}` : ''}</p>
      {loading && !error && <div className="center-text"><Spinner label="Loading media" /></div>}
      {error && <p className="error-note">{error}</p>}
      {!video && rec.posterUrl && <img className="player-art" src={rec.posterUrl} alt="" />}
      <Tag
        ref={ref} src={rec.url} controls autoPlay playsInline preload="metadata" poster={video ? rec.posterUrl || undefined : undefined}
        className={`player ${video ? 'video' : ''}`} controlsList={canDownload ? undefined : 'nodownload'}
        onLoadedMetadata={(e) => { const t = Number(localStorage.getItem(key) || 0); if (t) { e.target.currentTime = t; toast(`Resuming at ${fmtDuration(t)}`); } e.target.playbackRate = speed; }}
        onCanPlay={() => setLoading(false)}
        onTimeUpdate={() => { if (Date.now() - lastSave.current > 5000) { lastSave.current = Date.now(); save(); } }}
        onPause={save}
        onEnded={() => localStorage.removeItem(key)}
        onError={() => { setLoading(false); setError('This recording could not be played. It may have been removed, or your connection dropped. Try again in a moment.'); }}
      />
      <div className="player-bar">
        <button className="btn sm" onClick={() => skip(-15)} aria-label="Back 15 seconds"><RotateCcw size={14} /> 15s</button>
        <button className="btn sm" onClick={() => skip(30)} aria-label="Forward 30 seconds">30s <RotateCw size={14} /></button>
        <label className="speed">Speed
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Playback speed">{SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}</select>
        </label>
        <span className="grow" />
        <button className="btn ghost sm" onClick={share}><Share2 size={14} /> Share</button>
        {canDownload && <a className="btn ghost sm" href={rec.url} download target="_blank" rel="noreferrer"><Download size={14} /> Download</a>}
      </div>
      {rec.description && <p className="pre small player-desc">{rec.description}</p>}
    </Modal>
  );
}
