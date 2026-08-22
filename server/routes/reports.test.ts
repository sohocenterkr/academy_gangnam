import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { db } from '../db';
import { admins, roles, auditLogs, authSessions } from '@shared/schema';
import { hashPassword } from '../utils/password';
import { SUPER_ADMIN_WILDCARD_PERMISSION } from '@shared/permissions';
import { createFakeEmailAdapter } from '../services/email';
import { createApp } from '../app';

const SUPER_EMAIL = 'test-reports-super@example.com';
const PASSWORD = 'test-reports-password-123';

async function seedAdmin() {
  const [role] = await db
    .insert(roles)
    .values({ name: 'test-reports-role', permissions: [SUPER_ADMIN_WILDCARD_PERMISSION], createdAt: new Date(), updatedAt: new Date() })
    .returning();
  await db.insert(admins).values({
    email: SUPER_EMAIL,
    name: '수퍼',
    passwordHash: await hashPassword(PASSWORD),
    roleId: role!.id,
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
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
  await db.delete(roles).where(eq(roles.name, 'test-reports-role'));
}

describe('reports routes', () => {
  afterEach(async () => {
    await cleanup();
  });

  it('rejects an unauthenticated request', async () => {
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const response = await request(app).get('/api/reports/students');
    expect(response.status).toBe(401);
  });

  it('returns each report shape', async () => {
    await seedAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const checkIns = await request(app).get('/api/reports/check-ins').set('Cookie', cookie);
    expect(checkIns.status).toBe(200);
    expect(checkIns.body.data).toEqual(expect.objectContaining({ bySource: expect.any(Array), byDate: expect.any(Array) }));

    const students = await request(app).get('/api/reports/students').set('Cookie', cookie);
    expect(students.status).toBe(200);
    expect(students.body.data).toEqual(expect.objectContaining({ byStatus: expect.any(Array), byGrade: expect.any(Array) }));

    const courses = await request(app).get('/api/reports/courses').set('Cookie', cookie);
    expect(courses.status).toBe(200);
    expect(Array.isArray(courses.body.data)).toBe(true);

    const messages = await request(app).get('/api/reports/messages').set('Cookie', cookie);
    expect(messages.status).toBe(200);
    expect(Array.isArray(messages.body.data)).toBe(true);

    const cardNews = await request(app).get('/api/reports/card-news').set('Cookie', cookie);
    expect(cardNews.status).toBe(200);
    expect(Array.isArray(cardNews.body.data)).toBe(true);
  });
});
