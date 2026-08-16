import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

const TOKEN_TTL_MS = 60_000;
const TOKEN_NAMESPACE = 'checkin-selection';

export interface CheckinSelectionPayload {
  studentId: string;
  nonce: string;
  issuedAt: number;
}

export function createSelectionToken(studentId: string, secret: string): string {
  const nonce = randomUUID();
  const issuedAt = Date.now();
  const payload = `${TOKEN_NAMESPACE}:${studentId}:${nonce}:${issuedAt}`;
  const signature = createHmac('sha256', secret).update(payload).digest('hex');
  return Buffer.from(`${payload}:${signature}`, 'utf8').toString('base64url');
}

export function verifySelectionToken(token: string, secret: string): CheckinSelectionPayload | null {
  let decoded: string;
  try {
    decoded = Buffer.from(token, 'base64url').toString('utf8');
  } catch {
    return null;
  }

  const parts = decoded.split(':');
  if (parts.length !== 5) return null;
  const [namespace, studentId, nonce, issuedAtRaw, signature] = parts;
  if (namespace !== TOKEN_NAMESPACE || !studentId || !nonce) return null;

  const issuedAt = Number(issuedAtRaw);
  if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > TOKEN_TTL_MS) return null;

  const payload = `${namespace}:${studentId}:${nonce}:${issuedAtRaw}`;
  const expected = createHmac('sha256', secret).update(payload).digest('hex');

  const expectedBuffer = Buffer.from(expected, 'hex');
  const actualBuffer = Buffer.from(signature ?? '', 'hex');
  if (expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) {
    return null;
  }

  return { studentId, nonce, issuedAt };
}
