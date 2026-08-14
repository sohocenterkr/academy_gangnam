import type { NextFunction, Request, Response } from 'express';

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const message = err instanceof Error ? err.message : 'Unexpected server error';
  console.error(`[${req.requestId}]`, message);

  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: '요청을 처리하는 중 오류가 발생했습니다.',
      requestId: req.requestId,
    },
  });
}
