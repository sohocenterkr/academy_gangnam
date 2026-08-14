import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { admins, authSessions, roles } from '@shared/schema';
import { hashPassword } from '../utils/password';
import {
  createSession,
  getAdminBySessionToken,
  revokeAllSessionsForAdmin,
  revokeSession,
} from './session';

const SECRET = 'test-session-secret-value';
const TEST_EMAIL = 'test-session-admin@example.com';

async function makeTestAdmin() {
  const [role] = await db
    .insert(roles)
    .values({ name: 'test-session-role', permissions: ['x:y'] })
    .returning();
  if (!role) {
    throw new Error('Role creation failed in test');
  }
  const [admin] = await db
    .insert(admins)
    .values({
      email: TEST_EMAIL,
      name: '세션테스트',
      passwordHash: await hashPassword('irrelevant'),
      roleId: role.id,
      status: 'active',
    })
    .returning();
  if (!admin) {
    throw new Error('Admin creation failed in test');
  }
  return { role, admin };
}

describe('session service', () => {
  // A single robust afterEach (rather than an inline cleanup() call at the end of each test)
  // so a failed assertion mid-test still leaves the DB clean for the next test — an assertion
  // throw would otherwise skip an inline cleanup call and leave a session row that blocks the
  // next test's admin deletion via the auth_sessions -> admins foreign key.
  afterEach(async () => {
    const [admin] = await db.select().from(admins).where(eq(admins.email, TEST_EMAIL));
    if (admin) {
      await db.delete(authSessions).where(eq(authSessions.adminId, admin.id));
      await db.delete(admins).where(eq(admins.id, admin.id));
    }
    await db.delete(roles).where(eq(roles.name, 'test-session-role'));
  });

  it('creates a session and resolves it back to the admin via the raw token', async () => {
    const { role, admin } = await makeTestAdmin();

    const { token } = await createSession(admin.id, SECRET);
    const resolved = await getAdminBySessionToken(token, SECRET);

    expect(resolved?.id).toBe(admin.id);
    expect(resolved?.email).toBe(TEST_EMAIL);
    expect(resolved?.roleName).toBe(role.name);
    expect(resolved?.permissions).toEqual(['x:y']);
  });

  it('returns null for an unknown token', async () => {
    await expect(getAdminBySessionToken('not-a-real-token', SECRET)).resolves.toBeNull();
  });

  it('returns null after the session is revoked', async () => {
    const { admin } = await makeTestAdmin();
    const { token } = await createSession(admin.id, SECRET);

    const { hashToken } = await import('../utils/sessionToken');
    await revokeSession(hashToken(token, SECRET));

    await expect(getAdminBySessionToken(token, SECRET)).resolves.toBeNull();
  });

  it('revokeAllSessionsForAdmin invalidates every session for that admin', async () => {
    const { admin } = await makeTestAdmin();
    const first = await createSession(admin.id, SECRET);
    const second = await createSession(admin.id, SECRET);

    await revokeAllSessionsForAdmin(admin.id);

    await expect(getAdminBySessionToken(first.token, SECRET)).resolves.toBeNull();
    await expect(getAdminBySessionToken(second.token, SECRET)).resolves.toBeNull();
  });
});
