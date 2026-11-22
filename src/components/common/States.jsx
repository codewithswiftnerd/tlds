export const Spinner = ({ label = 'Loading' }) => <div className="spinner" role="status" aria-label={label} />;

export function PageLoader() {
  return <div className="page-loader"><Spinner /></div>;
}

export function Empty({ icon: Icon, title, text, action }) {
  return (
    <div className="empty">
      {Icon && <Icon size={28} strokeWidth={1.5} />}
      <strong>{title}</strong>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}

export function ListSkeleton({ rows = 3 }) {
  return <div aria-busy="true">{Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton-row" />)}</div>;
}

export function ErrorNote({ error }) {
  if (!error) return null;
  return <p className="error-note" role="alert">Could not load this section{error.code === 'permission-denied' ? ' (permission denied)' : ''}. Please refresh and try again.</p>;
}

export const PageHead = ({ title, sub, children }) => (
  <header className="page-head">
    <div><h1 className="serif">{title}</h1>{sub && <p className="muted">{sub}</p>}</div>
    <div className="page-head-actions">{children}</div>
  </header>
);
