import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessagingSettingsPage } from './MessagingSettingsPage';

function jsonResponse(data: unknown) {
  return {
    ok: true,
    json: async () => ({ data, meta: { requestId: 'req', kstTimestamp: '2026-08-22T00:00:00+09:00' } }),
  };
}

describe('MessagingSettingsPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows a connect form when Pushbullet is disconnected', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/messaging/settings' && (!init || init.method === undefined)) {
        return Promise.resolve(jsonResponse({ pushbullet: { status: 'disconnected', displayName: null, lastCheckedAt: null, lastErrorCode: null, deviceCount: 0 } }));
      }
      if (path === '/api/messaging/pushbullet/connect' && init?.method === 'POST') {
        return Promise.resolve(jsonResponse({ status: 'connected', displayName: 'a@b.com' }));
      }
      throw new Error(`unexpected fetch: ${path} ${init?.method ?? 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<MessagingSettingsPage />);

    await screen.findByPlaceholderText('Pushbullet 액세스 토큰');
    fireEvent.change(screen.getByPlaceholderText('Pushbullet 액세스 토큰'), { target: { value: 'o.token' } });
    fireEvent.click(screen.getByRole('button', { name: '연결' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/messaging/pushbullet/connect',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ accessToken: 'o.token' }) })
      )
    );
  });

  it('lists devices and toggles one enabled when connected', async () => {
    const settings = { pushbullet: { status: 'connected', displayName: 'a@b.com', lastCheckedAt: null, lastErrorCode: null, deviceCount: 1 } };
    const devices = [{ id: 'd1', externalDeviceId: 'ext-1', nickname: '카운터 폰', deviceType: 'android', isEnabled: false, isDefault: false, lastSeenAt: null }];
    const fetchMock = vi.fn();
    fetchMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/messaging/settings' && (!init || init.method === undefined)) return Promise.resolve(jsonResponse(settings));
      if (path === '/api/messaging/devices' && (!init || init.method === undefined)) return Promise.resolve(jsonResponse(devices));
      if (path === '/api/messaging/devices/d1' && init?.method === 'PATCH') {
        return Promise.resolve(jsonResponse({ ...devices[0], isEnabled: true }));
      }
      throw new Error(`unexpected fetch: ${path} ${init?.method ?? 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<MessagingSettingsPage />);

    await screen.findByText('카운터 폰');
    fireEvent.click(screen.getByLabelText('사용'));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/messaging/devices/d1',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ isEnabled: true }) })
      )
    );
  });
});
