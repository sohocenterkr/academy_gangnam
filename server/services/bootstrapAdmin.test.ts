import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { admins, roles } from '@shared/schema';
import { SUPER_ADMIN_ROLE_NAME } from '@shared/permissions';
import { verifyPassword } from '../utils/password';
import { bootstrapAdmin } from './bootstrapAdmin';

const TEST_EMAIL = 'test-bootstrap-admin@example.com';

async function cleanup(): Promise<void> {
  await db.delete(admins).where(eq(admins.email, TEST_EMAIL));
  await db.delete(roles).where(eq(roles.name, SUPER_ADMIN_ROLE_NAME));
}

describe('bootstrapAdmin', () => {
  afterEach(async () => {
    await cleanup();
  });

  it('creates the super-admin role and initial admin when none exists', async () => {
    await cleanup();

    await bootstrapAdmin({
      INITIAL_ADMIN_EMAIL: TEST_EMAIL,
      INITIAL_ADMIN_PASSWORD: 'initial-password-123',
      INITIAL_ADMIN_NAME: '테스트관리자',
    });

    const [role] = await db.select().from(roles).where(eq(roles.name, SUPER_ADMIN_ROLE_NAME));
    expect(role).toBeDefined();
    expect(role.permissions).toEqual(['*']);

    const [admin] = await db.select().from(admins).where(eq(admins.email, TEST_EMAIL));
    expect(admin).toBeDefined();
    expect(admin.name).toBe('테스트관리자');
    expect(admin.roleId).toBe(role.id);
    await expect(verifyPassword('initial-password-123', admin.passwordHash)).resolves.toBe(true);
  });

  it('does nothing on a second run once a super-admin already exists', async () => {
    await cleanup();

    await bootstrapAdmin({
      INITIAL_ADMIN_EMAIL: TEST_EMAIL,
      INITIAL_ADMIN_PASSWORD: 'initial-password-123',
      INITIAL_ADMIN_NAME: '테스트관리자',
    });
    await bootstrapAdmin({
      INITIAL_ADMIN_EMAIL: 'test-bootstrap-admin-2@example.com',
      INITIAL_ADMIN_PASSWORD: 'different-password-456',
      INITIAL_ADMIN_NAME: '다른관리자',
    });

    const allAdmins = await db
      .select()
      .from(admins)
      .where(
        and(eq(admins.email, TEST_EMAIL))
      );
    expect(allAdmins).toHaveLength(1);

    const second = await db
      .select()
      .from(admins)
      .where(eq(admins.email, 'test-bootstrap-admin-2@example.com'));
    expect(second).toHaveLength(0);
  });
});
