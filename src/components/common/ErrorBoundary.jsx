import { Component } from 'react';

/** If any screen crashes, show what happened and a way out, instead of a blank page. */
export default class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error(error, info?.componentStack); }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div style={{ maxWidth: 520, margin: '12vh auto', padding: 24, font: '15px/1.5 system-ui, sans-serif', color: '#1d2a23' }}>
        <h1 style={{ fontSize: 22, margin: '0 0 8px' }}>Something went wrong</h1>
        <p style={{ margin: '0 0 12px', color: '#5b6b62' }}>Reload the page. If it happens again, send this message to the site administrator:</p>
        <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: '#eef2ef', padding: 12, borderRadius: 8, fontSize: 13 }}>{String(error?.stack || error?.message || error)}</pre>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button onClick={() => window.location.reload()} style={{ padding: '10px 16px', border: 0, borderRadius: 8, background: '#145C3A', color: '#fff', fontWeight: 600 }}>Reload</button>
          <button onClick={() => { window.location.href = '/'; }} style={{ padding: '10px 16px', border: '1px solid #cfd8d2', borderRadius: 8, background: '#fff' }}>Go home</button>
        </div>
      </div>
    );
  }
}
