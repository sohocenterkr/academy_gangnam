import { Route, Switch } from 'wouter';
import { DevHomePage } from './features/dashboard/DevHomePage';
import { AdminHomePage } from './features/dashboard/AdminHomePage';
import { LoginPage } from './features/auth/LoginPage';
import { ProfilePage } from './features/settings/ProfilePage';
import { AcademySettingsPage } from './features/settings/AcademySettingsPage';
import { AcademicsSettingsPage } from './features/settings/AcademicsSettingsPage';
import { ProtectedRoute } from './components/layout/ProtectedRoute';

export function AppRoutes() {
  return (
    <Switch>
      <Route path="/" component={DevHomePage} />
      <Route path="/login" component={LoginPage} />
      <Route path="/admin">
        <ProtectedRoute>
          <AdminHomePage />
        </ProtectedRoute>
      </Route>
      <Route path="/admin/profile">
        <ProtectedRoute>
          <ProfilePage />
        </ProtectedRoute>
      </Route>
      <Route path="/admin/settings/academy">
        <ProtectedRoute>
          <AcademySettingsPage />
        </ProtectedRoute>
      </Route>
      <Route path="/admin/settings/academics">
        <ProtectedRoute>
          <AcademicsSettingsPage />
        </ProtectedRoute>
      </Route>
    </Switch>
  );
}
