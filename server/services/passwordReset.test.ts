import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { admins, passwordResetTokens, roles } from '@shared/schema';
import { hashPassword, verifyPassword } from '../utils/password';
import { createFakeEmailAdapter } from './email';
import { requestPasswordReset, resetPassword } from './passwordReset';

const TEST_EMAIL = 'test-password-reset-admin@example.com';

async function seedAdmin() {
  const [role] = await db.insert(roles).values({ name: 'test-reset-role', permissions: [] }).returning();
  if (!role) {
    throw new Error('Role creation failed in test');
  }
  const [admin] = await db
    .insert(admins)
    .values({
      email: TEST_EMAIL,
      name: '재설정테스트',
      passwordHash: await hashPassword('original-password-123'),
      roleId: role.id,
      status: 'active',
    })
    .returning();
  if (!admin) {
    throw new Error('Admin creation failed in test');
  }
  return { role, admin };
}

async function cleanup() {
  const [admin] = await db.select().from(admins).where(eq(admins.email, TEST_EMAIL));
  if (admin) {
    await db.delete(passwordResetTokens).where(eq(passwordResetTokens.adminId, admin.id));
  }
  await db.delete(admins).where(eq(admins.email, TEST_EMAIL));
  await db.delete(roles).where(eq(roles.name, 'test-reset-role'));
}

describe('password reset service', () => {
  afterEach(async () => {
    await cleanup();
  });

  it('sends a reset email with a working token when the admin exists', async () => {
    await seedAdmin();
    const emailAdapter = createFakeEmailAdapter();

    await requestPasswordReset(TEST_EMAIL, 'http://localhost:5173', emailAdapter);

    expect(emailAdapter.sentEmails).toHaveLength(1);
    const [sent] = emailAdapter.sentEmails;
    if (!sent) {
      throw new Error('Expected an email to have been sent in test');
    }
    expect(sent.to).toBe(TEST_EMAIL);
    expect(sent.resetUrl).toMatch(/^http:\/\/localhost:5173\/reset-password\?token=/);
  });

  it('does nothing (no throw, no email) when the email does not exist', async () => {
    const emailAdapter = createFakeEmailAdapter();
    await requestPasswordReset('no-such-admin@example.com', 'http://localhost:5173', emailAdapter);
    expect(emailAdapter.sentEmails).toHaveLength(0);
  });

  it('resets the password with a valid token and invalidates the token afterward', async () => {
    await seedAdmin();
    const emailAdapter = createFakeEmailAdapter();
    await requestPasswordReset(TEST_EMAIL, 'http://localhost:5173', emailAdapter);
    const [sent] = emailAdapter.sentEmails;
    if (!sent) {
      throw new Error('Expected an email to have been sent in test');
    }
    const rawToken = new URL(sent.resetUrl).searchParams.get('token');
    if (!rawToken) {
      throw new Error('Expected a token in the reset URL in test');
    }

    const result = await resetPassword(rawToken, 'brand-new-password-456');
    expect(result.success).toBe(true);

    const [admin] = await db.select().from(admins).where(eq(admins.email, TEST_EMAIL));
    if (!admin) {
      throw new Error('Admin not found after reset in test');
    }
    await expect(verifyPassword('brand-new-password-456', admin.passwordHash)).resolves.toBe(true);

    const second = await resetPassword(rawToken, 'another-password-789');
    expect(second.success).toBe(false);
  });

  it('rejects an unknown token', async () => {
    const result = await resetPassword('not-a-real-token', 'whatever-password-123');
    expect(result.success).toBe(false);
  });
});
