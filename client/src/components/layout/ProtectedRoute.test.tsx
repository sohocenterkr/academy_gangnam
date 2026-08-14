import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { ProtectedRoute } from './ProtectedRoute';

function renderAt(path: string) {
  const { hook } = memoryLocation({ path, static: true });
  return render(
    <Router hook={hook}>
      <ProtectedRoute>
        <p>보호된 내용</p>
      </ProtectedRoute>
    </Router>
  );
}

describe('ProtectedRoute', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders children when authenticated', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: { id: '1', email: 'a@b.com', name: '관리자', role: { id: 'r1', name: '최고관리자', permissions: ['*'] } },
          meta: { requestId: 'req-1', kstTimestamp: '2026-08-15T00:30:00+09:00' },
        }),
      })
    );

    renderAt('/admin');

    await waitFor(() => expect(screen.getByText('보호된 내용')).toBeInTheDocument());
  });

  it('does not render children when unauthenticated', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: { code: 'UNAUTHENTICATED', message: '로그인이 필요합니다.', requestId: 'req-2' } }),
      })
    );

    renderAt('/admin');

    await waitFor(() => expect(screen.queryByText('보호된 내용')).not.toBeInTheDocument());
  });
});
