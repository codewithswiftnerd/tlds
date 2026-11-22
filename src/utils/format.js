export const toDate = (ts) => (ts?.toDate ? ts.toDate() : ts instanceof Date ? ts : ts ? new Date(ts) : null);

export function fmtDate(ts, opts = { day: 'numeric', month: 'short', year: 'numeric' }) {
  const d = toDate(ts); return d ? d.toLocaleDateString([], opts) : '';
}
export function fmtTime(ts) {
  const d = toDate(ts); return d ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
}
export const fmtDateTime = (ts) => (toDate(ts) ? `${fmtDate(ts, { weekday: 'short', day: 'numeric', month: 'short' })} · ${fmtTime(ts)}` : '');

export function fmtDuration(sec = 0) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
}

export function timeAgo(ts) {
  const d = toDate(ts); if (!d) return '';
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return fmtDate(d);
}
export const isRecent = (ts, days = 3) => { const d = toDate(ts); return !!d && Date.now() - d.getTime() < days * 86400000; };
export const initials = (name = '') => name.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').toUpperCase().slice(0, 2) || '?';

export function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}
export const formatBytes = (n = 0) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
