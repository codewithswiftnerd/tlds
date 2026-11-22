import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { friendlyAuthError, register } from '../services/auth';
import { AuthShell } from './Login';

export default function Register() {
  const loc = useLocation();
  const [f, setF] = useState({ firstName: '', lastName: '', email: '', phone: '', location: '', password: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    if (f.password.length < 6) { setErr('Password must be at least 6 characters.'); return; }
    setBusy(true); setErr('');
    try { await register(f); } catch (x) { setErr(friendlyAuthError(x)); setBusy(false); }
  };
  return (
    <AuthShell title="Create your account" sub="Join the TLDS community.">
      <form onSubmit={submit} className="form">
        <div className="two"><label>First name<input required value={f.firstName} onChange={set('firstName')} autoComplete="given-name" /></label>
          <label>Last name<input required value={f.lastName} onChange={set('lastName')} autoComplete="family-name" /></label></div>
        <label>Email<input type="email" required value={f.email} onChange={set('email')} autoComplete="email" /></label>
        <div className="two"><label>Phone<input type="tel" value={f.phone} onChange={set('phone')} autoComplete="tel" /></label>
          <label>Location<input value={f.location} onChange={set('location')} placeholder="City, country" /></label></div>
        <label>Password<input type="password" required minLength={6} value={f.password} onChange={set('password')} autoComplete="new-password" /></label>
        {err && <p className="error-note" role="alert">{err}</p>}
        <button className="btn primary lg" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</button>
      </form>
      <p className="auth-links"><span>Already registered? <Link to="/login" state={loc.state}>Sign in</Link></span></p>
    </AuthShell>
  );
}
