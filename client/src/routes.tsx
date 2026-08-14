import { Route, Switch } from 'wouter';
import { DevHomePage } from './features/dashboard/DevHomePage';
import { AdminHomePage } from './features/dashboard/AdminHomePage';
import { LoginPage } from './features/auth/LoginPage';
import { ProfilePage } from './features/settings/ProfilePage';
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
    </Switch>
  );
}
