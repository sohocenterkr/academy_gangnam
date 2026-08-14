import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db';
import { admins, passwordResetTokens } from '@shared/schema';
import { generateToken, hashToken } from '../utils/sessionToken';
import { hashPassword } from '../utils/password';
import { revokeAllSessionsForAdmin } from './session';
import type { EmailAdapter } from './email';

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
// This module does not receive AUTH_SESSION_SECRET directly to keep its signature small;
// reset tokens are hashed with a fixed, distinct label so they can never collide with a
// session-token hash even if the same secret value were reused.
const RESET_TOKEN_HASH_SECRET_SUFFIX = ':password-reset';

function hashResetToken(rawToken: string, secret: string): string {
  return hashToken(rawToken, secret + RESET_TOKEN_HASH_SECRET_SUFFIX);
}

export async function requestPasswordReset(
  email: string,
  appUrl: string,
  emailAdapter: EmailAdapter,
  secret: string = process.env.AUTH_SESSION_SECRET ?? ''
): Promise<void> {
  const [admin] = await db.select().from(admins).where(eq(admins.email, email));
  if (!admin || admin.status !== 'active') {
    return;
  }

  const rawToken = generateToken();
  await db.insert(passwordResetTokens).values({
    adminId: admin.id,
    tokenHash: hashResetToken(rawToken, secret),
    expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
  });

  const resetUrl = `${appUrl}/reset-password?token=${rawToken}`;
  await emailAdapter.sendPasswordResetEmail(admin.email, resetUrl);
}

export async function resetPassword(
  rawToken: string,
  newPassword: string,
  secret: string = process.env.AUTH_SESSION_SECRET ?? ''
): Promise<{ success: true } | { success: false; code: string }> {
  const tokenHash = hashResetToken(rawToken, secret);
  const now = new Date();

  const [tokenRow] = await db
    .select()
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.tokenHash, tokenHash),
        isNull(passwordResetTokens.usedAt)
      )
    );

  if (!tokenRow || tokenRow.expiresAt < now) {
    return { success: false, code: 'INVALID_RESET_TOKEN' };
  }

  const passwordHash = await hashPassword(newPassword);

  await db.update(admins).set({ passwordHash, updatedAt: now }).where(eq(admins.id, tokenRow.adminId));
  await db.update(passwordResetTokens).set({ usedAt: now }).where(eq(passwordResetTokens.id, tokenRow.id));
  await revokeAllSessionsForAdmin(tokenRow.adminId);

  return { success: true };
}
