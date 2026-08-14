import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { db } from '../db';
import { admins, roles } from '@shared/schema';
import { SUPER_ADMIN_ROLE_NAME } from '@shared/permissions';
import { verifyPassword } from '../utils/password';
import { bootstrapAdmin } from './bootstrapAdmin';

const TEST_EMAIL = 'test-bootstrap-admin@example.com';
const SECOND_TEST_EMAIL = 'test-bootstrap-admin-2@example.com';

describe('bootstrapAdmin', () => {
  it('creates the super-admin role and initial admin when none exists', async () => {
    // Step 1: Capture existing role and admins (they may exist from Step 6 bootstrap)
    const [existingRole] = await db
      .select()
      .from(roles)
      .where(eq(roles.name, SUPER_ADMIN_ROLE_NAME));

    let existingAdmins: typeof admins.$inferSelect[] = [];
    if (existingRole) {
      existingAdmins = await db
        .select()
        .from(admins)
        .where(eq(admins.roleId, existingRole.id));
    }

    try {
      // Step 2: Delete existing state to create a clean slate
      if (existingRole && existingAdmins.length > 0) {
        // Delete admins first (respects FK)
        for (const admin of existingAdmins) {
          await db.delete(admins).where(eq(admins.id, admin.id));
        }
        // Then delete the role
        await db.delete(roles).where(eq(roles.id, existingRole.id));
      }

      // Step 3: Run test with fake email against clean slate
      await bootstrapAdmin({
        INITIAL_ADMIN_EMAIL: TEST_EMAIL,
        INITIAL_ADMIN_PASSWORD: 'initial-password-123',
        INITIAL_ADMIN_NAME: '테스트관리자',
      });

      const [createdRole] = await db
        .select()
        .from(roles)
        .where(eq(roles.name, SUPER_ADMIN_ROLE_NAME));
      expect(createdRole).toBeDefined();
      expect(createdRole.permissions).toEqual(['*']);

      const [createdAdmin] = await db
        .select()
        .from(admins)
        .where(eq(admins.email, TEST_EMAIL));
      expect(createdAdmin).toBeDefined();
      expect(createdAdmin.name).toBe('테스트관리자');
      expect(createdAdmin.roleId).toBe(createdRole.id);
      await expect(verifyPassword('initial-password-123', createdAdmin.passwordHash)).resolves.toBe(
        true,
      );
    } finally {
      // Step 4: Restore original state
      // Delete test data
      await db.delete(admins).where(eq(admins.email, TEST_EMAIL));
      const [testCreatedRole] = await db
        .select()
        .from(roles)
        .where(eq(roles.name, SUPER_ADMIN_ROLE_NAME));
      if (testCreatedRole) {
        await db.delete(roles).where(eq(roles.id, testCreatedRole.id));
      }

      // Restore original role and admins if they existed
      if (existingRole) {
        await db.insert(roles).values(existingRole);
        for (const admin of existingAdmins) {
          await db.insert(admins).values(admin);
        }
      }

      // Step 5: Verify restoration
      if (existingRole) {
        const [restoredRole] = await db
          .select()
          .from(roles)
          .where(eq(roles.id, existingRole.id));
        expect(restoredRole).toBeDefined();
        expect(restoredRole.id).toBe(existingRole.id);

        const restoredAdminsCheck = await db
          .select()
          .from(admins)
          .where(eq(admins.roleId, existingRole.id));
        expect(restoredAdminsCheck).toHaveLength(existingAdmins.length);
        for (let i = 0; i < existingAdmins.length; i++) {
          expect(restoredAdminsCheck[i].id).toBe(existingAdmins[i].id);
          expect(restoredAdminsCheck[i].email).toBe(existingAdmins[i].email);
        }
      }
    }
  });

  it('does nothing on a second run once a super-admin already exists', async () => {
    // At this point, a real super-admin exists (either from Step 6 or restored by previous test)
    // Just verify that calling bootstrapAdmin with a different email doesn't create a new admin

    await bootstrapAdmin({
      INITIAL_ADMIN_EMAIL: SECOND_TEST_EMAIL,
      INITIAL_ADMIN_PASSWORD: 'different-password-456',
      INITIAL_ADMIN_NAME: '다른관리자',
    });

    // Verify the fake email was never inserted
    const fakeAdmins = await db
      .select()
      .from(admins)
      .where(eq(admins.email, SECOND_TEST_EMAIL));
    expect(fakeAdmins).toHaveLength(0);
  });
});
