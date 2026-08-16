import { eq, like } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { db } from '../db';
import { admins, roles, courses, courseExceptions, auditLogs } from '@shared/schema';
import { hashPassword } from '../utils/password';
import { SUPER_ADMIN_WILDCARD_PERMISSION } from '@shared/permissions';
import { createFakeEmailAdapter } from '../services/email';
import { createApp } from '../app';

const SUPER_EMAIL = 'test-cexceptions-super@example.com';
const PASSWORD = 'test-cexceptions-password-123';
const CODE_PREFIX = 'test-cexceptions-';

async function seedAdmin() {
  const [role] = await db
    .insert(roles)
    .values({ name: 'test-cexceptions-role', permissions: [SUPER_ADMIN_WILDCARD_PERMISSION], createdAt: new Date(), updatedAt: new Date() })
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

async function seedCourse(app: ReturnType<typeof createApp>, cookie: string, code: string) {
  const created = await request(app).post('/api/courses').set('Cookie', cookie).send({ code, name: '예외테스트반' });
  return created.body.data as { id: string };
}

async function cleanup() {
  const testCourses = await db.select({ id: courses.id }).from(courses).where(like(courses.code, `${CODE_PREFIX}%`));
  for (const c of testCourses) {
    await db.delete(courseExceptions).where(eq(courseExceptions.courseId, c.id));
  }
  await db.delete(courses).where(like(courses.code, `${CODE_PREFIX}%`));

  const adminToDelete = await db.query.admins.findFirst({ where: eq(admins.email, SUPER_EMAIL) });
  if (adminToDelete) {
    const { authSessions, passwordResetTokens } = await import('@shared/schema');
    await db.delete(auditLogs).where(eq(auditLogs.adminId, adminToDelete.id));
    await db.delete(authSessions).where(eq(authSessions.adminId, adminToDelete.id));
    await db.delete(passwordResetTokens).where(eq(passwordResetTokens.adminId, adminToDelete.id));
    await db.delete(admins).where(eq(admins.id, adminToDelete.id));
  }
  await db.delete(roles).where(eq(roles.name, 'test-cexceptions-role'));
}

describe('course exceptions routes', () => {
  afterEach(async () => {
    await cleanup();
  });

  it('rejects an unauthenticated request', async () => {
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const response = await request(app).post('/api/courses/00000000-0000-0000-0000-000000000000/exceptions').send({});
    expect(response.status).toBe(401);
  });

  it('creates an exception under a real course with courseId set correctly', async () => {
    await seedAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);
    const course = await seedCourse(app, cookie, `${CODE_PREFIX}create-1`);

    const created = await request(app)
      .post(`/api/courses/${course.id}/exceptions`)
      .set('Cookie', cookie)
      .send({ exceptionType: 'cancellation', eventDate: '2026-09-01' });

    expect(created.status).toBe(200);
    expect(created.body.data.courseId).toBe(course.id);
    expect(created.body.data.exceptionType).toBe('cancellation');
    expect(created.body.data.eventDate).toBe('2026-09-01');
  });

  it('returns 404 creating an exception under a nonexistent course', async () => {
    await seedAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const created = await request(app)
      .post('/api/courses/00000000-0000-0000-0000-000000000000/exceptions')
      .set('Cookie', cookie)
      .send({ exceptionType: 'cancellation', eventDate: '2026-09-01' });

    expect(created.status).toBe(404);
  });

  it('rejects an invalid exceptionType with 400', async () => {
    await seedAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);
    const course = await seedCourse(app, cookie, `${CODE_PREFIX}badtype-1`);

    const created = await request(app)
      .post(`/api/courses/${course.id}/exceptions`)
      .set('Cookie', cookie)
      .send({ exceptionType: 'holiday', eventDate: '2026-09-01' });

    expect(created.status).toBe(400);
    expect(created.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('updates an exception', async () => {
    await seedAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);
    const course = await seedCourse(app, cookie, `${CODE_PREFIX}update-1`);
    const created = await request(app)
      .post(`/api/courses/${course.id}/exceptions`)
      .set('Cookie', cookie)
      .send({ exceptionType: 'cancellation', eventDate: '2026-09-01' });

    const updated = await request(app)
      .patch(`/api/course-exceptions/${created.body.data.id}`)
      .set('Cookie', cookie)
      .send({ exceptionType: 'makeup' });

    expect(updated.status).toBe(200);
    expect(updated.body.data.exceptionType).toBe('makeup');
  });

  it('deletes an exception', async () => {
    await seedAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);
    const course = await seedCourse(app, cookie, `${CODE_PREFIX}delete-1`);
    const created = await request(app)
      .post(`/api/courses/${course.id}/exceptions`)
      .set('Cookie', cookie)
      .send({ exceptionType: 'cancellation', eventDate: '2026-09-01' });

    const deleted = await request(app).delete(`/api/course-exceptions/${created.body.data.id}`).set('Cookie', cookie);
    expect(deleted.status).toBe(200);
    expect(deleted.body.data.success).toBe(true);

    const remaining = await db.select().from(courseExceptions).where(eq(courseExceptions.id, created.body.data.id));
    expect(remaining.length).toBe(0);
  });
});
