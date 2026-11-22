import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Megaphone, MessageCircleHeart, PlayCircle, Radio, Video } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useQuery } from '../hooks/useQuery';
import { liveMeetingsQuery, upcomingMeetingsQuery } from '../services/meetings';
import { announcementsQuery, visibleAnnouncements } from '../services/announcements';
import { recordingsQuery } from '../services/recordings';
import { approvedQuery } from '../services/testimonies';
import { ErrorNote, ListSkeleton } from '../components/common/States';
import MeetingRow from '../components/meetings/MeetingRow';
import AnnouncementItem from '../components/announcements/AnnouncementItem';
import RecordingRow from '../components/recordings/RecordingRow';
import PlayerModal from '../components/recordings/PlayerModal';
import InstallApp from '../components/common/InstallApp';
import { fmtDate, greeting } from '../utils/format';

export default function Dashboard() {
  const { profile, isAdmin, canHost } = useAuth();
  const nav = useNavigate();
  const [playing, setPlaying] = useState(null);
  const live = useQuery(liveMeetingsQuery, []);
  const upcoming = useQuery(() => upcomingMeetingsQuery(4), []);
  const ann = useQuery(announcementsQuery, []);
  const recs = useQuery(() => recordingsQuery(4), []);
  const tests = useQuery(() => approvedQuery(3), []);
  const announcements = visibleAnnouncements(ann.data, isAdmin).slice(0, 3);

  return (
    <div className="page">
      <header className="welcome">
        <div>
          <p className="muted small">{fmtDate(new Date(), { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <h1 className="serif">{greeting()}, {profile.firstName || profile.name}</h1>
        </div>
        <div className="quick">
          <button className="btn" onClick={() => nav('/meetings')}><Video size={16} /> Meetings</button>
          <button className="btn" onClick={() => nav('/recordings')}><PlayCircle size={16} /> Recordings</button>
          <button className="btn" onClick={() => nav('/testimonies')}><MessageCircleHeart size={16} /> Share a testimony</button>
        </div>
      </header>

      <InstallApp hideHint />
      {live.data.map((m) => (
        <section key={m.id} className="live-banner">
          <div><span className="live-tag light"><Radio size={12} /> Live now</span><h2>{m.title}</h2><p>Hosted by {m.hostName}</p></div>
          <button className="btn light" onClick={() => nav(`/meetings/${m.id}`)}>Join meeting</button>
        </section>
      ))}

      <div className="cols">
        <div className="col-main">
          <section>
            <div className="sec-head"><h2>Upcoming meetings</h2><Link to="/meetings">All meetings <ArrowRight size={14} /></Link></div>
            <ErrorNote error={upcoming.error || live.error} onRetry={() => { upcoming.retry(); live.retry(); }} />
            {upcoming.loading ? <ListSkeleton /> : upcoming.data.length ? <ul className="rows">{upcoming.data.map((m) => <MeetingRow key={m.id} m={m} />)}</ul> : <p className="muted">No meetings scheduled right now.</p>}
          </section>
          <section>
            <div className="sec-head"><h2>Latest announcements</h2><Link to="/announcements">View all <ArrowRight size={14} /></Link></div>
            <ErrorNote error={ann.error} onRetry={ann.retry} />
            {ann.loading ? <ListSkeleton /> : announcements.length ? <div className="stack">{announcements.map((a) => <AnnouncementItem key={a.id} a={a} compact />)}</div> : <p className="muted"><Megaphone size={14} /> Nothing has been announced yet.</p>}
          </section>
        </div>
        <aside className="col-side">
          <section>
            <div className="sec-head"><h2>Recent recordings</h2><Link to="/recordings">Library <ArrowRight size={14} /></Link></div>
            <ErrorNote error={recs.error} onRetry={recs.retry} />
            {recs.loading ? <ListSkeleton rows={2} /> : recs.data.length ? <ul className="rows tight">{recs.data.map((r) => <RecordingRow key={r.id} r={r} onPlay={setPlaying} compact />)}</ul> : <p className="muted">No recordings yet.</p>}
          </section>
          <section>
            <div className="sec-head"><h2>Testimonies</h2><Link to="/testimonies">Read more <ArrowRight size={14} /></Link></div>
            <ErrorNote error={tests.error} onRetry={tests.retry} />
            {tests.loading ? <ListSkeleton rows={2} /> : tests.data.length ? tests.data.map((t) => (
              <blockquote key={t.id} className="quote"><p className="clamp serif">{t.body}</p><footer>{t.authorName}</footer></blockquote>
            )) : <p className="muted">Be the first to share what God has done.</p>}
          </section>
        </aside>
      </div>
      {playing && <PlayerModal rec={playing} onClose={() => setPlaying(null)} canDownload={canHost} />}
    </div>
  );
}
