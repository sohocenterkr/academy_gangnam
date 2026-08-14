import { describe, expect, it } from 'vitest';
import {
  SESSION_COOKIE_NAME,
  buildExpiredSessionCookie,
  buildSessionCookie,
  readSessionCookie,
} from './cookies';

describe('session cookie utilities', () => {
  it('reads the session token back out of a Cookie header', () => {
    const header = `other=1; ${SESSION_COOKIE_NAME}=abc123; another=2`;
    expect(readSessionCookie(header)).toBe('abc123');
  });

  it('returns null when the session cookie is absent', () => {
    expect(readSessionCookie('other=1; another=2')).toBeNull();
  });

  it('returns null when there is no cookie header at all', () => {
    expect(readSessionCookie(undefined)).toBeNull();
  });

  it('builds a session cookie without Secure in non-production', () => {
    const cookie = buildSessionCookie('tok', false);
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=tok`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).not.toContain('Secure');
  });

  it('builds a session cookie with Secure in production', () => {
    expect(buildSessionCookie('tok', true)).toContain('Secure');
  });

  it('builds an expired cookie that clears the value', () => {
    const cookie = buildExpiredSessionCookie(false);
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=;`);
    expect(cookie).toContain('Max-Age=0');
  });
});
