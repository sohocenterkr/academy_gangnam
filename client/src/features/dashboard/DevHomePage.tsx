import { useEffect, useState } from 'react';
import { apiGet } from '../../lib/apiClient';

interface HealthStatus {
  status: string;
}

export function DevHomePage() {
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');

  useEffect(() => {
    apiGet<HealthStatus>('/api/health')
      .then(() => setStatus('ok'))
      .catch(() => setStatus('error'));
  }, []);

  return (
    <section>
      <h1 className="text-xl font-semibold">학원 업무자동화</h1>
      <p data-testid="health-status" className="mt-2 text-gray-600">
        {status === 'loading' && '서버 상태 확인 중...'}
        {status === 'ok' && '서버 연결 정상'}
        {status === 'error' && '서버 연결 실패'}
      </p>
    </section>
  );
}
