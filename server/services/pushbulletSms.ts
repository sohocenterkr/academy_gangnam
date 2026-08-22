const PUSHBULLET_API_BASE = 'https://api.pushbullet.com/v2';

export interface SendSmsParams {
  accessToken: string;
  targetDeviceIden: string;
  addresses: string[];
  message: string;
  guid: string;
  fileUrl?: string;
  fileType?: string;
  fileName?: string;
}

export interface SendSmsResult {
  iden: string;
  status: string;
}

export interface PushbulletSmsClient {
  sendSms(params: SendSmsParams): Promise<SendSmsResult>;
}

/**
 * Adapter for Pushbullet's "SMS by Pushbullet" Texts API (POST /v2/texts), which relays a
 * message through a paired Android device's own SMS/MMS app. This is a best-effort request —
 * a successful response here means Pushbullet accepted the relay request, not that the carrier
 * delivered the message (spec §13.5 keeps these statuses distinct). Verify the exact request/
 * response shape against Pushbullet's current docs before relying on this for a real send; it
 * hasn't been exercised against a live device yet.
 */
export function createPushbulletSmsClient(): PushbulletSmsClient {
  return {
    async sendSms(params) {
      const response = await fetch(`${PUSHBULLET_API_BASE}/texts`, {
        method: 'POST',
        headers: { 'Access-Token': params.accessToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: {
            target_device_iden: params.targetDeviceIden,
            addresses: params.addresses,
            message: params.message,
            guid: params.guid,
            ...(params.fileUrl ? { file_type: params.fileType, file_url: params.fileUrl, file_name: params.fileName } : {}),
          },
        }),
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Pushbullet texts request failed: ${response.status} ${body}`);
      }
      const body = (await response.json()) as { iden: string; data?: { status?: string } };
      return { iden: body.iden, status: body.data?.status ?? 'requested' };
    },
  };
}
