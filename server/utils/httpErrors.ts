import type { Response } from 'express';

export function sendVersionConflict(res: Response, requestId: string): void {
  res.status(409).json({
    error: { code: 'VERSION_CONFLICT', message: '다른 곳에서 이미 변경되었습니다. 새로고침 후 다시 시도해 주세요.', requestId },
  });
}
