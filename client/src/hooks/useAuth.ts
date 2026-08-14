import { useCallback, useEffect, useState } from 'react';
import { ApiRequestError, apiGet } from '../lib/apiClient';

export interface AuthenticatedAdmin {
  id: string;
  email: string;
  name: string;
  role: { id: string; name: string; permissions: string[] };
}

export function useAuth() {
  const [admin, setAdmin] = useState<AuthenticatedAdmin | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiRequestError | null>(null);

  const fetchAdmin = useCallback(() => {
    return apiGet<AuthenticatedAdmin>('/api/auth/me')
      .then((result) => {
        setAdmin(result);
        setError(null);
      })
      .catch((err: unknown) => {
        setAdmin(null);
        setError(err instanceof ApiRequestError ? err : new ApiRequestError('알 수 없는 오류', 'UNKNOWN', ''));
      })
      .finally(() => setLoading(false));
  }, []);

  const refetch = useCallback(() => {
    setLoading(true);
    setError(null);
    void fetchAdmin();
  }, [fetchAdmin]);

  useEffect(() => {
    void fetchAdmin();
  }, [fetchAdmin]);

  return { admin, loading, error, refetch };
}
