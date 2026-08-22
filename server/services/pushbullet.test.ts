import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPushbulletClient } from './pushbullet';

describe('pushbullet client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns null for getUser on a 401 (invalid token)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ status: 401, ok: false, json: async () => ({}) })
    );
    const client = createPushbulletClient();
    expect(await client.getUser('bad-token')).toBeNull();
  });

  it('filters out inactive devices and falls back to the device id when Pushbullet reports no nickname', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          devices: [
            { iden: 'dev-1', nickname: '카운터 폰', type: 'android', active: true },
            { iden: 'dev-2', nickname: '', type: 'android', active: true },
            { iden: 'dev-3', nickname: '오래된 기기', type: 'android', active: false },
          ],
        }),
      })
    );
    const client = createPushbulletClient();
    const devices = await client.listDevices('token');
    expect(devices).toEqual([
      { iden: 'dev-1', nickname: '카운터 폰', type: 'android', active: true },
      { iden: 'dev-2', nickname: 'dev-2', type: 'android', active: true },
    ]);
  });
});
