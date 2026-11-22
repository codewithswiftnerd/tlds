import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarPlus, Link2, Pencil, Radio, Repeat } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { downloadIcs, endMeeting, meetingLink } from '../../services/meetings';
import { fmtDate, fmtDateTime, toDate } from '../../utils/format';

function startsIn(ts) {
  const d = toDate(ts);
  if (!d) return '';
  const mins = Math.round((d.getTime() - Date.now()) / 60000);
  if (mins < -5) return 'Should have started';
  if (mins <= 0) return 'Starting now';
  if (mins < 60) return `In ${mins} min`;
  if (mins < 24 * 60 && d.getDate() === new Date().getDate()) return 'Today';
  return '';
}

export default function MeetingRow({ m, onCancel, onEdit }) {
  const nav = useNavigate();
  const toast = useToast();
  const { profile, isAdmin, canHost } = useAuth();
  const [, tick] = useState(0);
  useEffect(() => { const i = setInterval(() => tick((n) => n + 1), 60000); return () => clearInterval(i); }, []);
  const live = m.status === 'live';
  const ended = m.status === 'ended';
  const scheduled = m.status === 'scheduled';
  const mine = m.hostId === profile.uid || isAdmin;
  const soon = scheduled ? startsIn(m.scheduledFor) : '';
  const copy = async () => { try { await navigator.clipboard.writeText(meetingLink(m.id)); toast('Meeting link copied. Paste it into your group chat.', 'success'); } catch { toast(meetingLink(m.id)); } };
  const end = async () => {
    if (!window.confirm(`End "${m.title}" for everyone?`)) return;
    try { await endMeeting(m.id); toast('Meeting ended.'); } catch { toast('Could not end the meeting.', 'error'); }
  };
  return (
    <li className="row-item">
      <div className="row-main">
        <div className="row-title">
          {live && <span className="live-tag"><Radio size={12} /> Live</span>}
          {soon && <span className="tag soon">{soon}</span>}
          <strong>{m.title}</strong>
          {m.seriesId && <Repeat size={13} className="muted" aria-label="Weekly series" />}
        </div>
        <p className="muted small">
          {ended ? fmtDate(m.endedAt) : m.scheduledFor ? fmtDateTime(m.scheduledFor) : 'Started now'} · Host: {m.hostName}{m.duration ? ` · ${m.duration}` : ''}
        </p>
        {m.description && <p className="small clamp">{m.description}</p>}
      </div>
      <div className="row-actions">
        {live && <button className="btn primary" onClick={() => nav(`/meetings/${m.id}`)}>Join</button>}
        {live && mine && <button className="btn ghost sm" onClick={end}>End</button>}
        {scheduled && canHost && mine && <button className="btn" onClick={() => nav(`/meetings/${m.id}`)}>Start</button>}
        {scheduled && !(canHost && mine) && <button className="btn ghost sm" onClick={() => nav(`/meetings/${m.id}`)}>Open</button>}
        {!ended && <button className="icon-btn" onClick={copy} aria-label={`Copy link to ${m.title}`} title="Copy link"><Link2 size={16} /></button>}
        {scheduled && <button className="icon-btn" onClick={() => downloadIcs(m)} aria-label={`Add ${m.title} to calendar`} title="Add to calendar"><CalendarPlus size={16} /></button>}
        {scheduled && canHost && mine && onEdit && <button className="icon-btn" onClick={() => onEdit(m)} aria-label={`Edit ${m.title}`} title="Edit"><Pencil size={16} /></button>}
        {scheduled && canHost && mine && onCancel && <button className="btn ghost sm" onClick={() => onCancel(m)}>Cancel</button>}
      </div>
    </li>
  );
}
