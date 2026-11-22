import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { PlayCircle, Search } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useQuery } from '../hooks/useQuery';
import { db } from '../services/firebase';
import { deleteRecording, recordingsQuery, updateRecording } from '../services/recordings';
import { Empty, ErrorNote, ListSkeleton, PageHead } from '../components/common/States';
import RecordingRow from '../components/recordings/RecordingRow';
import PlayerModal, { isVideoRec } from '../components/recordings/PlayerModal';
import Modal from '../components/common/Modal';
import { toDate } from '../utils/format';

const PAGE = 30;

function EditRecording({ rec, onClose }) {
  const toast = useToast();
  const [f, setF] = useState({ meetingTitle: rec.meetingTitle || '', description: rec.description || '' });
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await updateRecording(rec.id, { meetingTitle: f.meetingTitle.trim() || 'Recording', description: f.description.trim() }); toast('Recording updated.', 'success'); onClose(); }
    catch { toast('Could not save the changes.', 'error'); setBusy(false); }
  };
  return (
    <Modal title="Edit recording" onClose={onClose}>
      <form className="form" onSubmit={save}>
        <label>Title<input required maxLength={200} value={f.meetingTitle} onChange={(e) => setF({ ...f, meetingTitle: e.target.value })} /></label>
        <label>Description<textarea rows={5} maxLength={4000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Speaker, scripture passages, topics…" /></label>
        <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </form>
    </Modal>
  );
}

export default function Recordings() {
  const { isAdmin, canHost } = useAuth();
  const toast = useToast();
  const { data, loading, error } = useQuery(() => recordingsQuery(), []);
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [type, setType] = useState('all');
  const [sort, setSort] = useState('new');
  const [shown, setShown] = useState(PAGE);
  const [playing, setPlaying] = useState(null);
  const [editing, setEditing] = useState(null);

  // Deep link: /recordings?play=<id> (from notifications and shared links).
  const playId = params.get('play');
  useEffect(() => {
    if (!playId || playing?.id === playId) return;
    const found = data.find((r) => r.id === playId);
    if (found) { setPlaying(found); return; }
    if (!loading) getDoc(doc(db, 'recordings', playId)).then((s) => { if (s.exists()) setPlaying({ id: s.id, ...s.data() }); else toast('That recording is no longer available.', 'error'); }).catch(() => {});
  }, [playId, data, loading]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = (r) => { setPlaying(r); setParams({ play: r.id }, { replace: true }); };
  const close = () => { setPlaying(null); setParams({}, { replace: true }); };

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return data
      .filter((r) => (type === 'all' || (type === 'video') === isVideoRec(r)))
      .filter((r) => !s || `${r.meetingTitle} ${r.hostName || ''} ${r.description || ''} ${toDate(r.createdAt)?.toLocaleDateString([], { month: 'long', year: 'numeric' }) || ''}`.toLowerCase().includes(s))
      .sort((a, b) => (sort === 'title' ? (a.meetingTitle || '').localeCompare(b.meetingTitle || '')
        : ((toDate(a.createdAt)?.getTime() || 0) - (toDate(b.createdAt)?.getTime() || 0)) * (sort === 'old' ? 1 : -1)));
  }, [data, q, type, sort]);
  useEffect(() => setShown(PAGE), [q, type, sort]);

  const remove = async (r) => {
    if (!window.confirm(`Delete "${r.meetingTitle}" permanently? The file will be removed too.`)) return;
    try { await deleteRecording(r); toast('Recording deleted.'); } catch { toast('Could not delete the recording.', 'error'); }
  };

  return (
    <div className="page narrow">
      <PageHead title="Recordings" sub="Listen again to past meetings and teachings." />
      <div className="toolbar">
        <label className="search"><Search size={16} /><input type="search" placeholder="Search by title, speaker or month" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search recordings" /></label>
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Media type"><option value="all">All media</option><option value="audio">Audio</option><option value="video">Video</option></select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort"><option value="new">Newest</option><option value="old">Oldest</option><option value="title">Title</option></select>
      </div>
      <ErrorNote error={error} />
      {loading ? <ListSkeleton rows={5} /> : list.length ? (
        <>
          <ul className="rows">{list.slice(0, shown).map((r) => <RecordingRow key={r.id} r={r} onPlay={open} canDownload={canHost} onEdit={isAdmin ? setEditing : null} onDelete={isAdmin ? remove : null} />)}</ul>
          {list.length > shown && <button className="btn" onClick={() => setShown((n) => n + PAGE)}>Show more ({list.length - shown} left)</button>}
        </>
      ) : <Empty icon={PlayCircle} title={data.length ? 'No matches' : 'No recordings yet'} text={data.length ? 'Try a different search or filter.' : 'Meeting recordings will appear here once a host records one.'} />}
      {playing && <PlayerModal rec={playing} onClose={close} canDownload={canHost} />}
      {editing && <EditRecording rec={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
