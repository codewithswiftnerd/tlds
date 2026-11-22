import { Share2, Trash2 } from 'lucide-react';
import { fmtDate } from '../../utils/format';
import { useToast } from '../../context/ToastContext';

export default function TestimonyItem({ t, onDelete, showStatus }) {
  const toast = useToast();
  const share = async () => {
    const url = `${window.location.origin}/testimonies`;
    try {
      if (navigator.share) await navigator.share({ title: t.title, text: `${t.title}, a testimony from TLDS`, url });
      else { await navigator.clipboard.writeText(url); toast('Link copied.', 'success'); }
    } catch { /* cancelled */ }
  };
  return (
    <article className="testimony">
      <div className="ann-meta">
        {t.category && <span className="tag">{t.category}</span>}
        {showStatus && <span className={`tag status-${t.status}`}>{t.status}</span>}
        <span className="muted small">{t.authorName} · {fmtDate(t.createdAt)}</span>
      </div>
      <h3 className="serif">{t.title}</h3>
      <p className="pre">{t.body}</p>
      {t.mediaUrl && (t.mediaType === 'video'
        ? <video className="player video" src={t.mediaUrl} controls playsInline preload="metadata" />
        : <audio className="player" src={t.mediaUrl} controls preload="metadata" />)}
      {t.status === 'rejected' && t.rejectReason && <p className="muted small">Reason: {t.rejectReason}</p>}
      <div className="row gap">
        {t.status === 'approved' && <button className="btn ghost sm" onClick={share}><Share2 size={14} /> Share</button>}
        {onDelete && <button className="btn ghost sm danger-text" onClick={() => onDelete(t)}><Trash2 size={14} /> Delete</button>}
      </div>
    </article>
  );
}
