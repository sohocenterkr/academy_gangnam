import { AppShell } from './components/layout/AppShell';
import { ErrorBoundary } from './components/feedback/ErrorBoundary';
import { AppRoutes } from './routes';

export function App() {
  return (
    <ErrorBoundary>
      <AppShell>
        <AppRoutes />
      </AppShell>
    </ErrorBoundary>
  );
}
