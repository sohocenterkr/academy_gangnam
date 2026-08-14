import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { readSessionCookie } from '../utils/cookies';
import { getAdminBySessionToken, type AdminSessionContext } from '../services/session';

declare module 'express-serve-static-core' {
  interface Request {
    admin?: AdminSessionContext;
  }
}

export function createRequireAuth(secret: string): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const token = readSessionCookie(req.headers.cookie);

    if (!token) {
      res.status(401).json({
        error: { code: 'UNAUTHENTICATED', message: '로그인이 필요합니다.', requestId: req.requestId },
      });
      return;
    }

    const admin = await getAdminBySessionToken(token, secret);
    if (!admin) {
      res.status(401).json({
        error: { code: 'UNAUTHENTICATED', message: '로그인이 필요합니다.', requestId: req.requestId },
      });
      return;
    }

    req.admin = admin;
    next();
  };
}
