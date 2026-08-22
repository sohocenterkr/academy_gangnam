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
import { AdminCheckInsPage } from './features/checkin/AdminCheckInsPage';
import { InstructorListPage } from './features/instructors/InstructorListPage';
import { CourseListPage } from './features/courses/CourseListPage';
import { CourseDetailPage } from './features/courses/CourseDetailPage';
import { MessagingSettingsPage } from './features/messaging/MessagingSettingsPage';
import { MessageTemplatesPage } from './features/messaging/MessageTemplatesPage';
import { PlatformPresetsPage } from './features/cardNews/PlatformPresetsPage';
import { CardNewsListPage } from './features/cardNews/CardNewsListPage';
import { CardNewsDetailPage } from './features/cardNews/CardNewsDetailPage';
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
      <Route path="/admin/check-ins">
        <ProtectedRoute>
          <AdminCheckInsPage />
        </ProtectedRoute>
      </Route>
      <Route path="/admin/instructors">
        <ProtectedRoute>
          <InstructorListPage />
        </ProtectedRoute>
      </Route>
      <Route path="/admin/courses">
        <ProtectedRoute>
          <CourseListPage />
        </ProtectedRoute>
      </Route>
      <Route path="/admin/courses/:courseId">
        <ProtectedRoute>
          <CourseDetailPage />
        </ProtectedRoute>
      </Route>
      <Route path="/admin/messaging/settings">
        <ProtectedRoute>
          <MessagingSettingsPage />
        </ProtectedRoute>
      </Route>
      <Route path="/admin/messaging/templates">
        <ProtectedRoute>
          <MessageTemplatesPage />
        </ProtectedRoute>
      </Route>
      <Route path="/admin/card-news/presets">
        <ProtectedRoute>
          <PlatformPresetsPage />
        </ProtectedRoute>
      </Route>
      <Route path="/admin/card-news/:projectId">
        <ProtectedRoute>
          <CardNewsDetailPage />
        </ProtectedRoute>
      </Route>
      <Route path="/admin/card-news">
        <ProtectedRoute>
          <CardNewsListPage />
        </ProtectedRoute>
      </Route>
    </Switch>
  );
}
