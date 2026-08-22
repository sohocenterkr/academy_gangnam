import { type FormEvent, useEffect, useState } from 'react';
import { ApiRequestError, apiDelete, apiGet, apiPatch, apiPost } from '../../lib/apiClient';

interface PushbulletStatus {
  status: 'connected' | 'disconnected' | 'error';
  displayName: string | null;
  lastCheckedAt: string | null;
  lastErrorCode: string | null;
  deviceCount: number;
}

interface Device {
  id: string;
  externalDeviceId: string;
  nickname: string;
  deviceType: string | null;
  isEnabled: boolean;
  isDefault: boolean;
  lastSeenAt: string | null;
}

export function MessagingSettingsPage() {
  const [pushbullet, setPushbullet] = useState<PushbulletStatus | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [accessToken, setAccessToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const settings = await apiGet<{ pushbullet: PushbulletStatus }>('/api/messaging/settings');
    setPushbullet(settings.pushbullet);
    setDevices(settings.pushbullet.status === 'connected' ? await apiGet<Device[]>('/api/messaging/devices') : []);
  }

  useEffect(() => {
    async function loadOnMount() {
      try {
        await load();
      } catch (err) {
        setError(err instanceof ApiRequestError ? err.message : '불러오지 못했습니다.');
      }
    }
    void loadOnMount();
  }, []);

  async function handleConnect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await apiPost('/api/messaging/pushbullet/connect', { accessToken });
      setAccessToken('');
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '연결하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    if (!window.confirm('Pushbullet 연결을 해제할까요? 등록된 기기 정보도 함께 삭제됩니다.')) return;
    setError(null);
    setBusy(true);
    try {
      await apiDelete('/api/messaging/pushbullet');
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '연결 해제하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSync() {
    setError(null);
    setBusy(true);
    try {
      await apiPost('/api/messaging/devices/sync', {});
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '기기 동기화에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleEnabled(device: Device) {
    setError(null);
    try {
      await apiPatch(`/api/messaging/devices/${device.id}`, { isEnabled: !device.isEnabled });
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '기기 설정을 변경하지 못했습니다.');
    }
  }

  async function handleSetDefault(device: Device) {
    setError(null);
    try {
      await apiPatch(`/api/messaging/devices/${device.id}`, { isDefault: true });
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '기본 기기로 설정하지 못했습니다.');
    }
  }

  return (
    <section className="p-4">
      <h1 className="text-xl font-semibold">문자 발송 설정</h1>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      )}

      <div className="mt-4 rounded border border-gray-200 p-4">
        <h2 className="font-medium">Pushbullet 연결</h2>
        {pushbullet?.status === 'connected' ? (
          <div className="mt-2 space-y-2">
            <p>
              연결됨 — <strong>{pushbullet.displayName}</strong>
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={handleSync} disabled={busy} className="rounded bg-gray-200 px-4 py-2 disabled:opacity-50">
                기기 동기화
              </button>
              <button type="button" onClick={handleDisconnect} disabled={busy} className="rounded bg-red-600 px-4 py-2 text-white disabled:opacity-50">
                연결 해제
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleConnect} className="mt-2 flex flex-col gap-2">
            <p className="text-sm text-gray-600">연결되지 않았습니다. Pushbullet 액세스 토큰을 입력해 주세요.</p>
            <input
              value={accessToken}
              onChange={(event) => setAccessToken(event.target.value)}
              required
              type="password"
              placeholder="Pushbullet 액세스 토큰"
              className="rounded border border-gray-300 px-3 py-2 text-base"
            />
            <button type="submit" disabled={busy} className="self-start rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50">
              연결
            </button>
          </form>
        )}
      </div>

      {pushbullet?.status === 'connected' && (
        <div className="mt-4 rounded border border-gray-200 p-4">
          <h2 className="font-medium">기기 목록</h2>
          {devices.length === 0 && <p className="mt-2 text-sm text-gray-500">기기가 없습니다. 동기화를 눌러주세요.</p>}
          <ul className="mt-2 space-y-2">
            {devices.map((device) => (
              <li key={device.id} className="flex items-center justify-between rounded border border-gray-200 p-2">
                <div>
                  <span className="font-medium">{device.nickname}</span>
                  <span className="ml-2 text-sm text-gray-500">{device.deviceType}</span>
                  {device.isDefault && <span className="ml-2 text-xs text-blue-600">기본기기</span>}
                </div>
                <div className="flex gap-2">
                  <label className="flex items-center gap-1 text-sm">
                    <input type="checkbox" checked={device.isEnabled} onChange={() => handleToggleEnabled(device)} />
                    사용
                  </label>
                  {!device.isDefault && (
                    <button type="button" onClick={() => handleSetDefault(device)} className="text-sm text-blue-600 underline">
                      기본으로
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
