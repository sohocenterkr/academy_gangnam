import { and, eq, like } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { db } from '../db';
import { admins, roles, courses, courseSchedules, enrollments, auditLogs } from '@shared/schema';
import { hashPassword } from '../utils/password';
import { SUPER_ADMIN_WILDCARD_PERMISSION } from '@shared/permissions';
import { createFakeEmailAdapter } from '../services/email';
import { createApp } from '../app';

const SUPER_EMAIL = 'test-courses-super@example.com';
const PASSWORD = 'test-courses-password-123';
const CODE_PREFIX = 'test-courses-';

async function seedAdmin() {
  const [role] = await db
    .insert(roles)
    .values({ name: 'test-courses-role', permissions: [SUPER_ADMIN_WILDCARD_PERMISSION], createdAt: new Date(), updatedAt: new Date() })
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
  const testCourses = await db.select({ id: courses.id }).from(courses).where(like(courses.code, `${CODE_PREFIX}%`));
  for (const c of testCourses) {
    await db.delete(enrollments).where(eq(enrollments.courseId, c.id));
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
  await db.delete(roles).where(eq(roles.name, 'test-courses-role'));
}

describe('courses routes', () => {
  afterEach(async () => {
    await cleanup();
  });

  it('rejects an unauthenticated request', async () => {
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const response = await request(app).get('/api/courses');
    expect(response.status).toBe(401);
  });

  it('creates a course with code and status recruiting', async () => {
    await seedAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const created = await request(app)
      .post('/api/courses')
      .set('Cookie', cookie)
      .send({ code: `${CODE_PREFIX}create-1`, name: '수학 기초반', category: '수학' });

    expect(created.status).toBe(200);
    expect(created.body.data.code).toBe(`${CODE_PREFIX}create-1`);
    expect(created.body.data.status).toBe('recruiting');
  });

  it('rejects a duplicate code on create with a validation error', async () => {
    await seedAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const code = `${CODE_PREFIX}dup-1`;
    const first = await request(app).post('/api/courses').set('Cookie', cookie).send({ code, name: '영어 기초반' });
    expect(first.status).toBe(200);

    const second = await request(app).post('/api/courses').set('Cookie', cookie).send({ code, name: '영어 심화반' });
    expect(second.status).toBe(400);
    expect(second.body.error.code).toBe('VALIDATION_ERROR');
    expect(second.body.error.fieldErrors.code).toBeDefined();
  });

  it('lists courses filtered by status', async () => {
    await seedAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const recruiting = await request(app)
      .post('/api/courses')
      .set('Cookie', cookie)
      .send({ code: `${CODE_PREFIX}list-recruiting`, name: '모집중반' });
    const closedSource = await request(app)
      .post('/api/courses')
      .set('Cookie', cookie)
      .send({ code: `${CODE_PREFIX}list-closed`, name: '마감반' });
    const closeIt = await request(app)
      .post(`/api/courses/${closedSource.body.data.id}/status`)
      .set('Cookie', cookie)
      .send({ status: 'closed', expectedUpdatedAt: closedSource.body.data.updatedAt });
    expect(closeIt.status).toBe(200);

    const list = await request(app).get('/api/courses').query({ status: 'closed' }).set('Cookie', cookie);
    expect(list.status).toBe(200);
    const ids: string[] = list.body.data.map((row: { id: string }) => row.id);
    expect(ids).toContain(closedSource.body.data.id);
    expect(ids).not.toContain(recruiting.body.data.id);
  });

  it('returns course detail with empty schedules and zero active enrollment count', async () => {
    await seedAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const created = await request(app)
      .post('/api/courses')
      .set('Cookie', cookie)
      .send({ code: `${CODE_PREFIX}detail-1`, name: '상세보기반' });

    const detail = await request(app).get(`/api/courses/${created.body.data.id}`).set('Cookie', cookie);
    expect(detail.status).toBe(200);
    expect(detail.body.data.schedules).toEqual([]);
    expect(detail.body.data.activeEnrollmentCount).toBe(0);
  });

  it('updates a course atomically and rejects a stale update', async () => {
    await seedAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const created = await request(app)
      .post('/api/courses')
      .set('Cookie', cookie)
      .send({ code: `${CODE_PREFIX}patch-1`, name: '수정전이름' });

    const updated = await request(app)
      .patch(`/api/courses/${created.body.data.id}`)
      .set('Cookie', cookie)
      .send({ name: '수정후이름', expectedUpdatedAt: created.body.data.updatedAt });
    expect(updated.status).toBe(200);
    expect(updated.body.data.name).toBe('수정후이름');

    const stale = await request(app)
      .patch(`/api/courses/${created.body.data.id}`)
      .set('Cookie', cookie)
      .send({ name: '다시수정', expectedUpdatedAt: created.body.data.updatedAt });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
  });

  it('transitions status from recruiting to closed and logs the change', async () => {
    await seedAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const created = await request(app)
      .post('/api/courses')
      .set('Cookie', cookie)
      .send({ code: `${CODE_PREFIX}status-1`, name: '상태변경반' });
    expect(created.body.data.status).toBe('recruiting');

    const changed = await request(app)
      .post(`/api/courses/${created.body.data.id}/status`)
      .set('Cookie', cookie)
      .send({ status: 'closed', expectedUpdatedAt: created.body.data.updatedAt });
    expect(changed.status).toBe(200);
    expect(changed.body.data.status).toBe('closed');

    const admin = await db.query.admins.findFirst({ where: eq(admins.email, SUPER_EMAIL) });
    const log = await db.query.auditLogs.findFirst({
      where: and(eq(auditLogs.adminId, admin!.id), eq(auditLogs.action, 'course.statusChange')),
    });
    expect(log).toBeDefined();
    expect((log?.beforeDataSafe as { status?: string } | null)?.status).toBe('recruiting');
  });

  it('copies a course into a new row without schedules or enrollments', async () => {
    await seedAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const source = await request(app)
      .post('/api/courses')
      .set('Cookie', cookie)
      .send({ code: `${CODE_PREFIX}copy-src`, name: '원본반', category: '과학' });

    const copy = await request(app)
      .post(`/api/courses/${source.body.data.id}/copy`)
      .set('Cookie', cookie)
      .send({ code: `${CODE_PREFIX}copy-dst` });
    expect(copy.status).toBe(200);
    expect(copy.body.data.id).not.toBe(source.body.data.id);
    expect(copy.body.data.code).toBe(`${CODE_PREFIX}copy-dst`);
    expect(copy.body.data.name).toBe('원본반');
    expect(copy.body.data.category).toBe('과학');

    const copyDetail = await request(app).get(`/api/courses/${copy.body.data.id}`).set('Cookie', cookie);
    expect(copyDetail.body.data.schedules).toEqual([]);
    expect(copyDetail.body.data.activeEnrollmentCount).toBe(0);
  });

  it('excludes soft-deleted courses from the list', async () => {
    await seedAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const created = await request(app)
      .post('/api/courses')
      .set('Cookie', cookie)
      .send({ code: `${CODE_PREFIX}soft-deleted`, name: '삭제될반' });

    await db.update(courses).set({ deletedAt: new Date() }).where(eq(courses.id, created.body.data.id));

    const list = await request(app).get('/api/courses').set('Cookie', cookie);
    const ids: string[] = list.body.data.map((row: { id: string }) => row.id);
    expect(ids).not.toContain(created.body.data.id);
  });
});
