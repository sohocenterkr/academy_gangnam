const PUSHBULLET_API_BASE = 'https://api.pushbullet.com/v2';

export interface PushbulletUser {
  email: string;
  name: string;
}

export interface PushbulletDevice {
  iden: string;
  nickname: string;
  type: string | null;
  active: boolean;
}

export interface PushbulletClient {
  getUser(accessToken: string): Promise<PushbulletUser | null>;
  listDevices(accessToken: string): Promise<PushbulletDevice[]>;
}

export function createPushbulletClient(): PushbulletClient {
  return {
    async getUser(accessToken) {
      const response = await fetch(`${PUSHBULLET_API_BASE}/users/me`, {
        headers: { 'Access-Token': accessToken },
      });
      if (response.status === 401) return null;
      if (!response.ok) throw new Error(`Pushbullet users/me failed: ${response.status}`);
      const body = (await response.json()) as { email: string; name: string };
      return { email: body.email, name: body.name };
    },
    async listDevices(accessToken) {
      const response = await fetch(`${PUSHBULLET_API_BASE}/devices`, {
        headers: { 'Access-Token': accessToken },
      });
      if (!response.ok) throw new Error(`Pushbullet devices failed: ${response.status}`);
      const body = (await response.json()) as { devices: Array<{ iden: string; nickname?: string; type?: string; active: boolean }> };
      return body.devices
        .filter((device) => device.active)
        .map((device) => ({
          iden: device.iden,
          nickname: device.nickname && device.nickname.length > 0 ? device.nickname : device.iden,
          type: device.type ?? null,
          active: device.active,
        }));
    },
  };
}
