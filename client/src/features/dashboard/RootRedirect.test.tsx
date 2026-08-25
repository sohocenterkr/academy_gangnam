import { render, screen, waitFor } from '@testing-library/react';
import { Router } from 'wouter';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RootRedirect } from './RootRedirect';

describe('RootRedirect', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('redirects to /login when not authenticated', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }));

    let location = '/';
    render(
      <Router hook={() => [location, (to: string) => (location = to)]}>
        <RootRedirect />
      </Router>
    );

    await waitFor(() => expect(location).toBe('/login'));
    expect(screen.queryByText('확인 중...')).not.toBeInTheDocument();
  });

  it('redirects to /admin when authenticated', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: { id: 'admin-1', email: 'a@b.com', name: '관리자', role: { id: 'r1', name: '최고관리자', permissions: ['*'] } },
          meta: { requestId: 'req-1', kstTimestamp: '2026-08-15T00:30:00+09:00' },
        }),
      })
    );

    let location = '/';
    render(
      <Router hook={() => [location, (to: string) => (location = to)]}>
        <RootRedirect />
      </Router>
    );

    await waitFor(() => expect(location).toBe('/admin'));
  });
});
