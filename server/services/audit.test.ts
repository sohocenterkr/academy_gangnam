import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { auditLogs } from '@shared/schema';
import { writeAuditLog } from './audit';

describe('writeAuditLog', () => {
  afterEach(async () => {
    await db.delete(auditLogs).where(eq(auditLogs.requestId, 'test-audit-request-id'));
  });

  it('writes a row with the given fields', async () => {
    await writeAuditLog({
      adminId: null,
      roleSnapshot: '최고관리자',
      action: 'admin.create',
      targetType: 'admin',
      targetId: 'some-admin-id',
      beforeDataSafe: null,
      afterDataSafe: { email: 'a@b.com' },
      result: 'success',
      requestId: 'test-audit-request-id',
    });

    const [row] = await db.select().from(auditLogs).where(eq(auditLogs.requestId, 'test-audit-request-id'));
    if (!row) throw new Error('expected audit log row to have been written');
    expect(row.action).toBe('admin.create');
    expect(row.targetType).toBe('admin');
    expect(row.result).toBe('success');
    expect(row.afterDataSafe).toEqual({ email: 'a@b.com' });
  });
});
