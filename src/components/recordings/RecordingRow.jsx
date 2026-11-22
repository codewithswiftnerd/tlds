import { Download, Film, Mic, Pencil, Play, Trash2 } from 'lucide-react';
import { fmtDate, fmtDuration } from '../../utils/format';
import { isVideoRec, progressKey } from './PlayerModal';

export default function RecordingRow({ r, onPlay, onDelete, onEdit, canDownload, compact }) {
  const video = isVideoRec(r);
  const saved = Number(localStorage.getItem(progressKey(r.id)) || 0);
  const pct = saved && r.durationSec ? Math.min(100, Math.round((saved / r.durationSec) * 100)) : 0;
  return (
    <li className="row-item">
      {r.posterUrl && !compact
        ? <button className="rec-thumb" onClick={() => onPlay(r)} aria-label={`Play ${r.meetingTitle}`}><img src={r.posterUrl} alt="" loading="lazy" /><Play size={18} fill="currentColor" /></button>
        : <button className="play-btn" onClick={() => onPlay(r)} aria-label={`Play ${r.meetingTitle}`}><Play size={18} fill="currentColor" /></button>}
      <div className="row-main">
        <strong>{r.meetingTitle || 'Recording'}</strong>
        <p className="muted small">
          {fmtDate(r.recordedAt || r.createdAt)}{r.durationSec ? ` · ${fmtDuration(r.durationSec)}` : ''}{r.hostName ? ` · ${r.hostName}` : ''} · {video ? <><Film size={12} /> Video</> : <><Mic size={12} /> Audio</>}
          {saved > 5 && !compact ? ` · resume at ${fmtDuration(saved)}` : ''}
        </p>
        {!compact && pct > 0 && <div className="progress thin" aria-label={`${pct}% listened`}><i style={{ width: `${pct}%` }} /></div>}
        {!compact && r.description && <p className="small clamp">{r.description}</p>}
      </div>
      {!compact && (
        <div className="row-actions">
          {canDownload && <a className="icon-btn" href={r.url} download target="_blank" rel="noreferrer" aria-label={`Download ${r.meetingTitle}`} title="Download"><Download size={16} /></a>}
          {onEdit && <button className="icon-btn" onClick={() => onEdit(r)} aria-label={`Edit ${r.meetingTitle}`} title="Edit title and description"><Pencil size={16} /></button>}
          {onDelete && <button className="icon-btn danger-text" onClick={() => onDelete(r)} aria-label={`Delete ${r.meetingTitle}`} title="Delete"><Trash2 size={16} /></button>}
        </div>
      )}
    </li>
  );
}
