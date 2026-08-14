import { Route, Switch } from 'wouter';
import { DevHomePage } from './features/dashboard/DevHomePage';

export function AppRoutes() {
  return (
    <Switch>
      <Route path="/" component={DevHomePage} />
    </Switch>
  );
}
