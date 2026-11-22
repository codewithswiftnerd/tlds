import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useQuery } from '../hooks/useQuery';
import { announcementsQuery, CATEGORIES, deleteAnnouncement, removeAttachment, saveAnnouncement, visibleAnnouncements } from '../services/announcements';
import { Empty, ErrorNote, ListSkeleton, PageHead } from '../components/common/States';
import AnnouncementItem from '../components/announcements/AnnouncementItem';
import Modal from '../components/common/Modal';
import { explainError, withTimeout } from '../utils/errors';

const toLocalInput = (d) => (d ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');

function Editor({ existing, onClose }) {
  const { profile } = useAuth();
  const toast = useToast();
  const [f, setF] = useState({
    title: existing?.title || '', body: existing?.body || '', category: existing?.category || 'General',
    pinned: !!existing?.pinned, publishAt: existing?.publishAt ? toLocalInput(existing.publishAt.toDate()) : '',
  });
  const [image, setImage] = useState(null);
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState(existing);

  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      // Never leave the button spinning: if the server has not confirmed within 45 s, say so.
      await withTimeout(saveAnnouncement(profile, current, { ...f, publishAt: f.publishAt ? new Date(f.publishAt) : null, image, files }), 45000);
      toast(existing ? 'Announcement updated.' : 'Announcement published.', 'success');
      onClose();
    } catch (err) { console.error('announcement save failed', err?.code, err); toast(`Could not save the announcement. ${explainError(err)}`, 'error'); setBusy(false); }
  };
  const dropFile = async (path) => {
    try { await removeAttachment(current, path); setCurrent({ ...current, attachments: current.attachments.filter((x) => x.path !== path) }); }
    catch { toast('Could not remove the attachment.', 'error'); }
  };

  return (
    <Modal title={existing ? 'Edit announcement' : 'New announcement'} onClose={onClose} wide>
      <form className="form" onSubmit={submit}>
        <label>Title<input required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
        <label>Message<textarea required rows={6} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></label>
        <div className="two">
          <label>Category<select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></label>
          <label>Publish at (optional)<input type="datetime-local" value={f.publishAt} onChange={(e) => setF({ ...f, publishAt: e.target.value })} /></label>
        </div>
        <label className="check"><input type="checkbox" checked={f.pinned} onChange={(e) => setF({ ...f, pinned: e.target.checked })} /> Pin to the top</label>
        <label>Image<input type="file" accept="image/*" onChange={(e) => setImage(e.target.files[0] || null)} /></label>
        <label>Attachments<input type="file" multiple onChange={(e) => setFiles([...e.target.files])} /></label>
        {current?.attachments?.length > 0 && (
          <ul className="attachments">{current.attachments.map((a) => <li key={a.path}>{a.name} <button type="button" className="link" onClick={() => dropFile(a.path)}>remove</button></li>)}</ul>
        )}
        <p className="muted small">Scheduled posts stay hidden from members until the time passes. Members are notified when you save.</p>
        <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : existing ? 'Save changes' : 'Publish'}</button>
      </form>
    </Modal>
  );
}

export default function Announcements() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const { data, loading, error, retry } = useQuery(announcementsQuery, []);
  const [cat, setCat] = useState('All');
  const [editing, setEditing] = useState(null); // null | {} (new) | announcement
  const list = visibleAnnouncements(data, isAdmin).filter((a) => cat === 'All' || a.category === cat);
  const cats = ['All', ...new Set(data.map((a) => a.category).filter(Boolean))];

  const remove = async (a) => {
    if (!window.confirm('Delete this announcement?')) return;
    try { await deleteAnnouncement(a); toast('Announcement deleted.'); } catch (e) { toast(`Could not delete. ${explainError(e)}`, 'error'); }
  };

  return (
    <div className="page narrow">
      <PageHead title="Announcements" sub="News and updates from the school.">
        {isAdmin && <button className="btn primary" onClick={() => setEditing({})}><Plus size={16} /> New</button>}
      </PageHead>
      {cats.length > 2 && <div className="chips" role="tablist">{cats.map((c) => <button key={c} className={`chip ${cat === c ? 'on' : ''}`} onClick={() => setCat(c)}>{c}</button>)}</div>}
      <ErrorNote error={error} onRetry={retry} />
      {loading ? <ListSkeleton rows={4} /> : list.length ? <div className="stack">{list.map((a) => <AnnouncementItem key={a.id} a={a} admin={isAdmin} onEdit={setEditing} onDelete={remove} />)}</div> : <Empty title="No announcements" text="New announcements will appear here." />}
      {editing && <Editor existing={editing.id ? editing : null} onClose={() => setEditing(null)} />}
    </div>
  );
}
