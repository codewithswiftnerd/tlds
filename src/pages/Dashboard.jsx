import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CalendarClock, Megaphone, MessageCircleHeart, PlayCircle, Radio } from 'lucide-react';
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

// "Our services"-style cards, one per part of the app.
const SERVICES = [
  { to: '/meetings', label: 'Live', title: 'Meetings', text: 'Join live teachings and prayer sessions from anywhere.', icon: CalendarClock, tone: 'mint' },
  { to: '/recordings', label: 'Library', title: 'Recordings', text: 'Catch up on every message you missed, at your pace.', icon: PlayCircle, tone: 'forest' },
  { to: '/announcements', label: 'News', title: 'Announcements', text: 'Stay up to date with what is happening in the school.', icon: Megaphone, tone: 'sand' },
  { to: '/testimonies', label: 'Community', title: 'Testimonies', text: 'Share and read what God is doing among us.', icon: MessageCircleHeart, tone: 'sky' },
];

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
  const liveNow = live.data[0];

  return (
    <div className="page">
      <section className="hero">
        <div className="hero-copy">
          <p className="hero-kicker">{fmtDate(new Date(), { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <h1 className="serif">{greeting()}, {profile.firstName || profile.name}</h1>
          <p className="hero-sub">Meet, listen and grow together. Everything for the Tree of Life Discipleship School in one place.</p>
          <div className="hero-ctas">
            <button className="btn primary lg" onClick={() => nav(liveNow ? `/meetings/${liveNow.id}` : '/meetings')}>
              {liveNow ? <><Radio size={17} /> Join live meeting</> : 'See meetings'}
            </button>
            <button className="btn light lg" onClick={() => nav('/recordings')}><PlayCircle size={17} /> Listen to recordings</button>
          </div>
        </div>
        <div className="hero-art" aria-hidden="true" />
      </section>

      <InstallApp hideHint />
      {live.data.map((m) => (
        <section key={m.id} className="live-banner">
          <div><span className="live-tag light"><Radio size={12} /> Live now</span><h2>{m.title}</h2><p>Hosted by {m.hostName}</p></div>
          <button className="btn light" onClick={() => nav(`/meetings/${m.id}`)}>Join meeting</button>
        </section>
      ))}

      <section>
        <div className="sec-head big"><h2 className="serif">Everything in one place</h2></div>
        <div className="services">
          {SERVICES.map(({ to, label, title, text, icon: Icon, tone }) => (
            <Link key={to} to={to} className={`service tone-${tone}`}>
              <span className="service-icon"><Icon size={26} strokeWidth={1.8} /></span>
              <span className="service-label">{label}</span>
              <h3>{title}</h3>
              <p>{text}</p>
              <span className="service-go">Open</span>
            </Link>
          ))}
        </div>
      </section>

      <div className="cols">
        <div className="col-main">
          <section className="card-block">
            <div className="sec-head"><h2>Upcoming meetings</h2><Link to="/meetings">All meetings</Link></div>
            <ErrorNote error={upcoming.error || live.error} onRetry={() => { upcoming.retry(); live.retry(); }} />
            {upcoming.loading ? <ListSkeleton /> : upcoming.data.length ? <ul className="rows">{upcoming.data.map((m) => <MeetingRow key={m.id} m={m} />)}</ul> : <p className="muted">No meetings scheduled right now.{canHost ? ' Schedule one from the Meetings page.' : ''}</p>}
          </section>
          <section className="card-block">
            <div className="sec-head"><h2>Latest announcements</h2><Link to="/announcements">View all</Link></div>
            <ErrorNote error={ann.error} onRetry={ann.retry} />
            {ann.loading ? <ListSkeleton /> : announcements.length ? <div className="stack">{announcements.map((a) => <AnnouncementItem key={a.id} a={a} compact />)}</div> : <p className="muted"><Megaphone size={14} /> Nothing has been announced yet.</p>}
          </section>
        </div>
        <aside className="col-side">
          <section className="card-block">
            <div className="sec-head"><h2>Recent recordings</h2><Link to="/recordings">Library</Link></div>
            <ErrorNote error={recs.error} onRetry={recs.retry} />
            {recs.loading ? <ListSkeleton rows={2} /> : recs.data.length ? <ul className="rows tight">{recs.data.map((r) => <RecordingRow key={r.id} r={r} onPlay={setPlaying} compact />)}</ul> : <p className="muted">No recordings yet.</p>}
          </section>
          <section className="card-block">
            <div className="sec-head"><h2>Testimonies</h2><Link to="/testimonies">Read more</Link></div>
            <ErrorNote error={tests.error} onRetry={tests.retry} />
            {tests.loading ? <ListSkeleton rows={2} /> : tests.data.length ? tests.data.map((t) => (
              <blockquote key={t.id} className="quote"><p className="clamp">{t.body}</p><footer>{t.authorName}</footer></blockquote>
            )) : <p className="muted">Be the first to share what God has done.</p>}
          </section>
        </aside>
      </div>
      {playing && <PlayerModal rec={playing} onClose={() => setPlaying(null)} canDownload={canHost} />}
    </div>
  );
}
