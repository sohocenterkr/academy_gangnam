import { db } from '../db';
import { auditLogs } from '@shared/schema';

export interface AuditLogEntry {
  adminId: string | null;
  roleSnapshot: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  beforeDataSafe: unknown;
  afterDataSafe: unknown;
  result: 'success' | 'failure';
  requestId: string;
}

export async function writeAuditLog(entry: AuditLogEntry): Promise<void> {
  await db.insert(auditLogs).values(entry);
}
