import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { db } from '../db';
import { admins, auditLogs, authSessions, passwordResetTokens, roles } from '@shared/schema';
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
    // The real bootstrapped admin may already have history (auth sessions, password
    // reset tokens, audit log entries) once it has been used for a real login or has
    // performed an audited admin/role action — e.g. the e2e login test, or any manual
    // exercise of /api/admins or /api/roles. Those rows reference admins.id with no
    // cascade, so they must be captured and restored alongside the admin itself rather
    // than left to block the delete below.
    const existingAuthSessions: typeof authSessions.$inferSelect[] = [];
    const existingPasswordResetTokens: typeof passwordResetTokens.$inferSelect[] = [];
    const existingAuditLogs: typeof auditLogs.$inferSelect[] = [];
    if (existingRole) {
      existingAdmins = await db
        .select()
        .from(admins)
        .where(eq(admins.roleId, existingRole.id));

      for (const admin of existingAdmins) {
        const sessions = await db
          .select()
          .from(authSessions)
          .where(eq(authSessions.adminId, admin.id));
        existingAuthSessions.push(...sessions);

        const tokens = await db
          .select()
          .from(passwordResetTokens)
          .where(eq(passwordResetTokens.adminId, admin.id));
        existingPasswordResetTokens.push(...tokens);

        const logs = await db
          .select()
          .from(auditLogs)
          .where(eq(auditLogs.adminId, admin.id));
        existingAuditLogs.push(...logs);
      }
    }

    // Whether the destructive delete below actually committed. bootstrapAdmin() reads
    // through the top-level `db` pool (a separate physical connection from any `tx` we'd
    // open here), so it can only observe the "clean slate" once the delete has actually
    // committed — an uncommitted delete inside an open transaction is invisible to other
    // connections under Postgres's default read-committed isolation. That's why the delete
    // is its own committed transaction (atomic: all five tables or none, never a partial
    // delete) rather than one giant transaction spanning the bootstrapAdmin() call too.
    // The safety net this preserves: if the delete transaction itself throws partway
    // through, it rolls back automatically and NOTHING was removed — so `deleted` stays
    // false and the finally block below correctly skips restoring rows that were never
    // taken out in the first place (which would otherwise fail on duplicate keys).
    let deleted = false;

    try {
      // Step 2: Delete existing state to create a clean slate, atomically.
      if (existingRole && existingAdmins.length > 0) {
        await db.transaction(async (tx) => {
          // Delete rows that reference admins.id first (respects FK)
          for (const session of existingAuthSessions) {
            await tx.delete(authSessions).where(eq(authSessions.id, session.id));
          }
          for (const token of existingPasswordResetTokens) {
            await tx.delete(passwordResetTokens).where(eq(passwordResetTokens.id, token.id));
          }
          for (const log of existingAuditLogs) {
            await tx.delete(auditLogs).where(eq(auditLogs.id, log.id));
          }
          // Then delete admins, then the role (respects FK)
          for (const admin of existingAdmins) {
            await tx.delete(admins).where(eq(admins.id, admin.id));
          }
          await tx.delete(roles).where(eq(roles.id, existingRole.id));
        });
        deleted = true;
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
      if (!createdRole) {
        throw new Error('Role creation failed in test');
      }
      expect(createdRole.permissions).toEqual(['*']);

      const [createdAdmin] = await db
        .select()
        .from(admins)
        .where(eq(admins.email, TEST_EMAIL));
      expect(createdAdmin).toBeDefined();
      if (!createdAdmin) {
        throw new Error('Admin creation failed in test');
      }
      expect(createdAdmin.name).toBe('테스트관리자');
      expect(createdAdmin.roleId).toBe(createdRole.id);
      await expect(verifyPassword('initial-password-123', createdAdmin.passwordHash)).resolves.toBe(
        true,
      );
    } finally {
      // Step 4: Restore original state
      // Delete test data (rows referencing the test admin first, then the admin/role)
      const [testCreatedRole] = await db
        .select()
        .from(roles)
        .where(eq(roles.name, SUPER_ADMIN_ROLE_NAME));
      if (testCreatedRole) {
        const [testCreatedAdmin] = await db
          .select()
          .from(admins)
          .where(eq(admins.email, TEST_EMAIL));
        if (testCreatedAdmin) {
          await db.delete(authSessions).where(eq(authSessions.adminId, testCreatedAdmin.id));
          await db.delete(passwordResetTokens).where(eq(passwordResetTokens.adminId, testCreatedAdmin.id));
        }
        await db.delete(admins).where(eq(admins.email, TEST_EMAIL));
        await db.delete(roles).where(eq(roles.id, testCreatedRole.id));
      }

      // Restore original role and admins if we actually deleted them. Restoring is done
      // as a single atomic transaction: either every captured row goes back in (same ids,
      // nothing regenerated) or none of them do, so a mid-restore failure never leaves the
      // real admin's history half-restored.
      if (existingRole && deleted) {
        await db.transaction(async (tx) => {
          await tx.insert(roles).values(existingRole);
          for (const admin of existingAdmins) {
            await tx.insert(admins).values(admin);
          }
          for (const session of existingAuthSessions) {
            await tx.insert(authSessions).values(session);
          }
          for (const token of existingPasswordResetTokens) {
            await tx.insert(passwordResetTokens).values(token);
          }
          for (const log of existingAuditLogs) {
            await tx.insert(auditLogs).values(log);
          }
        });
      }

      // Step 5: Verify restoration
      if (existingRole) {
        const [restoredRole] = await db
          .select()
          .from(roles)
          .where(eq(roles.id, existingRole.id));
        expect(restoredRole).toBeDefined();
        if (restoredRole) {
          expect(restoredRole.id).toBe(existingRole.id);

          const restoredAdminsCheck = await db
            .select()
            .from(admins)
            .where(eq(admins.roleId, existingRole.id));
          expect(restoredAdminsCheck).toHaveLength(existingAdmins.length);
          for (let i = 0; i < existingAdmins.length; i++) {
            const restoredAdmin = restoredAdminsCheck[i];
            const expectedAdmin = existingAdmins[i];
            if (restoredAdmin && expectedAdmin) {
              expect(restoredAdmin.id).toBe(expectedAdmin.id);
              expect(restoredAdmin.email).toBe(expectedAdmin.email);
            }
          }

          for (const admin of existingAdmins) {
            const restoredAuditLogsForAdmin = await db
              .select()
              .from(auditLogs)
              .where(eq(auditLogs.adminId, admin.id));
            const expectedCount = existingAuditLogs.filter((log) => log.adminId === admin.id).length;
            expect(restoredAuditLogsForAdmin).toHaveLength(expectedCount);
          }
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
