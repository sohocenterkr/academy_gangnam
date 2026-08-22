import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { db } from '../db';
import { admins, roles, auditLogs, authSessions, messageTemplates } from '@shared/schema';
import { hashPassword } from '../utils/password';
import { SUPER_ADMIN_WILDCARD_PERMISSION } from '@shared/permissions';
import { createFakeEmailAdapter } from '../services/email';
import { createApp } from '../app';

const SUPER_EMAIL = 'test-templates-super@example.com';
const PASSWORD = 'test-templates-password-123';
const TEMPLATE_NAME = 'test-templates-출석안내';

async function seedAdmin() {
  const [role] = await db
    .insert(roles)
    .values({ name: 'test-templates-role', permissions: [SUPER_ADMIN_WILDCARD_PERMISSION], createdAt: new Date(), updatedAt: new Date() })
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
  const testTemplates = await db.select({ id: messageTemplates.id }).from(messageTemplates).where(eq(messageTemplates.name, TEMPLATE_NAME));
  for (const t of testTemplates) await db.delete(messageTemplates).where(eq(messageTemplates.id, t.id));
  await db.delete(messageTemplates).where(eq(messageTemplates.name, `${TEMPLATE_NAME} 사본`));

  const adminToDelete = await db.query.admins.findFirst({ where: eq(admins.email, SUPER_EMAIL) });
  if (adminToDelete) {
    await db.delete(auditLogs).where(eq(auditLogs.adminId, adminToDelete.id));
    await db.delete(authSessions).where(eq(authSessions.adminId, adminToDelete.id));
    await db.delete(admins).where(eq(admins.id, adminToDelete.id));
  }
  await db.delete(roles).where(eq(roles.name, 'test-templates-role'));
}

describe('message templates routes', () => {
  afterEach(async () => {
    await cleanup();
  });

  it('rejects an unauthenticated request', async () => {
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const response = await request(app).get('/api/message-templates');
    expect(response.status).toBe(401);
  });

  it('creates, lists, updates, copies, and soft-deletes a template', async () => {
    await seedAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const created = await request(app)
      .post('/api/message-templates')
      .set('Cookie', cookie)
      .send({ name: TEMPLATE_NAME, messageType: 'informational', body: '{{이름}} 학생, 오늘도 등원해 주세요.' });
    expect(created.status).toBe(200);
    expect(created.body.data.status).toBe('active');

    const list = await request(app).get('/api/message-templates').set('Cookie', cookie);
    expect(list.status).toBe(200);
    expect(list.body.data.some((t: { id: string }) => t.id === created.body.data.id)).toBe(true);

    const updated = await request(app)
      .patch(`/api/message-templates/${created.body.data.id}`)
      .set('Cookie', cookie)
      .send({ body: '{{이름}} 학생, 내일도 등원해 주세요.' });
    expect(updated.status).toBe(200);
    expect(updated.body.data.body).toBe('{{이름}} 학생, 내일도 등원해 주세요.');

    const copied = await request(app).post(`/api/message-templates/${created.body.data.id}/copy`).set('Cookie', cookie);
    expect(copied.status).toBe(200);
    expect(copied.body.data.name).toBe(`${TEMPLATE_NAME} 사본`);
    expect(copied.body.data.id).not.toBe(created.body.data.id);

    const deleted = await request(app).delete(`/api/message-templates/${created.body.data.id}`).set('Cookie', cookie);
    expect(deleted.status).toBe(200);

    const afterDelete = await request(app).get(`/api/message-templates/${created.body.data.id}`).set('Cookie', cookie);
    expect(afterDelete.status).toBe(404);
  });
});
