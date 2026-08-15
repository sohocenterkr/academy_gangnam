import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { admins, roles } from '@shared/schema';
import { verifyPassword } from '../utils/password';
import { bootstrapAdmin } from './bootstrapAdmin';

// This role name is disposable test fixture data — it can never collide with the
// real super-admin role (SUPER_ADMIN_ROLE_NAME === '최고관리자') because bootstrapAdmin()
// is called here with an explicit `roleName` override. Never touch the real
// '최고관리자' role or any admin under it from this test file.
const TEST_ROLE_NAME = 'test-bootstrap-admin-role';
const TEST_EMAIL = 'test-bootstrap-admin@example.com';
const SECOND_TEST_EMAIL = 'test-bootstrap-admin-2@example.com';

async function cleanupTestFixture() {
  const [role] = await db.select().from(roles).where(eq(roles.name, TEST_ROLE_NAME));
  if (role) {
    await db.delete(admins).where(eq(admins.roleId, role.id));
    await db.delete(roles).where(eq(roles.id, role.id));
  }
  // In case an admin row was ever left behind under a different/no role.
  await db.delete(admins).where(eq(admins.email, TEST_EMAIL));
  await db.delete(admins).where(eq(admins.email, SECOND_TEST_EMAIL));
}

describe('bootstrapAdmin', () => {
  afterEach(async () => {
    await cleanupTestFixture();
  });

  it('creates the super-admin role and initial admin when none exists', async () => {
    await bootstrapAdmin(
      {
        INITIAL_ADMIN_EMAIL: TEST_EMAIL,
        INITIAL_ADMIN_PASSWORD: 'initial-password-123',
        INITIAL_ADMIN_NAME: '테스트관리자',
      },
      { roleName: TEST_ROLE_NAME },
    );

    const [createdRole] = await db.select().from(roles).where(eq(roles.name, TEST_ROLE_NAME));
    expect(createdRole).toBeDefined();
    if (!createdRole) {
      throw new Error('Role creation failed in test');
    }
    expect(createdRole.permissions).toEqual(['*']);

    const [createdAdmin] = await db.select().from(admins).where(eq(admins.email, TEST_EMAIL));
    expect(createdAdmin).toBeDefined();
    if (!createdAdmin) {
      throw new Error('Admin creation failed in test');
    }
    expect(createdAdmin.name).toBe('테스트관리자');
    expect(createdAdmin.roleId).toBe(createdRole.id);
    await expect(verifyPassword('initial-password-123', createdAdmin.passwordHash)).resolves.toBe(true);
  });

  it('does nothing on a second run once a super-admin already exists under that role', async () => {
    await bootstrapAdmin(
      {
        INITIAL_ADMIN_EMAIL: TEST_EMAIL,
        INITIAL_ADMIN_PASSWORD: 'initial-password-123',
        INITIAL_ADMIN_NAME: '테스트관리자',
      },
      { roleName: TEST_ROLE_NAME },
    );

    await bootstrapAdmin(
      {
        INITIAL_ADMIN_EMAIL: SECOND_TEST_EMAIL,
        INITIAL_ADMIN_PASSWORD: 'different-password-456',
        INITIAL_ADMIN_NAME: '다른관리자',
      },
      { roleName: TEST_ROLE_NAME },
    );

    // Verify the second admin was never inserted under the disposable test role.
    const fakeAdmins = await db.select().from(admins).where(eq(admins.email, SECOND_TEST_EMAIL));
    expect(fakeAdmins).toHaveLength(0);

    // The role should still only have the first admin under it.
    const [role] = await db.select().from(roles).where(eq(roles.name, TEST_ROLE_NAME));
    expect(role).toBeDefined();
    if (role) {
      const adminsUnderRole = await db.select().from(admins).where(eq(admins.roleId, role.id));
      expect(adminsUnderRole).toHaveLength(1);
      expect(adminsUnderRole[0]?.email).toBe(TEST_EMAIL);
    }
  });
});
