import { useEffect, useRef, useState } from 'react';
import { collection } from 'firebase/firestore';
import { CalendarPlus, Mic, MicOff, Video, VideoOff } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Avatar from '../common/Avatar';
import { db } from '../../services/firebase';
import { downloadIcs } from '../../services/meetings';
import { getTracks, insecureContext } from '../../services/webrtc';
import { useQuery } from '../../hooks/useQuery';
import { fmtDateTime, toDate } from '../../utils/format';

const lastChoice = () => { try { return JSON.parse(localStorage.getItem('tlds-prejoin') || '{}'); } catch { return {}; } };

export default function PreJoin({ room, profile, canHost }) {
  const nav = useNavigate();
  const { meeting } = room;
  const [mic, setMic] = useState(() => lastChoice().mic !== false);
  const [cam, setCam] = useState(() => lastChoice().cam === true);
  const live = meeting.status === 'live';
  const inRoom = useQuery(() => (live ? collection(db, 'meetings', meeting.id, 'participants') : null), [meeting.id, live]).data;
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmTakeover, setConfirmTakeover] = useState(false);
  const vid = useRef(null);
  const trackRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      trackRef.current?.stop(); trackRef.current = null;
      if (vid.current) vid.current.srcObject = null;
      if (!cam) { setErr(''); return; }
      const { video, errors } = await getTracks({ mic: false, cam: true, camId: room.prefs.camId });
      if (cancelled) { video?.stop(); return; }
      if (!video) { setErr(errors[0] || ''); setCam(false); return; }
      setErr(''); trackRef.current = video;
      if (vid.current) { vid.current.srcObject = new MediaStream([video]); vid.current.play?.().catch(() => {}); }
    })();
    return () => { cancelled = true; };
  }, [cam]);
  useEffect(() => () => trackRef.current?.stop(), []);

  const ended = meeting.status === 'ended';
  const waiting = meeting.status === 'scheduled' && !canHost;
  const go = async (takeover = false) => {
    trackRef.current?.stop(); trackRef.current = null;
    setBusy(true);
    try { localStorage.setItem('tlds-prejoin', JSON.stringify({ mic, cam })); } catch { /* private mode */ }
    const res = await room.join({ mic, cam, takeover });
    setBusy(false);
    if (res === 'exists') setConfirmTakeover(true);
  };

  return (
    <div className="prejoin">
      <div className="prejoin-preview">
        <div className="tile big">
          <video ref={vid} className={cam && !err ? 'mirror' : 'hidden'} autoPlay playsInline muted />
          {!(cam && !err) && <div className="tile-avatar"><Avatar name={profile.name} size={96} /></div>}
          <div className="prejoin-toggles">
            <button className={`ctl ${mic ? '' : 'off'}`} onClick={() => setMic((v) => !v)} aria-label={mic ? 'Join with microphone off' : 'Join with microphone on'} title="Microphone">{mic ? <Mic size={20} /> : <MicOff size={20} />}</button>
            <button className={`ctl ${cam ? '' : 'off'}`} onClick={() => setCam((v) => !v)} aria-label={cam ? 'Join with camera off' : 'Join with camera on'} title="Camera">{cam ? <Video size={20} /> : <VideoOff size={20} />}</button>
          </div>
        </div>
        {insecureContext() && <p className="error-note dark" role="alert">This page is not on a secure (https) address, so your microphone and camera are blocked. Open the deployed https site instead of an IP address or http link.</p>}
        {err && <p className="error-note dark" role="alert">{err}</p>}
        <p className="muted small center-text">No camera? You can join with just your microphone, or listen only.</p>
      </div>
      <div className="prejoin-info">
        <span className="brand-tag">TLDS LIVE</span>
        <h1 className="serif">{meeting.title}</h1>
        <p className="muted">Hosted by {meeting.hostName}{meeting.scheduledFor ? ` · ${fmtDateTime(meeting.scheduledFor)}` : ''}</p>
        {live && inRoom.length > 0 && (
          <p className="muted small in-room">
            {inRoom.length === 1 ? `${inRoom[0].name || 'Someone'} is here` : `${inRoom.slice(0, 2).map((p) => (p.name || 'Someone').split(' ')[0]).join(', ')}${inRoom.length > 2 ? ` and ${inRoom.length - 2} more are here` : ' are here'}`}
          </p>
        )}
        {live && !inRoom.length && <p className="muted small in-room">No one else is here yet.</p>}
        {ended && <p className="error-note dark">This meeting has ended.</p>}
        {waiting && <p className="muted">Waiting for the host to start this meeting{toDate(meeting.scheduledFor) > new Date() ? ` (${fmtDateTime(meeting.scheduledFor)})` : ''}. This page updates automatically.</p>}
        {meeting.status === 'scheduled' && <button className="link small left" onClick={() => downloadIcs(meeting)}><CalendarPlus size={14} /> Add to my calendar</button>}
        {confirmTakeover ? (
          <div className="takeover">
            <p>You appear to be in this meeting already (another device or an earlier session). Join here instead?</p>
            <div className="row gap"><button className="btn primary" onClick={() => go(true)} disabled={busy}>Join here</button><button className="btn-dark" onClick={() => setConfirmTakeover(false)}>Cancel</button></div>
          </div>
        ) : (
          <div className="row gap wrap">
            <button className="btn primary lg" onClick={() => go(false)} disabled={busy || ended || waiting}>{busy ? 'Joining…' : meeting.status === 'scheduled' ? 'Start meeting' : 'Join now'}</button>
            <button className="btn-dark lg" onClick={() => nav('/meetings')}>Back</button>
          </div>
        )}
      </div>
    </div>
  );
}
