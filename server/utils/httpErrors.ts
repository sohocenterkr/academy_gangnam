import type { Response } from 'express';

export function sendVersionConflict(res: Response, requestId: string): void {
  res.status(409).json({
    error: { code: 'VERSION_CONFLICT', message: '다른 곳에서 이미 변경되었습니다. 새로고침 후 다시 시도해 주세요.', requestId },
  });
}

/**
 * Walks an error's `.cause` chain looking for a Postgres unique-violation whose message or
 * `constraint` field mentions the given index name. Shared across routes that need to catch a
 * specific unique-constraint violation (idempotency keys, duplicate-active-record indexes, etc.)
 * rather than re-implementing this walk in each route file.
 */
export function isUniqueViolation(error: unknown, indexName: string): boolean {
  let current: unknown = error;
  while (current) {
    if (current instanceof Error) {
      if (current.message.includes(indexName)) return true;
      const constraint = (current as { constraint?: unknown }).constraint;
      if (typeof constraint === 'string' && constraint.includes(indexName)) return true;
      current = current.cause;
      continue;
    }
    break;
  }
  return false;
}
