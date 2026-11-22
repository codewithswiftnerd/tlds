import { useEffect, useRef } from 'react';
import { Hand, MicOff, MonitorUp } from 'lucide-react';
import Avatar from '../common/Avatar';

/** One participant. Video is shown only when the camera or screen share is actually on; otherwise an avatar. */
export default function Tile({ p, stream, isLocal, active, contain, compact }) {
  const ref = useRef(null);
  const live = !!stream && stream.getVideoTracks().length > 0 && (p.camOn || p.sharing);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = live ? stream : null;
    if (live) el.play?.().catch(() => {});
  }, [stream, live]);

  return (
    <div className={`tile ${active ? 'speaking' : ''} ${compact ? 'compact' : ''}`}>
      {/* Audio is played by <AudioSinks/>, so tiles are always muted (and can be paged out safely). */}
      <video ref={ref} className={`${live ? '' : 'hidden'} ${contain || p.sharing ? 'contain' : ''} ${isLocal && !p.sharing ? 'mirror' : ''}`} autoPlay playsInline muted />
      {!live && <div className="tile-avatar"><Avatar name={p.name} size={compact ? 40 : 84} /></div>}
      <div className="tile-label">
        {p.muted && <MicOff size={14} aria-label="Muted" />}
        {p.sharing && <MonitorUp size={14} aria-label="Presenting" />}
        <span>{isLocal ? 'You' : p.name}{p.isHost ? ' (host)' : p.isMod ? ' (moderator)' : ''}</span>
      </div>
      {p.handRaised && <span className="tile-hand" title="Hand raised"><Hand size={16} /></span>}
    </div>
  );
}
