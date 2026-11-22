import { useCallback, useEffect, useState } from 'react';
import { collection, doc, getCountFromServer, orderBy, query, updateDoc, where } from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useQuery } from '../hooks/useQuery';
import { db } from '../services/firebase';
import { deleteAnnouncement, announcementsQuery } from '../services/announcements';
import { deleteMeeting, endMeeting } from '../services/meetings';
import { deleteRecording, recordingsQuery } from '../services/recordings';
import { allQuery, deleteTestimony, pendingQuery, reviewTestimony } from '../services/testimonies';
import { broadcast } from '../services/notifications';
import { ErrorNote, ListSkeleton, PageHead } from '../components/common/States';
import TestimonyItem from '../components/testimonies/TestimonyItem';
import Avatar from '../components/common/Avatar';
import { fmtDate, fmtDateTime } from '../utils/format';

const TABS = ['Overview', 'Members', 'Meetings', 'Announcements', 'Recordings', 'Testimonies', 'Message'];

function Stats() {
  const [s, setS] = useState(null);
  useEffect(() => {
    const c = (q) => getCountFromServer(q).then((r) => r.data().count);
    Promise.all([
      c(collection(db, 'users')),
      c(query(collection(db, 'meetings'), where('status', '==', 'live'))),
      c(query(collection(db, 'meetings'), where('status', '==', 'scheduled'))),
      c(collection(db, 'announcements')),
      c(collection(db, 'recordings')),
      c(query(collection(db, 'testimonies'), where('status', '==', 'pending'))),
    ]).then(([members, live, upcoming, ann, rec, pending]) => setS({ members, live, upcoming, ann, rec, pending })).catch(() => setS(false));
  }, []);
  if (s === false) return <p className="error-note">Could not load statistics.</p>;
  const items = s ? [['Members', s.members], ['Live meetings', s.live], ['Upcoming', s.upcoming], ['Announcements', s.ann], ['Recordings', s.rec], ['Pending testimonies', s.pending]] : [];
  return (
    <dl className="stats">{s ? items.map(([k, v]) => <div key={k}><dd>{v}</dd><dt>{k}</dt></div>) : <ListSkeleton rows={2} />}</dl>
  );
}

function Members({ me }) {
  const toast = useToast();
  const { data, loading, error } = useQuery(() => collection(db, 'users'), []);
  const [q, setQ] = useState('');
  const patch = async (u, change) => {
    try { await updateDoc(doc(db, 'users', u.id), { role: u.role, disabled: !!u.disabled, ...change }); }
    catch { toast('Could not update this member.', 'error'); }
  };
  const list = data.filter((u) => `${u.name} ${u.email}`.toLowerCase().includes(q.toLowerCase())).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  return (
    <>
      <div className="toolbar"><input type="search" placeholder="Search members" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search members" /></div>
      <ErrorNote error={error} />
      {loading ? <ListSkeleton /> : (
        <ul className="rows">
          {list.map((u) => (
            <li key={u.id} className="row-item">
              <Avatar name={u.name} size={34} />
              <div className="row-main"><strong>{u.name}{u.disabled ? ' (deactivated)' : ''}</strong><p className="muted small">{u.email}{u.location ? ` · ${u.location}` : ''}</p></div>
              <div className="row-actions">
                <select value={u.role} disabled={u.id === me} onChange={(e) => patch(u, { role: e.target.value })} aria-label={`Role for ${u.name}`}>
                  <option value="member">Member</option><option value="host">Host</option><option value="admin">Admin</option>
                </select>
                <button className="btn ghost sm" disabled={u.id === me} onClick={() => patch(u, { disabled: !u.disabled })}>{u.disabled ? 'Activate' : 'Deactivate'}</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Simple({ q, render }) {
  const { data, loading, error } = useQuery(q, []);
  return <><ErrorNote error={error} />{loading ? <ListSkeleton /> : data.length ? <ul className="rows">{data.map(render)}</ul> : <p className="muted">Nothing here yet.</p>}</>;
}

function Testimonies({ me }) {
  const toast = useToast();
  const pending = useQuery(pendingQuery, []);
  const all = useQuery(allQuery, []);
  const legacy = all.data.filter((t) => !t.status);
  const run = async (fn, ok) => { try { await fn(); if (ok) toast(ok, 'success'); } catch { toast('Action failed.', 'error'); } };
  const reject = (t) => { const reason = window.prompt('Reason (optional, shown to the member):'); if (reason !== null) run(() => reviewTestimony(t, me, 'rejected', reason), 'Rejected.'); };
  return (
    <>
      <h2 className="sec">Awaiting review ({pending.data.length})</h2>
      {pending.loading ? <ListSkeleton rows={2} /> : pending.data.length ? (
        <div className="stack">{pending.data.map((t) => (
          <div key={t.id}><TestimonyItem t={t} /><div className="row gap">
            <button className="btn primary sm" onClick={() => run(() => reviewTestimony(t, me, 'approved'), 'Published.')}>Approve</button>
            <button className="btn sm" onClick={() => reject(t)}>Reject</button></div></div>
        ))}</div>
      ) : <p className="muted">No submissions waiting.</p>}
      {legacy.length > 0 && (
        <div className="callout"><p><strong>{legacy.length} older testimonies</strong> from before moderation existed are hidden from members.</p>
          <button className="btn sm" onClick={() => run(() => Promise.all(legacy.map((t) => reviewTestimony(t, me, 'approved', '', { announce: false }))), 'Older testimonies published.')}>Publish them all</button></div>
      )}
      <h2 className="sec">Published</h2>
      <div className="stack">{all.data.filter((t) => t.status === 'approved').map((t) => <TestimonyItem key={t.id} t={t} onDelete={(x) => window.confirm('Remove this testimony?') && run(() => deleteTestimony(x), 'Removed.')} />)}</div>
    </>
  );
}

function Message() {
  const toast = useToast();
  const { profile } = useAuth();
  const [f, setF] = useState({ title: '', body: '' });
  const [busy, setBusy] = useState(false);
  const send = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await broadcast(profile, f.title.trim(), f.body.trim()); setF({ title: '', body: '' }); toast('Message sent to members.', 'success'); } catch { toast('Could not send the message.', 'error'); }
    setBusy(false);
  };
  return (
    <form className="form" onSubmit={send}>
      <p className="muted">Appears in every member&apos;s notifications, and as an alert on devices where they turned alerts on.</p>
      <label>Title<input required maxLength={120} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
      <label>Message<textarea rows={4} maxLength={400} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></label>
      <button className="btn primary" disabled={busy}>Send to all members</button>
    </form>
  );
}

export default function Admin() {
  const { profile } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState('Overview');
  const act = useCallback(async (fn, ok) => { try { await fn(); toast(ok, 'success'); } catch { toast('Action failed.', 'error'); } }, [toast]);

  return (
    <div className="page">
      <PageHead title="Administration" sub="Manage members and content without opening the Firebase console." />
      <div className="chips scroll" role="tablist">{TABS.map((t) => <button key={t} role="tab" aria-selected={tab === t} className={`chip ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>{t}</button>)}</div>
      {tab === 'Overview' && <><Stats /><p className="muted">Use the tabs to manage each area. Moderation items show in Testimonies.</p></>}
      {tab === 'Members' && <Members me={profile.uid} />}
      {tab === 'Meetings' && <Simple q={() => query(collection(db, 'meetings'), orderBy('createdAt', 'desc'))} render={(m) => (
        <li key={m.id} className="row-item"><div className="row-main"><strong>{m.title}</strong><p className="muted small">{m.status} · {m.hostName} · {m.scheduledFor ? fmtDateTime(m.scheduledFor) : fmtDate(m.createdAt)}</p></div>
          <div className="row-actions">{m.status === 'live' && <button className="btn sm" onClick={() => act(() => endMeeting(m.id), 'Meeting ended.')}>End</button>}
            <button className="btn ghost sm danger-text" onClick={() => window.confirm(`Delete "${m.title}"?`) && act(() => deleteMeeting(m.id), 'Meeting deleted.')}>Delete</button></div></li>
      )} />}
      {tab === 'Announcements' && <Simple q={announcementsQuery} render={(a) => (
        <li key={a.id} className="row-item"><div className="row-main"><strong>{a.title}</strong><p className="muted small">{a.category} · {fmtDate(a.createdAt)}{a.pinned ? ' · pinned' : ''}</p></div>
          <div className="row-actions"><button className="btn ghost sm" onClick={() => act(() => updateDoc(doc(db, 'announcements', a.id), { pinned: !a.pinned }), a.pinned ? 'Unpinned.' : 'Pinned.')}>{a.pinned ? 'Unpin' : 'Pin'}</button>
            <button className="btn ghost sm danger-text" onClick={() => window.confirm('Delete this announcement?') && act(() => deleteAnnouncement(a), 'Deleted.')}>Delete</button></div></li>
      )} />}
      {tab === 'Recordings' && <Simple q={() => recordingsQuery()} render={(r) => (
        <li key={r.id} className="row-item"><div className="row-main"><strong>{r.meetingTitle}</strong><p className="muted small">{fmtDate(r.createdAt)} · {r.hostName}</p></div>
          <div className="row-actions"><button className="btn ghost sm danger-text" onClick={() => window.confirm('Delete this recording and its file?') && act(() => deleteRecording(r), 'Recording deleted.')}>Delete</button></div></li>
      )} />}
      {tab === 'Testimonies' && <Testimonies me={profile} />}
      {tab === 'Message' && <Message />}
    </div>
  );
}
