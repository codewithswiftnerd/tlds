import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { changePassword, friendlyAuthError, logout, saveProfile } from '../services/auth';
import { PageHead } from '../components/common/States';
import Avatar from '../components/common/Avatar';
import InstallApp from '../components/common/InstallApp';
import { fmtDate } from '../utils/format';

export default function Profile() {
  const { profile } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [f, setF] = useState({ name: profile.name || '', phone: profile.phone || '', location: profile.location || '' });
  const [pw, setPw] = useState({ current: '', next: '' });
  const [busy, setBusy] = useState(false);
  const roleLabel = { admin: 'Administrator', host: 'Meeting host', member: 'Member' }[profile.role];

  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await saveProfile(profile.uid, f); toast('Profile saved.', 'success'); } catch { toast('Could not save your profile.', 'error'); }
    setBusy(false);
  };
  const pass = async (e) => {
    e.preventDefault();
    if (pw.next.length < 6) { toast('New password must be at least 6 characters.', 'error'); return; }
    try { await changePassword(pw.current, pw.next); setPw({ current: '', next: '' }); toast('Password updated.', 'success'); } catch (x) { toast(friendlyAuthError(x), 'error'); }
  };

  return (
    <div className="page narrow">
      <PageHead title="Profile" />
      <div className="profile-head"><Avatar name={profile.name} size={64} /><div><h2>{profile.name}</h2><p className="muted">{profile.email}</p><p className="small">{roleLabel}{profile.createdAt ? ` · member since ${fmtDate(profile.createdAt, { month: 'long', year: 'numeric' })}` : ''}</p></div></div>
      <form className="form" onSubmit={save}>
        <h2 className="sec">Details</h2>
        <label>Full name<input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <div className="two"><label>Phone<input type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
          <label>Location<input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></label></div>
        <button className="btn primary" disabled={busy}>Save changes</button>
      </form>
      <form className="form" onSubmit={pass}>
        <h2 className="sec">Change password</h2>
        <div className="two"><label>Current password<input type="password" autoComplete="current-password" required value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></label>
          <label>New password<input type="password" autoComplete="new-password" required value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></label></div>
        <button className="btn">Update password</button>
      </form>
      <InstallApp />
      <button className="btn ghost danger-text" onClick={() => logout().then(() => nav('/login'))}>Sign out</button>
    </div>
  );
}
