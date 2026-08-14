import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

const validEnv = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  AUTH_SESSION_SECRET: 'a'.repeat(32),
  INITIAL_ADMIN_EMAIL: 'admin@example.com',
  INITIAL_ADMIN_PASSWORD: 'password123',
  INITIAL_ADMIN_NAME: '관리자',
  RESEND_API_KEY: 're_test_key',
  RESEND_FROM_EMAIL: 'noreply@example.com',
};

describe('loadEnv', () => {
  it('applies defaults for optional values when required values are present', () => {
    const env = loadEnv(validEnv);
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(8787);
  });

  it('coerces PORT from a string to a number', () => {
    const env = loadEnv({ ...validEnv, PORT: '3000' });
    expect(env.PORT).toBe(3000);
  });

  it('rejects an invalid APP_URL', () => {
    expect(() => loadEnv({ ...validEnv, APP_URL: 'not-a-url' })).toThrow(/APP_URL/);
  });

  it('rejects when DATABASE_URL is missing', () => {
    const { DATABASE_URL: _omit, ...rest } = validEnv;
    expect(() => loadEnv(rest)).toThrow(/DATABASE_URL/);
  });

  it('rejects when AUTH_SESSION_SECRET is too short', () => {
    expect(() => loadEnv({ ...validEnv, AUTH_SESSION_SECRET: 'short' })).toThrow(
      /AUTH_SESSION_SECRET/
    );
  });

  it('rejects an invalid INITIAL_ADMIN_EMAIL', () => {
    expect(() => loadEnv({ ...validEnv, INITIAL_ADMIN_EMAIL: 'not-an-email' })).toThrow(
      /INITIAL_ADMIN_EMAIL/
    );
  });
});
