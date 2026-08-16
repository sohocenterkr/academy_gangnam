import { eq, like } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { db } from '../db';
import { admins, roles, courses, courseSchedules, auditLogs } from '@shared/schema';
import { hashPassword } from '../utils/password';
import { SUPER_ADMIN_WILDCARD_PERMISSION } from '@shared/permissions';
import { createFakeEmailAdapter } from '../services/email';
import { createApp } from '../app';

const SUPER_EMAIL = 'test-cschedules-super@example.com';
const PASSWORD = 'test-cschedules-password-123';
const CODE_PREFIX = 'test-cschedules-';

async function seedAdmin() {
  const [role] = await db
    .insert(roles)
    .values({ name: 'test-cschedules-role', permissions: [SUPER_ADMIN_WILDCARD_PERMISSION], createdAt: new Date(), updatedAt: new Date() })
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
  const created = await request(app).post('/api/courses').set('Cookie', cookie).send({ code, name: '일정테스트반' });
  return created.body.data as { id: string };
}

async function cleanup() {
  const testCourses = await db.select({ id: courses.id }).from(courses).where(like(courses.code, `${CODE_PREFIX}%`));
  for (const c of testCourses) {
    await db.delete(courseSchedules).where(eq(courseSchedules.courseId, c.id));
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
  await db.delete(roles).where(eq(roles.name, 'test-cschedules-role'));
}

describe('course schedules routes', () => {
  afterEach(async () => {
    await cleanup();
  });

  it('rejects an unauthenticated request', async () => {
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const response = await request(app).post('/api/courses/00000000-0000-0000-0000-000000000000/schedules').send({});
    expect(response.status).toBe(401);
  });

  it('creates a schedule under a real course with courseId set correctly', async () => {
    await seedAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);
    const course = await seedCourse(app, cookie, `${CODE_PREFIX}create-1`);

    const created = await request(app)
      .post(`/api/courses/${course.id}/schedules`)
      .set('Cookie', cookie)
      .send({ dayOfWeek: 1, startTime: '10:00', endTime: '11:00' });

    expect(created.status).toBe(200);
    expect(created.body.data.courseId).toBe(course.id);
    expect(created.body.data.dayOfWeek).toBe(1);
    expect(created.body.data.isActive).toBe(true);
  });

  it('returns 404 creating a schedule under a nonexistent course', async () => {
    await seedAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const created = await request(app)
      .post('/api/courses/00000000-0000-0000-0000-000000000000/schedules')
      .set('Cookie', cookie)
      .send({ dayOfWeek: 1, startTime: '10:00', endTime: '11:00' });

    expect(created.status).toBe(404);
  });

  it('rejects a malformed time with 400', async () => {
    await seedAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);
    const course = await seedCourse(app, cookie, `${CODE_PREFIX}badtime-1`);

    const created = await request(app)
      .post(`/api/courses/${course.id}/schedules`)
      .set('Cookie', cookie)
      .send({ dayOfWeek: 1, startTime: '10:00am', endTime: '11:00' });

    expect(created.status).toBe(400);
    expect(created.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('updates a schedule', async () => {
    await seedAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);
    const course = await seedCourse(app, cookie, `${CODE_PREFIX}update-1`);
    const created = await request(app)
      .post(`/api/courses/${course.id}/schedules`)
      .set('Cookie', cookie)
      .send({ dayOfWeek: 1, startTime: '10:00', endTime: '11:00' });

    const updated = await request(app)
      .patch(`/api/course-schedules/${created.body.data.id}`)
      .set('Cookie', cookie)
      .send({ dayOfWeek: 2 });

    expect(updated.status).toBe(200);
    expect(updated.body.data.dayOfWeek).toBe(2);
  });

  it('deletes a schedule and it no longer appears in course detail', async () => {
    await seedAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);
    const course = await seedCourse(app, cookie, `${CODE_PREFIX}delete-1`);
    const created = await request(app)
      .post(`/api/courses/${course.id}/schedules`)
      .set('Cookie', cookie)
      .send({ dayOfWeek: 1, startTime: '10:00', endTime: '11:00' });

    const deleted = await request(app).delete(`/api/course-schedules/${created.body.data.id}`).set('Cookie', cookie);
    expect(deleted.status).toBe(200);
    expect(deleted.body.data.success).toBe(true);

    const detail = await request(app).get(`/api/courses/${course.id}`).set('Cookie', cookie);
    const ids: string[] = detail.body.data.schedules.map((s: { id: string }) => s.id);
    expect(ids).not.toContain(created.body.data.id);
  });
});
