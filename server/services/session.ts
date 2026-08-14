import { and, eq, gt, isNull } from 'drizzle-orm';
import { db } from '../db';
import { admins, authSessions, roles } from '@shared/schema';
import { generateToken, hashToken } from '../utils/sessionToken';
import { SESSION_MAX_AGE_SECONDS } from '../utils/cookies';

export interface AdminSessionContext {
  id: string;
  email: string;
  name: string;
  roleId: string;
  roleName: string;
  permissions: string[];
}

export async function createSession(
  adminId: string,
  secret: string
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);

  await db.insert(authSessions).values({
    adminId,
    tokenHash: hashToken(token, secret),
    expiresAt,
  });

  return { token, expiresAt };
}

export async function revokeSession(tokenHash: string): Promise<void> {
  await db
    .update(authSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(authSessions.tokenHash, tokenHash), isNull(authSessions.revokedAt)));
}

export async function revokeAllSessionsForAdmin(adminId: string): Promise<void> {
  await db
    .update(authSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(authSessions.adminId, adminId), isNull(authSessions.revokedAt)));
}

export async function getAdminBySessionToken(
  rawToken: string,
  secret: string
): Promise<AdminSessionContext | null> {
  const tokenHash = hashToken(rawToken, secret);
  const now = new Date();

  const rows = await db
    .select({
      adminId: admins.id,
      email: admins.email,
      name: admins.name,
      status: admins.status,
      roleId: roles.id,
      roleName: roles.name,
      permissions: roles.permissions,
    })
    .from(authSessions)
    .innerJoin(admins, eq(authSessions.adminId, admins.id))
    .innerJoin(roles, eq(admins.roleId, roles.id))
    .where(
      and(
        eq(authSessions.tokenHash, tokenHash),
        isNull(authSessions.revokedAt),
        gt(authSessions.expiresAt, now),
        isNull(admins.deletedAt)
      )
    );

  const row = rows[0];
  if (!row || row.status !== 'active') return null;

  return {
    id: row.adminId,
    email: row.email,
    name: row.name,
    roleId: row.roleId,
    roleName: row.roleName,
    permissions: row.permissions,
  };
}
