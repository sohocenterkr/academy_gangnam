import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { db } from '../db';
import { admins, roles, auditLogs, authSessions } from '@shared/schema';
import { hashPassword } from '../utils/password';
import { SUPER_ADMIN_WILDCARD_PERMISSION } from '@shared/permissions';
import { createFakeEmailAdapter } from '../services/email';
import { createApp } from '../app';

const SUPER_EMAIL = 'test-auditlogs-super@example.com';
const PASSWORD = 'test-auditlogs-password-123';

async function seedAdmin() {
  const [role] = await db
    .insert(roles)
    .values({ name: 'test-auditlogs-role', permissions: [SUPER_ADMIN_WILDCARD_PERMISSION], createdAt: new Date(), updatedAt: new Date() })
    .returning();
  const [admin] = await db
    .insert(admins)
    .values({
      email: SUPER_EMAIL,
      name: '수퍼',
      passwordHash: await hashPassword(PASSWORD),
      roleId: role!.id,
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();
  return admin!.id;
}

async function loginAs(app: ReturnType<typeof createApp>, email: string): Promise<string> {
  const response = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  const cookie = response.headers['set-cookie']?.[0];
  if (!cookie) throw new Error('login did not return a session cookie');
  return cookie;
}

async function cleanup() {
  const adminToDelete = await db.query.admins.findFirst({ where: eq(admins.email, SUPER_EMAIL) });
  if (adminToDelete) {
    await db.delete(auditLogs).where(eq(auditLogs.adminId, adminToDelete.id));
    await db.delete(authSessions).where(eq(authSessions.adminId, adminToDelete.id));
    await db.delete(admins).where(eq(admins.id, adminToDelete.id));
  }
  await db.delete(roles).where(eq(roles.name, 'test-auditlogs-role'));
}

describe('audit logs routes', () => {
  afterEach(async () => {
    await cleanup();
  });

  it('rejects an unauthenticated request', async () => {
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const response = await request(app).get('/api/audit-logs');
    expect(response.status).toBe(401);
  });

  it('lists and filters audit log entries, and returns one detail', async () => {
    const adminId = await seedAdmin();
    const [entry] = await db
      .insert(auditLogs)
      .values({
        adminId,
        roleSnapshot: '최고관리자',
        action: 'test.thing',
        targetType: 'testTarget',
        targetId: 'abc',
        beforeDataSafe: null,
        afterDataSafe: { hello: 'world' },
        result: 'success',
        requestId: 'req-1',
      })
      .returning();
    await db.insert(auditLogs).values({
      adminId,
      roleSnapshot: '최고관리자',
      action: 'other.thing',
      targetType: 'otherTarget',
      beforeDataSafe: null,
      afterDataSafe: null,
      result: 'success',
      requestId: 'req-2',
    });

    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const filtered = await request(app).get('/api/audit-logs?targetType=testTarget').set('Cookie', cookie);
    expect(filtered.status).toBe(200);
    expect(filtered.body.data).toHaveLength(1);
    expect(filtered.body.data[0].action).toBe('test.thing');

    const detail = await request(app).get(`/api/audit-logs/${entry!.id}`).set('Cookie', cookie);
    expect(detail.status).toBe(200);
    expect(detail.body.data.afterDataSafe).toEqual({ hello: 'world' });
  });
});
