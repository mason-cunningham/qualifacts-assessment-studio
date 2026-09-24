import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { Layout } from './components/Layout';
import { Loading } from './components/ui';
import { LoginPage } from './pages/Login';
import { PendingPage, NoAccessPage } from './pages/Pending';
import { DashboardPage } from './pages/Dashboard';
import { NewAssessmentPage } from './pages/NewAssessment';
import { EditorPage } from './pages/editor/Editor';
import { ResponsesPage } from './pages/Responses';
import { ResponseDetailPage } from './pages/ResponseDetail';
import { ProductsPage } from './pages/Products';
import { NotificationsPage } from './pages/Notifications';
import { UsersPage } from './pages/Users';
import { ProfilePage } from './pages/Profile';
import { KnowledgePage } from './pages/Knowledge';
import { GenerateWizardPage } from './pages/ai/GenerateWizard';

function RequireStaff({ children }: { children: ReactNode }) {
  const { loading, session, profile } = useAuth();
  if (loading) return <Loading />;
  if (!session) return <Navigate to="/login" replace />;
  if (!profile) return <NoAccessPage />;
  if (!profile.is_active) return <PendingPage />;
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth();
  return isAdmin ? <>{children}</> : <Navigate to="/" replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireStaff>
            <Layout />
          </RequireStaff>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="new" element={<NewAssessmentPage />} />
        <Route path="new/ai" element={<GenerateWizardPage />} />
        <Route path="knowledge" element={<KnowledgePage />} />
        <Route path="assessments/:id" element={<EditorPage />} />
        <Route path="assessments/:id/responses" element={<ResponsesPage />} />
        <Route path="responses" element={<ResponsesPage />} />
        <Route path="responses/:responseId" element={<ResponseDetailPage />} />
        <Route path="products" element={<ProductsPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="users" element={<RequireAdmin><UsersPage /></RequireAdmin>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
