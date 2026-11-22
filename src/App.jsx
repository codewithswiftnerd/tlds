import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { PublicOnly, RequireAuth, RequireRole } from './components/navigation/RouteGuards';
import { PageLoader } from './components/common/States';
import AppLayout from './layouts/AppLayout';

const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Meetings = lazy(() => import('./pages/Meetings'));
const MeetingRoom = lazy(() => import('./pages/MeetingRoom'));
const Announcements = lazy(() => import('./pages/Announcements'));
const Recordings = lazy(() => import('./pages/Recordings'));
const Testimonies = lazy(() => import('./pages/Testimonies'));
const Notifications = lazy(() => import('./pages/Notifications'));
const Profile = lazy(() => import('./pages/Profile'));
const Admin = lazy(() => import('./pages/Admin'));

export default function App() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
        <Route path="/register" element={<PublicOnly><Register /></PublicOnly>} />
        {/* The meeting room has its own full-screen layout, no dashboard navigation. */}
        <Route path="/meetings/:id" element={<RequireAuth><MeetingRoom /></RequireAuth>} />
        <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
          <Route index element={<Dashboard />} />
          <Route path="meetings" element={<Meetings />} />
          <Route path="announcements" element={<Announcements />} />
          <Route path="recordings" element={<Recordings />} />
          <Route path="testimonies" element={<Testimonies />} />
          <Route path="notifications" element={<Notifications />} />
          <Route path="profile" element={<Profile />} />
          <Route path="admin" element={<RequireRole roles={['admin']}><Admin /></RequireRole>} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
