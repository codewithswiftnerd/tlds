import { Paperclip, Pin, Pencil, Trash2 } from 'lucide-react';
import { fmtDate, isRecent, toDate } from '../../utils/format';

export default function AnnouncementItem({ a, compact, admin, onEdit, onDelete }) {
  const scheduled = a.publishAt && toDate(a.publishAt).getTime() > Date.now();
  return (
    <article className={`ann ${a.pinned ? 'pinned' : ''}`}>
      <div className="ann-meta">
        {a.pinned && <span className="tag pin"><Pin size={11} /> Pinned</span>}
        {a.category && <span className="tag">{a.category}</span>}
        {!scheduled && isRecent(a.createdAt) && <span className="tag new">New</span>}
        {scheduled && <span className="tag">Scheduled {fmtDate(a.publishAt)}</span>}
        <span className="muted small">{fmtDate(a.publishAt && !scheduled ? a.publishAt : a.createdAt)} · {a.authorName}</span>
      </div>
      <h3>{a.title}</h3>
      <p className={compact ? 'clamp' : 'pre'}>{a.body}</p>
      {!compact && a.image && <img className="ann-img" src={a.image.url} alt="" loading="lazy" />}
      {!compact && a.attachments?.length > 0 && (
        <ul className="attachments">{a.attachments.map((f) => <li key={f.path}><a href={f.url} target="_blank" rel="noreferrer"><Paperclip size={14} /> {f.name}</a></li>)}</ul>
      )}
      {admin && !compact && (
        <div className="row gap">
          <button className="btn ghost sm" onClick={() => onEdit(a)}><Pencil size={14} /> Edit</button>
          <button className="btn ghost sm danger-text" onClick={() => onDelete(a)}><Trash2 size={14} /> Delete</button>
        </div>
      )}
    </article>
  );
}
