import { useMemo, useState } from 'react';
import { HeartHandshake, Plus, Search } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useQuery } from '../hooks/useQuery';
import { approvedQuery, deleteTestimony, mineQuery, submitTestimony, TESTIMONY_CATEGORIES } from '../services/testimonies';
import { Empty, ErrorNote, ListSkeleton, PageHead } from '../components/common/States';
import TestimonyItem from '../components/testimonies/TestimonyItem';
import Modal from '../components/common/Modal';

function ShareModal({ onClose }) {
  const { profile } = useAuth();
  const toast = useToast();
  const [f, setF] = useState({ title: '', body: '', category: TESTIMONY_CATEGORIES[0], file: null });
  const [progress, setProgress] = useState(null);
  const [err, setErr] = useState('');

  const pick = (e) => {
    const file = e.target.files[0];
    if (file && !/^(audio|video)\//.test(file.type)) { setErr('Please choose an audio or video file.'); return; }
    if (file && file.size > 200 * 1024 * 1024) { setErr('That file is larger than 200 MB.'); return; }
    setErr(''); setF({ ...f, file: file || null });
  };
  const submit = async (e) => {
    e.preventDefault(); setErr(''); setProgress(0);
    try {
      await submitTestimony(profile, { ...f, title: f.title.trim(), body: f.body.trim() }, setProgress);
      toast('Thank you for sharing. An administrator will review it before it is published.', 'success');
      onClose();
    } catch (x) { console.error(x); setErr('Could not submit your testimony. Please try again.'); setProgress(null); }
  };
  return (
    <Modal title="Share your testimony" onClose={onClose} wide>
      <form className="form" onSubmit={submit}>
        <label>Title<input required maxLength={200} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
        <label>Category<select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{TESTIMONY_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></label>
        <label>Your testimony<textarea required rows={7} maxLength={10000} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></label>
        <label>Audio or video (optional)<input type="file" accept="audio/*,video/*" onChange={pick} /></label>
        {err && <p className="error-note" role="alert">{err}</p>}
        {progress !== null && f.file && <div className="progress"><i style={{ width: `${progress}%` }} /></div>}
        <p className="muted small">Testimonies are reviewed before they appear in the library.</p>
        <button className="btn primary" disabled={progress !== null}>{progress !== null ? 'Submitting…' : 'Submit for review'}</button>
      </form>
    </Modal>
  );
}

export default function Testimonies() {
  const { profile } = useAuth();
  const toast = useToast();
  const pub = useQuery(() => approvedQuery(), []);
  const mine = useQuery(() => mineQuery(profile.uid), [profile.uid]);
  const [tab, setTab] = useState('browse');
  const [cat, setCat] = useState('All');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return pub.data.filter((t) => (cat === 'All' || t.category === cat) && (!s || `${t.title} ${t.body} ${t.authorName}`.toLowerCase().includes(s)));
  }, [pub.data, cat, q]);

  const remove = async (t) => { if (window.confirm('Delete this submission?')) { try { await deleteTestimony(t); } catch { toast('Could not delete.', 'error'); } } };

  return (
    <div className="page narrow">
      <PageHead title="Testimonies" sub="What God is doing among us.">
        <button className="btn primary" onClick={() => setOpen(true)}><Plus size={16} /> Share yours</button>
      </PageHead>
      <div className="chips"><button className={`chip ${tab === 'browse' ? 'on' : ''}`} onClick={() => setTab('browse')}>Library</button>
        <button className={`chip ${tab === 'mine' ? 'on' : ''}`} onClick={() => setTab('mine')}>My submissions{mine.data.some((t) => t.status === 'pending') ? ' •' : ''}</button></div>
      {tab === 'browse' ? (
        <>
          <div className="toolbar">
            <label className="search"><Search size={16} /><input type="search" placeholder="Search testimonies" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search testimonies" /></label>
            <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category"><option>All</option>{TESTIMONY_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
          </div>
          <ErrorNote error={pub.error} />
          {pub.loading ? <ListSkeleton rows={3} /> : list.length ? <div className="stack">{list.map((t) => <TestimonyItem key={t.id} t={t} />)}</div> : <Empty icon={HeartHandshake} title="No testimonies yet" text="Be the first to share what God has done in your life." />}
        </>
      ) : (
        mine.loading ? <ListSkeleton rows={2} /> : mine.data.length ? <div className="stack">{mine.data.map((t) => <TestimonyItem key={t.id} t={t} showStatus onDelete={t.status === 'pending' ? remove : null} />)}</div> : <Empty title="Nothing submitted yet" text="Your submissions and their review status will show here." />
      )}
      {open && <ShareModal onClose={() => setOpen(false)} />}
    </div>
  );
}
