import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { db } from '../db';
import { admins, roles, auditLogs, authSessions, mediaAssets } from '@shared/schema';
import { hashPassword } from '../utils/password';
import { SUPER_ADMIN_WILDCARD_PERMISSION } from '@shared/permissions';
import { createFakeEmailAdapter } from '../services/email';
import { createApp } from '../app';
import type { CloudinaryClient } from '../services/cloudinary';

const SUPER_EMAIL = 'test-exports-super@example.com';
const PASSWORD = 'test-exports-password-123';

function fakeCloudinary(): CloudinaryClient {
  return {
    sign: () => 'fake-signature',
    getResource: async () => null,
    destroy: async () => {},
    uploadBuffer: async (buffer, options) => ({
      publicId: options.publicId,
      assetId: 'fake-asset-id',
      secureUrl: `https://res.cloudinary.com/test/raw/upload/${options.publicId}.xlsx`,
      resourceType: 'raw',
      format: 'xlsx',
      bytes: buffer.byteLength,
      width: null,
      height: null,
      duration: null,
    }),
  };
}

async function seedAdmin() {
  const [role] = await db
    .insert(roles)
    .values({ name: 'test-exports-role', permissions: [SUPER_ADMIN_WILDCARD_PERMISSION], createdAt: new Date(), updatedAt: new Date() })
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
    await db.delete(mediaAssets).where(eq(mediaAssets.ownerAdminId, adminToDelete.id));
    await db.delete(auditLogs).where(eq(auditLogs.adminId, adminToDelete.id));
    await db.delete(authSessions).where(eq(authSessions.adminId, adminToDelete.id));
    await db.delete(admins).where(eq(admins.id, adminToDelete.id));
  }
  await db.delete(roles).where(eq(roles.name, 'test-exports-role'));
}

describe('exports routes', () => {
  afterEach(async () => {
    await cleanup();
  });

  it('rejects an unauthenticated request', async () => {
    const app = createApp({ emailAdapter: createFakeEmailAdapter(), cloudinary: fakeCloudinary() });
    const response = await request(app).post('/api/exports').send({ reportType: 'students' });
    expect(response.status).toBe(401);
  });

  it('generates an xlsx export, uploads it, and can be fetched by id', async () => {
    await seedAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter(), cloudinary: fakeCloudinary() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const created = await request(app).post('/api/exports').set('Cookie', cookie).send({ reportType: 'students' });
    expect(created.status).toBe(200);
    expect(created.body.data.status).toBe('completed');
    expect(created.body.data.downloadUrl).toContain('.xlsx');

    const fetched = await request(app).get(`/api/exports/${created.body.data.id}`).set('Cookie', cookie);
    expect(fetched.status).toBe(200);
    expect(fetched.body.data.downloadUrl).toBe(created.body.data.downloadUrl);
  });
});
