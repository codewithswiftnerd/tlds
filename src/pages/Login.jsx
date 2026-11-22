import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { friendlyAuthError, login, resetPassword } from '../services/auth';

export function AuthShell({ title, sub, children }) {
  return (
    <div className="auth">
      <section className="auth-side">
        <div className="brand light"><img src="/images/logo.jpg" alt="" width="36" height="36" /><span>TLDS LIVE</span></div>
        <div>
          <h2 className="serif">Tree of Life Discipleship School</h2>
          <p>Meet, listen and grow together. Live meetings, recordings, announcements and testimonies in one place.</p>
        </div>
      </section>
      <section className="auth-form">
        <div className="auth-box">
          <h1 className="serif">{title}</h1>
          <p className="muted">{sub}</p>
          {children}
        </div>
      </section>
    </div>
  );
}

export default function Login() {
  const nav = useNavigate();
  const loc = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [forgot, setForgot] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(() => {
    const why = sessionStorage.getItem('tlds-signout-reason');
    sessionStorage.removeItem('tlds-signout-reason');
    return why ? { type: 'err', text: why } : { type: '', text: '' };
  });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg({ type: '', text: '' });
    try {
      if (forgot) { await resetPassword(email); setMsg({ type: 'ok', text: 'If an account exists for that email, a reset link is on its way.' }); }
      else { await login(email, password); nav(loc.state?.from || '/', { replace: true }); return; }
    } catch (err) { setMsg({ type: 'err', text: friendlyAuthError(err) }); }
    setBusy(false);
  };

  return (
    <AuthShell title={forgot ? 'Reset your password' : 'Welcome back'} sub={forgot ? 'Enter your email and we will send a reset link.' : loc.state?.from?.startsWith('/meetings/') ? 'Sign in to join the meeting.' : 'Sign in to your TLDS account.'}>
      <form onSubmit={submit} className="form">
        <label>Email<input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        {!forgot && <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>}
        {msg.text && <p className={msg.type === 'err' ? 'error-note' : 'ok-note'} role="alert">{msg.text}</p>}
        <button className="btn primary lg" disabled={busy}>{busy ? 'Please wait…' : forgot ? 'Send reset link' : 'Sign in'}</button>
      </form>
      <p className="auth-links">
        <button className="link" onClick={() => { setForgot(!forgot); setMsg({ type: '', text: '' }); }}>{forgot ? 'Back to sign in' : 'Forgot password?'}</button>
        <span>New here? <Link to="/register" state={loc.state}>Create an account</Link></span>
      </p>
    </AuthShell>
  );
}
