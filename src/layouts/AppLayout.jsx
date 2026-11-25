import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Bell, CalendarClock, Home, Megaphone, MessageCircleHeart, MoreHorizontal, PlayCircle, Shield, User, LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useNotifications } from '../hooks/useNotifications';
import { logout } from '../services/auth';
import { showDeviceAlert, startPush } from '../services/notifications';
import Avatar from '../components/common/Avatar';
import PendingRecordings from '../components/recordings/PendingRecordings';

const MAIN = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/meetings', label: 'Meetings', icon: CalendarClock },
  { to: '/announcements', label: 'Announcements', icon: Megaphone },
  { to: '/recordings', label: 'Recordings', icon: PlayCircle },
  { to: '/testimonies', label: 'Testimonies', icon: MessageCircleHeart },
  { to: '/notifications', label: 'Notifications', icon: Bell },
  { to: '/profile', label: 'Profile', icon: User },
];

export default function AppLayout() {
  const { profile, isAdmin } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const loc = useLocation();
  const [sheet, setSheet] = useState(false);
  const { items, unread, loading: notifLoading } = useNotifications(profile);

  useEffect(() => { setSheet(false); window.scrollTo(0, 0); }, [loc.pathname]);
  useEffect(() => {
    let off = () => {};
    startPush(profile.uid, (t) => toast(t)).then((u) => { off = u; });
    return () => off();
  }, [profile.uid, toast]);

  // Something new while the app is open: a toast, plus a system alert when the tab is in the background.
  const alerted = useRef(null);
  useEffect(() => {
    if (notifLoading) return;
    if (!alerted.current) { alerted.current = new Set(items.map((n) => n.id)); return; } // first load: nothing is "new"
    for (const n of items) {
      if (alerted.current.has(n.id)) continue;
      alerted.current.add(n.id);
      if (n.read || Date.now() - n.at > 10 * 60000) continue;
      if (document.visibilityState === 'visible') { if (loc.pathname !== '/notifications') toast(n.title, 'info'); }
      else showDeviceAlert({ title: n.title, body: n.body || '', link: n.link || '/', tag: n.id });
    }
  }, [items, notifLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const base = 'TLDS LIVE';
    document.title = unread ? `(${unread}) ${base}` : base;
  }, [unread]);

  const items_ = isAdmin ? [...MAIN, { to: '/admin', label: 'Admin', icon: Shield }] : MAIN;
  const bottom = items_.filter((i) => ['/', '/meetings', '/announcements', '/recordings'].includes(i.to));
  const more = items_.filter((i) => !bottom.includes(i));
  const badge = (to) => (to === '/notifications' && unread ? <span className="nav-badge">{unread > 9 ? '9+' : unread}</span> : null);
  const signOut = () => logout().then(() => nav('/login'));
  const desk = items_.filter((i) => !['/notifications', '/profile'].includes(i.to));
  const roleName = profile.role === 'admin' ? 'Administrator' : profile.role === 'host' ? 'Meeting host' : 'Member';

  return (
    <div className="shell">
      {/* Desktop: white top bar with horizontal links (Bolt-style). */}
      <header className="deskbar">
        <div className="deskbar-in">
          <NavLink to="/" className="brand"><img src="/images/logo.jpg" alt="" width="34" height="34" /><span>TLDS LIVE</span></NavLink>
          <nav aria-label="Main" className="desk-nav">
            {desk.map(({ to, label, end }) => (
              <NavLink key={to} to={to} end={end} className="desk-link">{label}</NavLink>
            ))}
          </nav>
          <div className="desk-right">
            <NavLink to="/notifications" className="icon-btn round" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} title="Notifications">
              <Bell size={19} />{unread ? <span className="nav-badge float">{unread > 9 ? '9+' : unread}</span> : null}
            </NavLink>
            <NavLink to="/profile" className="me-chip" title="Your profile">
              <Avatar name={profile.name} size={30} />
              <span><strong>{profile.firstName || profile.name}</strong><small>{roleName}</small></span>
            </NavLink>
            <button className="icon-btn round" onClick={signOut} aria-label="Sign out" title="Sign out"><LogOut size={17} /></button>
          </div>
        </div>
      </header>

      <header className="topbar">
        <div className="brand"><img src="/images/logo.jpg" alt="" width="28" height="28" /><span>TLDS LIVE</span></div>
        <NavLink to="/notifications" className="icon-btn" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}><Bell size={20} />{unread ? <span className="nav-badge">{unread > 9 ? '9+' : unread}</span> : null}</NavLink>
      </header>

      <main className="main">
        <PendingRecordings profile={profile} />
        <Outlet />
      </main>

      <footer className="app-foot">
        <div className="app-foot-in">
          <div className="foot-brand">
            <div className="brand light"><img src="/images/logo.jpg" alt="" width="34" height="34" /><span>TLDS LIVE</span></div>
            <p>Tree of Life Discipleship School. Meet, listen and grow together.</p>
          </div>
          <nav className="foot-col" aria-label="Community">
            <h3>Community</h3>
            <NavLink to="/meetings">Meetings</NavLink><NavLink to="/recordings">Recordings</NavLink>
            <NavLink to="/announcements">Announcements</NavLink><NavLink to="/testimonies">Testimonies</NavLink>
          </nav>
          <nav className="foot-col" aria-label="Account">
            <h3>Account</h3>
            <NavLink to="/profile">Profile</NavLink><NavLink to="/notifications">Notifications</NavLink>
            {isAdmin && <NavLink to="/admin">Admin</NavLink>}
            <button type="button" onClick={signOut}>Sign out</button>
          </nav>
        </div>
        <p className="foot-copy">© {new Date().getFullYear()} Tree of Life Discipleship School</p>
      </footer>

      <nav className="bottomnav" aria-label="Main">
        {bottom.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className="bn-item"><span className="bn-icon"><Icon size={20} /></span><span>{label === 'Announcements' ? 'News' : label}</span></NavLink>
        ))}
        <button className={`bn-item ${sheet ? 'active' : ''}`} onClick={() => setSheet((v) => !v)} aria-expanded={sheet}>
          <span className="bn-icon"><MoreHorizontal size={20} />{unread ? <span className="dot-badge" aria-hidden="true" /> : null}</span><span>More</span>
        </button>
      </nav>

      {sheet && (
        <div className="sheet-backdrop" onClick={() => setSheet(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()} role="menu">
            {more.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} className="sheet-item"><Icon size={18} />{label}{badge(to)}</NavLink>
            ))}
            <button className="sheet-item" onClick={signOut}><LogOut size={18} />Sign out</button>
          </div>
        </div>
      )}
    </div>
  );
}
