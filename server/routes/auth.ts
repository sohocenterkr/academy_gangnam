import { eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { admins } from '@shared/schema';
import { verifyPassword } from '../utils/password';
import { buildExpiredSessionCookie, buildSessionCookie } from '../utils/cookies';
import { parseBody } from '../utils/validate';
import { createRateLimiter } from '../utils/rateLimit';
import { createRequireAuth } from '../middleware/auth';
import { createSession, revokeSession } from '../services/session';
import { hashToken } from '../utils/sessionToken';
import { readSessionCookie } from '../utils/cookies';
import { getNowKSTISOString } from '@shared/kst';

const GENERIC_LOGIN_FAILURE = { code: 'UNAUTHENTICATED', message: '이메일 또는 비밀번호가 올바르지 않습니다.' };
const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export interface AuthRouterDeps {
  sessionSecret: string;
  isProduction: boolean;
}

export function createAuthRouter(deps: AuthRouterDeps): Router {
  const router = Router();
  const requireAuth = createRequireAuth(deps.sessionSecret);
  const loginLimiter = createRateLimiter({ limit: 10, windowMs: 15 * 60 * 1000 });

  router.post('/login', async (req, res) => {
    if (!loginLimiter(req.ip ?? 'unknown')) {
      res.status(429).json({
        error: { code: 'RATE_LIMITED', message: '잠시 후 다시 시도해 주세요.', requestId: req.requestId },
      });
      return;
    }

    const parsed = parseBody(loginSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const [admin] = await db.select().from(admins).where(eq(admins.email, parsed.email));

    if (!admin || admin.status !== 'active' || (admin.lockedUntil && admin.lockedUntil > new Date())) {
      res.status(401).json({ error: { ...GENERIC_LOGIN_FAILURE, requestId: req.requestId } });
      return;
    }

    const passwordOk = await verifyPassword(parsed.password, admin.passwordHash);
    if (!passwordOk) {
      const failedCount = admin.failedLoginCount + 1;
      const shouldLock = failedCount >= MAX_FAILED_LOGINS;
      await db
        .update(admins)
        .set({
          failedLoginCount: shouldLock ? 0 : failedCount,
          lockedUntil: shouldLock ? new Date(Date.now() + LOCKOUT_MS) : admin.lockedUntil,
          updatedAt: new Date(),
        })
        .where(eq(admins.id, admin.id));
      res.status(401).json({ error: { ...GENERIC_LOGIN_FAILURE, requestId: req.requestId } });
      return;
    }

    await db
      .update(admins)
      .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date(), updatedAt: new Date() })
      .where(eq(admins.id, admin.id));

    const { token } = await createSession(admin.id, deps.sessionSecret);
    res.setHeader('Set-Cookie', buildSessionCookie(token, deps.isProduction));
    res.json({
      data: { id: admin.id, email: admin.email, name: admin.name },
      meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() },
    });
  });

  router.post('/logout', requireAuth, async (req, res) => {
    const token = readSessionCookie(req.headers.cookie);
    if (token) {
      await revokeSession(hashToken(token, deps.sessionSecret));
    }
    res.setHeader('Set-Cookie', buildExpiredSessionCookie(deps.isProduction));
    res.json({
      data: { success: true },
      meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() },
    });
  });

  router.get('/me', requireAuth, (req, res) => {
    res.json({
      data: {
        id: req.admin!.id,
        email: req.admin!.email,
        name: req.admin!.name,
        role: { id: req.admin!.roleId, name: req.admin!.roleName, permissions: req.admin!.permissions },
      },
      meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() },
    });
  });

  return router;
}
