import { Redirect } from 'wouter';
import { useAuth } from '../../hooks/useAuth';

export function RootRedirect() {
  const { admin, loading } = useAuth();

  if (loading) {
    return <p className="p-4 text-gray-500">확인 중...</p>;
  }

  return <Redirect to={admin ? '/admin' : '/login'} />;
}
