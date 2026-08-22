import { describe, expect, it } from 'vitest';
import { encryptToStorage, decryptFromStorage } from './encryption';

describe('encryption', () => {
  it('round-trips plaintext through encrypt/decrypt', () => {
    const encrypted = encryptToStorage('super-secret-token', 'a-strong-server-secret');
    expect(encrypted).not.toContain('super-secret-token');
    expect(decryptFromStorage(encrypted, 'a-strong-server-secret')).toBe('super-secret-token');
  });

  it('fails to decrypt with the wrong secret', () => {
    const encrypted = encryptToStorage('super-secret-token', 'correct-secret');
    expect(() => decryptFromStorage(encrypted, 'wrong-secret')).toThrow();
  });
});
