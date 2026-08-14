import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { parseBody } from './validate';

describe('parseBody', () => {
  const schema = z.object({ email: z.string().email(), age: z.number().int().min(0) });

  it('returns the parsed data when the body is valid', () => {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as never;
    const result = parseBody(schema, { email: 'a@b.com', age: 5 }, res, 'req-1');
    expect(result).toEqual({ email: 'a@b.com', age: 5 });
    expect(res.status).not.toHaveBeenCalled();
  });

  it('responds with a 400 VALIDATION_ERROR envelope and returns undefined on invalid input', () => {
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const res = { status } as never;

    const result = parseBody(schema, { email: 'not-an-email', age: -1 }, res, 'req-2');

    expect(result).toBeUndefined();
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'VALIDATION_ERROR',
          requestId: 'req-2',
          fieldErrors: expect.objectContaining({
            email: expect.any(Array),
            age: expect.any(Array),
          }),
        }),
      })
    );
  });
});
