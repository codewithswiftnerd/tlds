import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarPlus, Radio } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useQuery } from '../hooks/useQuery';
import { deleteMeeting, liveMeetingsQuery, pastMeetingsQuery, scheduleMeeting, startMeetingNow, upcomingMeetingsQuery, updateMeeting } from '../services/meetings';
import { ErrorNote, ListSkeleton, PageHead } from '../components/common/States';
import MeetingRow from '../components/meetings/MeetingRow';
import Modal from '../components/common/Modal';
import { toDate } from '../utils/format';
import { explainError, withTimeout } from '../utils/errors';

const pad = (n) => String(n).padStart(2, '0');
const dateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeStr = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const EMPTY = { title: '', description: '', date: '', time: '', duration: '', moderated: true, repeatWeeks: 1 };

function MeetingForm({ existing, onClose }) {
  const { profile } = useAuth();
  const toast = useToast();
  const at = existing ? toDate(existing.scheduledFor) : null;
  const [f, setF] = useState(existing ? {
    title: existing.title || '', description: existing.description || '', date: at ? dateStr(at) : '', time: at ? timeStr(at) : '',
    duration: existing.duration || '', moderated: existing.speakingMode !== 'open', repeatWeeks: 1,
  } : EMPTY);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    const when = new Date(`${f.date}T${f.time}`);
    if (Number.isNaN(when.getTime())) { toast('Please choose a valid date and time.', 'error'); return; }
    if (!existing && when.getTime() < Date.now() - 60000) { toast('That time has already passed. Use "Start now" for a meeting right away.', 'error'); return; }
    setBusy(true);
    const data = { title: f.title.trim(), description: f.description.trim(), duration: f.duration.trim(), when, speakingMode: f.moderated ? 'moderated' : 'open' };
    try {
      if (existing) await withTimeout(updateMeeting(existing.id, data), 45000);
      else await withTimeout(scheduleMeeting(profile, { ...data, repeatWeeks: f.repeatWeeks }), 45000);
      toast(existing ? 'Meeting updated.' : Number(f.repeatWeeks) > 1 ? `${f.repeatWeeks} weekly meetings scheduled.` : 'Meeting scheduled.', 'success');
      onClose();
    } catch (e) { console.error(e); toast(`${existing ? 'Could not save the meeting.' : 'Could not schedule the meeting.'} ${explainError(e)}`, 'error'); setBusy(false); }
  };

  return (
    <Modal title={existing ? 'Edit meeting' : 'Schedule a meeting'} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <label>Title<input required maxLength={150} value={f.title} onChange={set('title')} placeholder="e.g. Sunday Service, Bible Study" /></label>
        <label>Description<textarea rows={3} maxLength={2000} value={f.description} onChange={set('description')} placeholder="Topic, speaker, what to prepare" /></label>
        <div className="two"><label>Date<input type="date" required value={f.date} onChange={set('date')} /></label>
          <label>Time<input type="time" required value={f.time} onChange={set('time')} /></label></div>
        <div className="two">
          <label>Expected duration<input value={f.duration} onChange={set('duration')} placeholder="e.g. 1 hour 30 min" /></label>
          {!existing && (
            <label>Repeat
              <select value={f.repeatWeeks} onChange={set('repeatWeeks')}>
                <option value={1}>Does not repeat</option>
                {[4, 8, 12, 26].map((n) => <option key={n} value={n}>Weekly, {n} weeks</option>)}
              </select>
            </label>
          )}
        </div>
        <label className="check"><input type="checkbox" checked={f.moderated} onChange={set('moderated')} /> Moderated: only people the host allows can speak</label>
        <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : existing ? 'Save changes' : 'Schedule meeting'}</button>
      </form>
    </Modal>
  );
}

function CancelDialog({ m, upcoming, onClose }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const series = m.seriesId ? upcoming.filter((x) => x.seriesId === m.seriesId && toDate(x.scheduledFor) >= toDate(m.scheduledFor)) : [];
  const run = async (list) => {
    setBusy(true);
    try { await Promise.all(list.map((x) => deleteMeeting(x.id))); toast(list.length > 1 ? `${list.length} meetings cancelled.` : 'Meeting cancelled.'); onClose(); }
    catch { toast('Could not cancel.', 'error'); setBusy(false); }
  };
  return (
    <Modal title="Cancel meeting" onClose={onClose}>
      <p>Cancel &ldquo;{m.title}&rdquo;? Members will no longer see it.</p>
      <div className="row gap wrap dialog-actions">
        <button className="btn primary" disabled={busy} onClick={() => run([m])}>Cancel this meeting</button>
        {series.length > 1 && <button className="btn" disabled={busy} onClick={() => run(series)}>Cancel this and the next {series.length - 1}</button>}
        <button className="btn ghost" onClick={onClose}>Keep it</button>
      </div>
    </Modal>
  );
}

export default function Meetings() {
  const { profile, canHost } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const live = useQuery(liveMeetingsQuery, []);
  const upcoming = useQuery(() => upcomingMeetingsQuery(), []);
  const past = useQuery(() => pastMeetingsQuery(), []);
  const [form, setForm] = useState(null); // null | {} new | meeting
  const [cancelling, setCancelling] = useState(null);
  const [busy, setBusy] = useState(false);

  const startNow = async () => {
    const title = window.prompt('Meeting title', `${profile.firstName || profile.name}'s meeting`);
    if (title === null) return;
    setBusy(true);
    try { nav(`/meetings/${await withTimeout(startMeetingNow(profile, title.trim()), 45000)}`); }
    catch (e) { console.error(e); toast(`Could not start a meeting. ${explainError(e)}`, 'error'); setBusy(false); }
  };

  return (
    <div className="page">
      <PageHead title="Meetings" sub="Join live sessions and see what is coming up.">
        {canHost && <>
          <button className="btn" onClick={() => setForm({})}><CalendarPlus size={16} /> Schedule</button>
          <button className="btn primary" onClick={startNow} disabled={busy}><Radio size={16} /> Start now</button>
        </>}
      </PageHead>
      <ErrorNote error={live.error || upcoming.error || past.error} onRetry={() => { live.retry(); upcoming.retry(); past.retry(); }} />
      {live.data.length > 0 && <section><h2 className="sec">Live now</h2><ul className="rows">{live.data.map((m) => <MeetingRow key={m.id} m={m} />)}</ul></section>}
      <section>
        <h2 className="sec">Upcoming</h2>
        {upcoming.loading ? <ListSkeleton /> : upcoming.data.length ? <ul className="rows">{upcoming.data.map((m) => <MeetingRow key={m.id} m={m} onCancel={setCancelling} onEdit={setForm} />)}</ul> : <p className="muted">No upcoming meetings.</p>}
      </section>
      <section>
        <h2 className="sec">Recent</h2>
        {past.loading ? <ListSkeleton rows={2} /> : past.data.length ? <ul className="rows">{past.data.map((m) => <MeetingRow key={m.id} m={m} />)}</ul> : <p className="muted">Past meetings will appear here.</p>}
      </section>

      {form && <MeetingForm existing={form.id ? form : null} onClose={() => setForm(null)} />}
      {cancelling && <CancelDialog m={cancelling} upcoming={upcoming.data} onClose={() => setCancelling(null)} />}
    </div>
  );
}
