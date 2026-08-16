import { Route, Switch } from 'wouter';
import { DevHomePage } from './features/dashboard/DevHomePage';
import { AdminHomePage } from './features/dashboard/AdminHomePage';
import { LoginPage } from './features/auth/LoginPage';
import { ProfilePage } from './features/settings/ProfilePage';
import { AcademySettingsPage } from './features/settings/AcademySettingsPage';
import { AcademicsSettingsPage } from './features/settings/AcademicsSettingsPage';
import { GuardianListPage } from './features/guardians/GuardianListPage';
import { GuardianDetailPage } from './features/guardians/GuardianDetailPage';
import { StudentListPage } from './features/students/StudentListPage';
import { StudentDetailPage } from './features/students/StudentDetailPage';
import { CheckInKioskPage } from './features/checkin/CheckInKioskPage';
import { ProtectedRoute } from './components/layout/ProtectedRoute';

export function AppRoutes() {
  return (
    <Switch>
      <Route path="/" component={DevHomePage} />
      <Route path="/login" component={LoginPage} />
      <Route path="/check-in" component={CheckInKioskPage} />
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
      <Route path="/admin/guardians">
        <ProtectedRoute>
          <GuardianListPage />
        </ProtectedRoute>
      </Route>
      <Route path="/admin/guardians/:guardianId">
        <ProtectedRoute>
          <GuardianDetailPage />
        </ProtectedRoute>
      </Route>
      <Route path="/admin/students">
        <ProtectedRoute>
          <StudentListPage />
        </ProtectedRoute>
      </Route>
      <Route path="/admin/students/:studentId">
        <ProtectedRoute>
          <StudentDetailPage />
        </ProtectedRoute>
      </Route>
    </Switch>
  );
}
