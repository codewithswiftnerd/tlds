import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, BellRing, CheckCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useNotifications } from '../hooks/useNotifications';
import { alertsSupported, enableAlerts, markAllRead, markFeedSeen, markRead, NOTIF_TYPES, savePrefs } from '../services/notifications';
import { Empty, ErrorNote, ListSkeleton, PageHead } from '../components/common/States';
import { timeAgo } from '../utils/format';

export default function Notifications() {
  const { profile } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const { items, loading, error, seenAt } = useNotifications(profile);
  const prefs = profile.notifPrefs || {};
  const [perm, setPerm] = useState(() => (alertsSupported() ? Notification.permission : 'unsupported'));
  // Remember what was unread when the page opened (so the dots stay visible), then mark everything seen.
  const openedSeenAt = useRef(seenAt);
  useEffect(() => { markFeedSeen(profile.uid).catch(() => {}); }, [profile.uid]);
  const isUnread = (n) => (n.personal ? !n.read : n.at > openedSeenAt.current);

  const open = (n) => { if (n.personal && !n.read) markRead(n.id).catch(() => {}); if (n.link) nav(n.link); };
  const togglePref = (k) => savePrefs(profile.uid, { ...prefs, [k]: prefs[k] === false }).catch(() => toast('Could not save.', 'error'));
  const turnOn = async () => {
    try {
      const mode = await enableAlerts(profile.uid);
      setPerm('granted');
      toast(mode === 'push' ? 'Notifications are on for this device, even when the app is closed.' : 'Notifications are on for this device while TLDS LIVE is open.', 'success');
    } catch (e) { setPerm(alertsSupported() ? Notification.permission : 'unsupported'); toast(e.message, 'error'); }
  };
  const allRead = () => { markAllRead(items).catch(() => toast('Could not update.', 'error')); openedSeenAt.current = Date.now(); markFeedSeen(profile.uid).catch(() => {}); };

  return (
    <div className="page narrow">
      <PageHead title="Notifications">
        <button className="btn" onClick={allRead} disabled={!items.some(isUnread)}><CheckCheck size={16} /> Mark all as read</button>
      </PageHead>
      {perm === 'default' && (
        <div className="callout">
          <p><strong>Get alerted</strong> when a meeting goes live or there is news.</p>
          <button className="btn primary sm" onClick={turnOn}><BellRing size={14} /> Turn on</button>
        </div>
      )}
      <ErrorNote error={error} />
      {loading ? <ListSkeleton rows={4} /> : items.length ? (
        <ul className="rows">
          {items.map((n) => (
            <li key={`${n.personal ? 'p' : 'f'}${n.id}`}>
              <button className={`notif ${isUnread(n) ? 'unread' : ''}`} onClick={() => open(n)}>
                <span className="dot" aria-label={isUnread(n) ? 'Unread' : 'Read'} />
                <span className="grow"><strong>{n.title}</strong>{n.body && <small>{n.body}</small>}</span>
                <time className="muted small">{timeAgo(new Date(n.at))}</time>
              </button>
            </li>
          ))}
        </ul>
      ) : <Empty icon={Bell} title="You're all caught up" text="Announcements, live meetings, new recordings and messages will appear here." />}

      <section className="prefs">
        <h2 className="sec">What to show</h2>
        {Object.entries(NOTIF_TYPES).map(([k, label]) => (
          <label key={k} className="check pref"><input type="checkbox" checked={prefs[k] !== false} onChange={() => togglePref(k)} /> {label}</label>
        ))}
        {perm === 'granted' && <p className="muted small">Alerts are on for this device.</p>}
        {perm === 'denied' && <p className="muted small">Alerts are blocked for this site. Allow notifications in your browser&apos;s site settings to turn them on.</p>}
        {perm === 'unsupported' && <p className="muted small">This browser cannot show alerts. On iPhone, add TLDS LIVE to your Home Screen (Share → Add to Home Screen) and open it from there.</p>}
      </section>
    </div>
  );
}
