import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { SUPER_ADMIN_WILDCARD_PERMISSION, type Permission } from '@shared/permissions';

export function createRequirePermission(permission: Permission): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const admin = req.admin;
    if (!admin) {
      res.status(401).json({
        error: { code: 'UNAUTHENTICATED', message: '로그인이 필요합니다.', requestId: req.requestId },
      });
      return;
    }

    const hasPermission =
      admin.permissions.includes(SUPER_ADMIN_WILDCARD_PERMISSION) || admin.permissions.includes(permission);

    if (!hasPermission) {
      res.status(403).json({
        error: { code: 'FORBIDDEN', message: '이 작업을 수행할 권한이 없습니다.', requestId: req.requestId },
      });
      return;
    }

    next();
  };
}
