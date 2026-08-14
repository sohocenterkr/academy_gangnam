import { randomBytes, createHmac } from 'node:crypto';

export function generateToken(): string {
  return randomBytes(32).toString('hex');
}

export function hashToken(rawToken: string, secret: string): string {
  return createHmac('sha256', secret).update(rawToken).digest('hex');
}
