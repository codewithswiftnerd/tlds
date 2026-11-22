import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Circle, Crown, Download, Users, WifiOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useMeetingRoom } from '../hooks/useMeetingRoom';
import { useMusic } from '../hooks/useMusic';
import MusicPanel from '../components/meetings/MusicPanel';
import { PageLoader, Spinner } from '../components/common/States';
import PreJoin from '../components/meetings/PreJoin';
import VideoStage from '../components/meetings/VideoStage';
import ControlBar from '../components/meetings/ControlBar';
import AudioSinks from '../components/meetings/AudioSinks';
import Reactions from '../components/meetings/Reactions';
import { ChatPanel, InfoPanel, NotesPanel, PeoplePanel, SettingsPanel } from '../components/meetings/Panels';
import { fmtDuration, toDate } from '../utils/format';

function Message({ title, text, children }) {
  return (
    <div className="room-message"><h1 className="serif">{title}</h1><p className="muted">{text}</p>{children}</div>
  );
}

function Timer({ since }) {
  const [, tick] = useState(0);
  useEffect(() => { const i = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(i); }, []);
  return <span className="mono">{fmtDuration((Date.now() - since) / 1000)}</span>;
}

function UploadBar({ room, light }) {
  if (!room.upload) return null;
  return (
    <div className={`upload-bar ${light ? 'light' : ''}`} role="status">
      {room.upload.error
        ? <>{room.upload.error} <button onClick={room.retryUpload}>Retry</button> <button onClick={room.saveUploadToDevice}><Download size={13} /> Save to device</button></>
        : <>Uploading recording… {room.upload.progress}% Keep this page open.<i style={{ width: `${room.upload.progress}%` }} /></>}
    </div>
  );
}

export default function MeetingRoom() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user, profile, canHost, isAdmin } = useAuth();
  const room = useMeetingRoom(id, user, profile);
  const music = useMusic({ meetingId: id, uid: user.uid, enabled: room.phase === 'joined', serverNow: room.serverNow, activeUid: room.activeUid, canModerate: room.canModerate });
  const [panel, setPanel] = useState(null);
  const [view, setView] = useState('grid');
  const seen = useRef(0);
  const joinedAt = useRef(Date.now());
  const autoSpot = useRef(false);

  useEffect(() => { if (room.phase === 'joined') joinedAt.current = Date.now(); }, [room.phase]);
  // Big meetings: switch to speaker view once, so the speaker is always visible.
  useEffect(() => { if (room.participants.length > 12 && !autoSpot.current) { autoSpot.current = true; setView('spotlight'); } }, [room.participants.length]);
  useEffect(() => { if (panel === 'chat') seen.current = room.messages.length; }, [panel, room.messages.length]);
  const unreadChat = panel === 'chat' ? 0 : Math.max(0, room.messages.filter((m) => m.senderId !== user.uid).length - seen.current);
  // Send the meeting music to the chosen speaker too.
  useEffect(() => { const a = music.audioProps.ref.current; if (a?.setSinkId && room.prefs.speakerId !== undefined) a.setSinkId(room.prefs.speakerId || '').catch(() => {}); }, [room.prefs.speakerId, music.state?.url, music.audioProps.ref]);
  useEffect(() => { document.title = room.meeting?.title ? `${room.meeting.title} · TLDS LIVE` : 'TLDS LIVE'; return () => { document.title = 'TLDS LIVE'; }; }, [room.meeting?.title]);

  const { meeting, phase } = room;
  if (meeting === undefined) return <PageLoader />;
  if (meeting === null) return <Message title="Meeting not found" text="This meeting link is no longer valid. It may have been cancelled."><button className="btn primary" onClick={() => nav('/meetings')}>Back to meetings</button></Message>;
  if (phase === 'removed') return <Message title="You were removed" text="The host removed you from this meeting."><UploadBar room={room} light /><button className="btn primary" onClick={() => nav('/')}>Go home</button></Message>;
  if (phase === 'replaced') return <Message title="Joined elsewhere" text="You joined this meeting from another device or tab."><UploadBar room={room} light /><button className="btn primary" onClick={() => nav('/meetings')}>Back to meetings</button></Message>;
  if (phase === 'dropped') return <Message title="Connection lost" text="We could not reconnect you. Check your internet connection, then rejoin."><UploadBar room={room} light /><div className="row gap"><button className="btn primary" onClick={room.rejoinNow}>Rejoin</button><button className="btn-dark" onClick={() => nav('/meetings')}>Back to meetings</button></div></Message>;
  if (phase === 'left') {
    return (
      <Message title={meeting.status === 'ended' ? 'The meeting has ended' : 'You left the meeting'} text={room.upload && !room.upload.error ? 'Your recording is uploading. Keep this page open until it finishes.' : 'Thanks for joining. God bless you.'}>
        <UploadBar room={room} light />
        <div className="row gap"><button className="btn primary" onClick={() => nav('/')}>Go home</button>{meeting.status === 'live' && <button className="btn-dark" onClick={() => window.location.reload()}>Rejoin</button>}</div>
      </Message>
    );
  }
  if (phase !== 'joined' && phase !== 'rejoining') return <PreJoin room={room} profile={profile} canHost={canHost} />;

  const startedAt = toDate(meeting.startedAt)?.getTime() || joinedAt.current;
  const close = () => setPanel(null);
  const showRec = room.recording.active || (meeting.recording && room.recorderPresent);
  return (
    <div className="room">
      <header className="room-head">
        <span className="room-brand">TLDS LIVE</span>
        <h1>{meeting.title}</h1>
        <span className="live-pill"><span />LIVE</span>
        <Timer since={startedAt} />
        {showRec && (
          <span className="rec-pill" title={room.recording.active ? 'You are recording this meeting' : `${room.recordingByName || 'A moderator'} is recording`}>
            <Circle size={10} fill="currentColor" /> REC{room.recording.active ? <> <Timer since={room.recording.startedAt} /></> : ''}
          </span>
        )}
        {(room.quality === 'poor' || room.quality === 'lost') && <span className="weak-pill" title="Your connection is weak"><WifiOff size={13} /> Weak network</span>}
        {music.state?.url && <button className="music-chip" onClick={() => setPanel('music')} aria-label="Open music panel">&#9835; {music.state.title}{music.state.playing ? '' : ' (paused)'}</button>}
        <span className="grow" />
        <button className="count" onClick={() => setPanel(panel === 'people' ? null : 'people')} aria-label={`${room.participants.length} participants`}><Users size={16} /> {room.participants.length}</button>
      </header>

      {phase === 'rejoining' && <div className="upload-bar warn" role="status"><Spinner label="Reconnecting" /> Connection dropped. Reconnecting you automatically…</div>}
      {phase === 'joined' && room.link === 'reconnecting' && <div className="upload-bar warn" role="status">Connection unstable, reconnecting…</div>}
      {room.canClaimHost && <div className="upload-bar" role="status"><Crown size={13} /> The host has left. <button onClick={() => room.host.claim().catch(() => {})}>Become host</button></div>}
      <UploadBar room={room} />

      <div className={`stage ${panel ? 'with-panel' : ''}`}>
        <VideoStage participants={room.participants} remote={room.remote} localVideo={room.localVideo} uid={user.uid} activeUid={room.activeUid} view={view} onTargets={room.setVideoTargets} dataSaver={!!room.prefs.dataSaver} />
        <Reactions items={room.reactions} />
        {panel === 'chat' && <ChatPanel room={room} uid={user.uid} onClose={close} />}
        {panel === 'people' && <PeoplePanel room={room} uid={user.uid} onClose={close} />}
        {panel === 'info' && <InfoPanel room={room} uid={user.uid} onClose={close} />}
        {panel === 'settings' && <SettingsPanel room={room} onClose={close} />}
        {panel === 'music' && <MusicPanel music={music} canModerate={room.canModerate} canAdd={canHost} isAdmin={isAdmin} profile={profile} onClose={close} />}
        {panel === 'notes' && <NotesPanel room={room} uid={user.uid} onClose={close} />}
      </div>

      <ControlBar room={room} panel={panel} setPanel={setPanel} view={view} setView={setView} unreadChat={unreadChat} />
      <AudioSinks remote={room.remoteAudio} sinkId={room.prefs.speakerId} />
      <audio {...music.audioProps} />
      {music.blocked && <button className="audio-banner" style={{ top: 'calc(104px + var(--safe-t))' }} onClick={music.unblock}>Tap to hear the music</button>}
    </div>
  );
}
