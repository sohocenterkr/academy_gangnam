import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password';

describe('password hashing', () => {
  it('hashes a password so the raw value is not stored', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).not.toBe('correct horse battery staple');
    expect(hash.length).toBeGreaterThan(20);
  });

  it('verifies a correct password against its hash', async () => {
    const hash = await hashPassword('my-secret-password');
    await expect(verifyPassword('my-secret-password', hash)).resolves.toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('my-secret-password');
    await expect(verifyPassword('wrong-password', hash)).resolves.toBe(false);
  });
});
