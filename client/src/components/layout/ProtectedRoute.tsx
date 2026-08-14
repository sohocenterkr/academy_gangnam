import type { ReactNode } from 'react';
import { Redirect } from 'wouter';
import { useAuth } from '../../hooks/useAuth';

interface ProtectedRouteProps {
  children: ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { admin, loading } = useAuth();

  if (loading) {
    return <p className="p-4 text-gray-500">확인 중...</p>;
  }

  if (!admin) {
    return <Redirect to="/login" />;
  }

  return <>{children}</>;
}
