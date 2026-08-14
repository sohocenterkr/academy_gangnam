import { describe, expect, it } from 'vitest';
import { generateToken, hashToken } from './sessionToken';

describe('session token utilities', () => {
  it('generates a long random token each time', () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
    expect(a).toHaveLength(64);
  });

  it('hashes the same token+secret pair to the same value deterministically', () => {
    const token = generateToken();
    expect(hashToken(token, 'secret-a')).toBe(hashToken(token, 'secret-a'));
  });

  it('produces different hashes for different secrets given the same token', () => {
    const token = generateToken();
    expect(hashToken(token, 'secret-a')).not.toBe(hashToken(token, 'secret-b'));
  });

  it('produces different hashes for different tokens given the same secret', () => {
    expect(hashToken(generateToken(), 'secret-a')).not.toBe(hashToken(generateToken(), 'secret-a'));
  });
});
