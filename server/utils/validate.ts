import type { Response } from 'express';
import type { ZodType } from 'zod';

export function parseBody<T>(
  schema: ZodType<T>,
  body: unknown,
  res: Response,
  requestId: string
): T | undefined {
  const result = schema.safeParse(body);

  if (!result.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || '_root';
      (fieldErrors[key] ??= []).push(issue.message);
    }
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: '입력값을 확인해 주세요.',
        fieldErrors,
        requestId,
      },
    });
    return undefined;
  }

  return result.data;
}
