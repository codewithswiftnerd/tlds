import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { PageLoader } from '../common/States';

export function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <PageLoader />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  return children;
}

/** Sign-in pages. After signing in, people go back to the link they opened (e.g. a meeting shared in a group chat). */
export function PublicOnly({ children }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <PageLoader />;
  return user ? <Navigate to={loc.state?.from || '/'} replace /> : children;
}

// UI convenience only: real enforcement is in firestore.rules and storage.rules.
export function RequireRole({ roles, children }) {
  const { profile } = useAuth();
  return roles.includes(profile?.role) ? children : <Navigate to="/" replace />;
}
