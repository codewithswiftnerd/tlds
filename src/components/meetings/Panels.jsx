import { useEffect, useRef, useState } from 'react';
import { Copy, Crown, ShieldCheck, Hand, Mic, MicOff, MonitorUp, Send, Share2, UserX, X, Check, Trash2, Video, Volume2 } from 'lucide-react';
import Avatar from '../common/Avatar';
import { fmtDateTime, fmtTime } from '../../utils/format';
import { useToast } from '../../context/ToastContext';
import { canChooseSpeaker, listDevices } from '../../services/webrtc';
import { meetingLink } from '../../services/meetings';

export function PanelShell({ title, onClose, children }) {
  return (
    <aside className="panel" aria-label={title}>
      <div className="panel-head"><h2>{title}</h2><button className="icon-btn dark" onClick={onClose} aria-label={`Close ${title}`}><X size={18} /></button></div>
      {children}
    </aside>
  );
}

const linkify = (text) => text.split(/(https?:\/\/[^\s]+)/g).map((part, i) => (/^https?:\/\//.test(part)
  ? <a key={i} href={part} target="_blank" rel="noreferrer noopener">{part}</a> : part));

export function ChatPanel({ room, uid, onClose }) {
  const [text, setText] = useState('');
  const end = useRef(null);
  const toast = useToast();
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [room.messages.length]);
  const send = async (e) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setText('');
    try { await room.sendMessage(t); } catch { setText(t); toast('Message not sent. Check your connection.', 'error'); }
  };
  return (
    <PanelShell title="In-call messages" onClose={onClose}>
      <div className="chat-list">
        {room.messages.length === 0 && <p className="muted center-text">Say hello. Messages stay with this meeting.</p>}
        {room.messages.map((m) => (
          <div key={m.id} className={`msg ${m.senderId === uid ? 'mine' : ''}`}>
            <div className="msg-meta">
              <strong>{m.senderId === uid ? 'You' : m.senderName}</strong> <span>{fmtTime(m.createdAt)}</span>
              {room.canModerate && <button className="msg-del" onClick={() => window.confirm('Delete this message for everyone?') && room.deleteMessage(m.id).catch(() => toast('Could not delete.', 'error'))} aria-label="Delete message"><Trash2 size={12} /></button>}
            </div>
            <div className="msg-text">{linkify(m.text)}</div>
          </div>
        ))}
        <div ref={end} />
      </div>
      <form className="chat-input" onSubmit={send}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Send a message" maxLength={2000} aria-label="Message" enterKeyHint="send" />
        <button className="icon-btn dark" type="submit" aria-label="Send" disabled={!text.trim()}><Send size={18} /></button>
      </form>
    </PanelShell>
  );
}

export function PeoplePanel({ room, uid, onClose }) {
  const { isHost, canModerate, meeting, host, participants } = room;
  const [q, setQ] = useState('');
  const toast = useToast();
  const sorted = [...participants]
    .filter((p) => !q || (p.name || '').toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (b.handRaised ? 1 : 0) - (a.handRaised ? 1 : 0)
      || (a.handRaisedAt?.toMillis?.() ?? 0) - (b.handRaisedAt?.toMillis?.() ?? 0)
      || (b.isHost ? 1 : 0) - (a.isHost ? 1 : 0) || (b.isMod ? 1 : 0) - (a.isMod ? 1 : 0)
      || (a.name || '').localeCompare(b.name || ''));
  const act = (fn) => async () => { try { await fn(); } catch { toast('That did not work. You may no longer have permission.', 'error'); } };
  return (
    <PanelShell title={`Participants (${participants.length})`} onClose={onClose}>
      {room.canClaimHost && (
        <div className="host-tools claim">
          <span className="small">The host has left this meeting.</span>
          <button className="btn primary sm" onClick={act(host.claim)}><Crown size={14} /> Become host</button>
        </div>
      )}
      {canModerate && (
        <div className="host-tools">
          <span className="muted small">Microphones: {room.mode === 'open' ? 'open to everyone' : 'host grants speaking'}{meeting?.everyoneMuted ? ' · everyone muted' : ''}</span>
          <div className="row gap wrap">
            <button className="btn-dark sm" onClick={act(host.muteEveryone)}>Mute everyone</button>
            {meeting?.everyoneMuted && <button className="btn-dark sm" onClick={act(host.allowEveryone)}>Allow all</button>}
            <button className="btn-dark sm" onClick={act(() => host.setMode(room.mode === 'open' ? 'moderated' : 'open'))}>{room.mode === 'open' ? 'Moderate' : 'Open mics'}</button>
            {meeting?.currentSpeakerUid && <button className="btn-dark sm" onClick={act(host.revokeFloor)}>End speaking turn</button>}
          </div>
        </div>
      )}
      {participants.length > 8 && <div className="people-search"><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find someone" aria-label="Find a participant" /></div>}
      <ul className="people">
        {sorted.map((p) => {
          const holding = meeting?.currentSpeakerUid === p.id;
          return (
            <li key={p.id}>
              <Avatar name={p.name} size={32} />
              <div className="people-name">
                <span>{p.id === uid ? 'You' : p.name}</span>
                <small>{p.id === meeting?.hostId ? 'Host' : p.isMod ? 'Moderator' : holding ? 'Has the floor' : p.forceMuted ? 'Muted by host' : p.handRaised ? 'Wants to speak' : ''}</small>
              </div>
              {meeting?.hostId === p.id && <Crown size={14} aria-label="Host" />}
              {p.isMod && p.id !== meeting?.hostId && <ShieldCheck size={14} aria-label="Moderator" />}
              {p.sharing && <MonitorUp size={16} aria-label="Presenting" />}
              {p.camOn && <Video size={15} aria-label="Camera on" className="dim" />}
              {p.handRaised && <Hand size={16} className="hand" aria-label="Hand raised" />}
              {p.muted ? <MicOff size={16} aria-label="Muted" className="dim" /> : <Mic size={16} aria-label="Unmuted" />}
              {canModerate && p.id !== uid && p.id !== meeting?.hostId && (
                <div className="people-actions">
                  {p.handRaised && !holding && <button className="icon-btn dark sm" title="Lower hand" aria-label={`Lower ${p.name}'s hand`} onClick={act(() => host.lowerHand(p.id))}><Hand size={15} /></button>}
                  <button className="icon-btn dark sm" title={p.forceMuted ? 'Unmute' : 'Mute'} aria-label={p.forceMuted ? `Unmute ${p.name}` : `Mute ${p.name}`} onClick={act(() => host.setForceMuted(p.id, !p.forceMuted))}>{p.forceMuted ? <Mic size={15} /> : <MicOff size={15} />}</button>
                  <button className="icon-btn dark sm" title={holding ? 'End speaking turn' : 'Let them speak'} aria-label={holding ? `End speaking turn for ${p.name}` : `Let ${p.name} speak`} onClick={act(() => (holding ? host.revokeFloor() : host.giveFloor(p.id)))}>{holding ? <X size={15} /> : <Check size={15} />}</button>
                  {isHost && (
                    <>
                      <button className="icon-btn dark sm" title={p.isMod ? 'Remove moderator role' : 'Make moderator'} aria-label={p.isMod ? `Remove moderator role from ${p.name}` : `Make ${p.name} a moderator`} onClick={act(() => host.setModerator(p.id, !p.isMod))}><ShieldCheck size={15} /></button>
                      <button className="icon-btn dark sm" title="Make host" aria-label={`Make ${p.name} the host`} onClick={() => { if (window.confirm(`Make ${p.name} the host? You will become a moderator.`)) act(() => host.makeHost(p))(); }}><Crown size={15} /></button>
                    </>
                  )}
                  <button className="icon-btn dark sm danger" title="Remove from meeting" aria-label={`Remove ${p.name}`} onClick={() => window.confirm(`Remove ${p.name} from this meeting? They will not be able to rejoin it.`) && act(() => host.remove(p.id))()}><UserX size={15} /></button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </PanelShell>
  );
}

export function InfoPanel({ room, uid, onClose }) {
  const toast = useToast();
  const m = room.meeting;
  const link = meetingLink(m.id);
  const copy = async () => { try { await navigator.clipboard.writeText(link); toast('Meeting link copied.', 'success'); } catch { toast(link); } };
  const share = async () => { try { await navigator.share({ title: m.title, text: `Join "${m.title}" on TLDS LIVE`, url: link }); } catch { /* cancelled */ } };
  const unmutedOthers = room.participants.filter((p) => p.id !== uid && !p.muted).length;
  const arriving = Object.keys(room.remoteAudio).filter((k) => !k.endsWith(':screen')).length;
  return (
    <PanelShell title="Meeting details" onClose={onClose}>
      <div className="info">
        <h3>{m.title}</h3>
        <p className="muted">Hosted by {m.hostName}</p>
        {m.scheduledFor && <p>{fmtDateTime(m.scheduledFor)}</p>}
        {m.description && <p className="pre">{m.description}</p>}
        <p className="muted small">Microphones: {room.mode === 'open' ? 'everyone can speak' : 'the host grants speaking turns'}</p>
        <div className="row gap wrap">
          <button className="btn-dark" onClick={copy}><Copy size={16} /> Copy link</button>
          {navigator.share && <button className="btn-dark" onClick={share}><Share2 size={16} /> Share</button>}
        </div>
        <div className="audio-check">
          <h3>Connection check</h3>
          <p>Connection: {room.link !== 'connected' ? 'reconnecting…' : room.quality === 'poor' ? 'weak (audio first; video may pause)' : room.quality === 'lost' ? 'very weak' : 'good'}</p>
          <p>Your microphone: {!room.micAllowed ? 'locked (the host controls who speaks)' : !room.micOn ? 'muted by you' : room.micPublished ? 'on and sending' : 'on, but no microphone has started (check browser permission)'}</p>
          <p>Incoming audio: {Math.min(arriving, unmutedOthers)} of {unmutedOthers} unmuted people arriving</p>
          {room.prefs.dataSaver && <p>Data saver is on: other people&apos;s cameras are not downloaded.</p>}
        </div>
      </div>
    </PanelShell>
  );
}

export function SettingsPanel({ room, onClose }) {
  const [dev, setDev] = useState({ mics: [], cams: [], speakers: [] });
  useEffect(() => {
    let alive = true;
    const load = () => listDevices().then((d) => alive && setDev(d));
    load();
    navigator.mediaDevices?.addEventListener?.('devicechange', load);
    return () => { alive = false; navigator.mediaDevices?.removeEventListener?.('devicechange', load); };
  }, []);
  const { prefs } = room;
  const pick = (label, icon, list, value, kind) => (
    <label className="setting">
      <span>{icon}{label}</span>
      {list.length ? (
        <select value={value || ''} onChange={(e) => room.setDevice(kind, e.target.value)}>
          <option value="">System default</option>
          {list.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
        </select>
      ) : <small className="muted">None found (or permission not granted yet)</small>}
    </label>
  );
  return (
    <PanelShell title="Audio and video" onClose={onClose}>
      <div className="info">
        {pick('Microphone', <Mic size={15} />, dev.mics, prefs.micId, 'audioinput')}
        {pick('Camera', <Video size={15} />, dev.cams, prefs.camId, 'videoinput')}
        {canChooseSpeaker() && pick('Speaker', <Volume2 size={15} />, dev.speakers, prefs.speakerId, 'audiooutput')}
        <label className="check"><input type="checkbox" checked={!!prefs.dataSaver} onChange={(e) => room.setDataSaver(e.target.checked)} /> Data saver: don&apos;t download other people&apos;s cameras</label>
        <p className="muted small">Tip: headphones stop echo. On a weak connection, turn your own camera off; audio always comes first.</p>
      </div>
    </PanelShell>
  );
}

export function NotesPanel({ room, uid, onClose }) {
  const [text, setText] = useState(room.notes.text || '');
  const focused = useRef(false);
  const timer = useRef(null);
  useEffect(() => { if (!focused.current || room.notes.updatedBy !== uid) setText(room.notes.text || ''); }, [room.notes.text, room.notes.updatedBy, uid]);
  const change = (v) => { setText(v); clearTimeout(timer.current); timer.current = setTimeout(() => room.saveNotes(v), 600); };
  useEffect(() => () => clearTimeout(timer.current), []);
  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    a.download = `${(room.meeting?.title || 'meeting').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-')}-notes.txt`;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  };
  return (
    <PanelShell title="Shared notes" onClose={onClose}>
      <textarea className="notes" value={text} maxLength={19000} onChange={(e) => change(e.target.value)} onFocus={() => { focused.current = true; }} onBlur={() => { focused.current = false; }} placeholder="Notes everyone in the meeting can see and edit" aria-label="Shared notes" />
      <div className="panel-foot"><button className="btn-dark sm" onClick={download} disabled={!text.trim()}>Download notes</button></div>
    </PanelShell>
  );
}

