import { useEffect, useRef, useState } from 'react';
import {
  Circle, Crown, Gauge, Hand, Info, LayoutGrid, MessageSquare, Mic, MicOff, MonitorUp, MoreVertical, Music, NotebookPen,
  PhoneOff, Settings, SmilePlus, Square, SwitchCamera, Users, Video, VideoOff, Presentation, Upload, Download,
} from 'lucide-react';
import { REACTIONS } from '../../hooks/useMeetingRoom';
import { useMedia } from '../../hooks/useMedia';

function Btn({ label, on, off, danger, badge, onClick, children, disabled, className = '' }) {
  return (
    <button className={`ctl ${on ? 'on' : ''} ${off ? 'off' : ''} ${danger ? 'danger' : ''} ${className}`} onClick={onClick} aria-label={label} title={label} disabled={disabled} aria-pressed={on || undefined}>
      {children}
      {badge ? <span className="ctl-badge">{badge > 9 ? '9+' : badge}</span> : null}
    </button>
  );
}

/** Small popover menu that closes on outside click and Escape. */
function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  return { open, setOpen, ref };
}

export default function ControlBar({ room, panel, setPanel, view, setView, unreadChat }) {
  const more = usePopover();
  const leaveMenu = usePopover();
  const recMenu = usePopover();
  const reactMenu = usePopover();
  const phone = useMedia('(max-width: 700px)');

  const { isHost, canModerate, me } = room;
  const canShare = !!navigator.mediaDevices?.getDisplayMedia && !phone;
  const toggle = (p) => setPanel(panel === p ? null : p);
  const item = (icon, text, fn, extra) => <button role="menuitem" onClick={() => { more.setOpen(false); fn(); }} {...extra}>{icon}{text}</button>;
  const hands = canModerate ? room.participants.filter((p) => p.handRaised).length : 0;
  const othersRecording = room.meeting?.recording && room.recorderPresent && room.meeting.recordingBy !== room.me?.id;

  return (
    <footer className="controls">
      <div className="controls-main">
        <Btn label={room.micOn ? 'Mute microphone' : room.micAllowed ? 'Unmute microphone' : 'Microphone locked by the host'} off={!room.micOn} onClick={room.toggleMic}>
          {room.micOn ? <Mic size={20} /> : <MicOff size={20} />}
        </Btn>
        <Btn label={room.camOn ? 'Turn off camera' : 'Turn on camera'} off={!room.camOn} onClick={room.toggleCam}>
          {room.camOn ? <Video size={20} /> : <VideoOff size={20} />}
        </Btn>
        {canShare && (
          <Btn label={room.sharing ? 'Stop presenting' : 'Present your screen'} on={room.sharing} onClick={room.sharing ? room.stopShare : room.startShare}>
            <MonitorUp size={20} />
          </Btn>
        )}
        <Btn label={me?.handRaised ? 'Lower hand' : 'Raise hand'} on={me?.handRaised} onClick={room.toggleHand}><Hand size={20} /></Btn>
        <div className="menu-wrap" ref={reactMenu.ref}>
          <Btn label="Send a reaction" on={reactMenu.open} onClick={() => reactMenu.setOpen((v) => !v)}><SmilePlus size={20} /></Btn>
          {reactMenu.open && (
            <div className="menu up react-menu" role="menu">
              {REACTIONS.map((e) => <button key={e} role="menuitem" onClick={() => room.react(e)} aria-label={`React ${e}`}>{e}</button>)}
            </div>
          )}
        </div>
        <Btn label="Chat" on={panel === 'chat'} badge={panel === 'chat' ? 0 : unreadChat} onClick={() => toggle('chat')} className="hide-xs"><MessageSquare size={20} /></Btn>
        <Btn label="Participants" on={panel === 'people'} badge={hands} onClick={() => toggle('people')} className="hide-sm"><Users size={20} /></Btn>
        {canModerate && (
          <div className="menu-wrap" ref={recMenu.ref}>
            <Btn
              label={room.recording.active ? 'Stop recording' : othersRecording ? `${room.recordingByName || 'Someone'} is recording` : 'Record this meeting'}
              on={room.recording.active} disabled={!room.recording.active && othersRecording}
              onClick={() => (room.recording.active ? (window.confirm('Stop recording? The file will be uploaded to the library.') && room.stopRecording()) : recMenu.setOpen((v) => !v))}
            >
              {room.recording.active ? <Square size={18} fill="currentColor" /> : <Circle size={20} />}
            </Btn>
            {recMenu.open && !room.recording.active && (
              <div className="menu up" role="menu">
                <p className="menu-note">Recorded on this device and uploaded when you stop. Keep this tab open.</p>
                <button role="menuitem" onClick={() => { recMenu.setOpen(false); room.startRecording({ video: false }); }}><Mic size={16} />Audio only<small>about 30 MB per hour</small></button>
                <button role="menuitem" disabled={!room.recordingSupport.video} onClick={() => { recMenu.setOpen(false); room.startRecording({ video: true }); }}>
                  <Video size={16} />Video and audio<small>{room.recordingSupport.video ? 'speaker view, about 450 MB per hour' : 'not supported in this browser'}</small>
                </button>
              </div>
            )}
          </div>
        )}
        <div className="menu-wrap" ref={more.ref}>
          <Btn label="More options" on={more.open} onClick={() => more.setOpen((v) => !v)} badge={phone && panel !== 'chat' ? unreadChat + hands : 0}><MoreVertical size={20} /></Btn>
          {more.open && (
            <div className="menu up" role="menu">
              <div className="menu-show-xs">{item(<MessageSquare size={16} />, `Chat${unreadChat ? ` (${unreadChat} new)` : ''}`, () => setPanel('chat'))}</div>
              <div className="menu-show-sm">{item(<Users size={16} />, `Participants (${room.participants.length})${hands ? ` · ${hands} hands` : ''}`, () => setPanel('people'))}</div>
              {room.camOn && phone && item(<SwitchCamera size={16} />, 'Switch camera', room.flipCamera)}
              {item(view === 'grid' ? <Presentation size={16} /> : <LayoutGrid size={16} />, view === 'grid' ? 'Speaker view' : 'Grid view', () => setView(view === 'grid' ? 'spotlight' : 'grid'))}
              {item(<Gauge size={16} />, room.prefs.dataSaver ? 'Data saver: on' : 'Data saver (hide cameras)', () => room.setDataSaver(!room.prefs.dataSaver), { 'aria-checked': !!room.prefs.dataSaver })}
              {item(<Settings size={16} />, 'Audio and video settings', () => setPanel('settings'))}
              {item(<Info size={16} />, 'Meeting details', () => setPanel('info'))}
              {item(<Music size={16} />, 'Music', () => setPanel('music'))}
              {item(<NotebookPen size={16} />, 'Shared notes', () => setPanel('notes'))}
              {room.upload?.error && item(<Upload size={16} />, 'Retry recording upload', room.retryUpload)}
              {room.upload?.error && item(<Download size={16} />, 'Save recording to this device', room.saveUploadToDevice)}
              {room.canClaimHost && item(<Crown size={16} />, 'Take over as host', () => window.confirm('The host has left. Become the host of this meeting?') && room.host.claim().catch(() => {}))}
              {canModerate && <hr />}
              {canModerate && item(<MicOff size={16} />, 'Mute everyone', room.host.muteEveryone)}
              {canModerate && room.meeting?.everyoneMuted && item(<Mic size={16} />, 'Allow everyone to speak again', room.host.allowEveryone)}
              {canModerate && item(<Hand size={16} />, room.mode === 'open' ? 'Switch to moderated speaking' : 'Switch to open microphones', () => room.host.setMode(room.mode === 'open' ? 'moderated' : 'open'))}
            </div>
          )}
        </div>
      </div>
      <div className="menu-wrap" ref={leaveMenu.ref}>
        <button className="leave" onClick={() => (isHost ? leaveMenu.setOpen((v) => !v) : room.leave())} aria-label={isHost ? 'Leave or end meeting' : 'Leave meeting'} aria-haspopup={isHost ? 'menu' : undefined} title={isHost ? 'Leave or end meeting' : 'Leave meeting'}>
          <PhoneOff size={20} /><span>{isHost ? 'Leave / End' : 'Leave'}</span>
        </button>
        {leaveMenu.open && isHost && (
          <div className="menu up" role="menu">
            <button role="menuitem" className="end" onClick={() => { leaveMenu.setOpen(false); if (window.confirm('End this meeting for everyone? All participants will be disconnected.')) room.leave({ end: true }); }}><PhoneOff size={16} />End meeting for everyone</button>
            <button role="menuitem" onClick={() => { leaveMenu.setOpen(false); room.leave(); }}>
              Leave, others stay
              <small>{room.participants.some((p) => p.isMod && !p.isHost) ? 'A moderator becomes the host' : room.participants.length > 1 ? 'Tip: make someone a moderator first, so they can manage the meeting' : 'You are the last one here, so the meeting ends'}</small>
            </button>
          </div>
        )}
      </div>
    </footer>
  );
}
