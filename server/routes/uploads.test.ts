import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { db } from '../db';
import { admins, roles, auditLogs, authSessions, mediaAssets, uploadSessions } from '@shared/schema';
import { hashPassword } from '../utils/password';
import { SUPER_ADMIN_WILDCARD_PERMISSION } from '@shared/permissions';
import { createFakeEmailAdapter } from '../services/email';
import { createApp } from '../app';
import type { CloudinaryClient, CloudinaryResource } from '../services/cloudinary';

const SUPER_EMAIL = 'test-uploads-super@example.com';
const PASSWORD = 'test-uploads-password-123';

function createFakeCloudinaryClient(resources: Map<string, CloudinaryResource>): CloudinaryClient {
  return {
    sign: (params) => `fake-signature-${Object.values(params).join('-')}`,
    getResource: async (publicId, resourceType) => {
      const resource = resources.get(publicId);
      if (!resource || resource.resourceType !== resourceType) return null;
      return resource;
    },
    destroy: async () => {},
  };
}

async function seedAdmin() {
  const [role] = await db
    .insert(roles)
    .values({ name: 'test-uploads-role', permissions: [SUPER_ADMIN_WILDCARD_PERMISSION], createdAt: new Date(), updatedAt: new Date() })
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
    const sessions = await db.select({ id: uploadSessions.id }).from(uploadSessions).where(eq(uploadSessions.ownerAdminId, adminToDelete.id));
    const assets = await db.select({ id: mediaAssets.id }).from(mediaAssets).where(eq(mediaAssets.ownerAdminId, adminToDelete.id));
    for (const asset of assets) await db.delete(mediaAssets).where(eq(mediaAssets.id, asset.id));
    for (const session of sessions) await db.delete(uploadSessions).where(eq(uploadSessions.id, session.id));
    await db.delete(auditLogs).where(eq(auditLogs.adminId, adminToDelete.id));
    await db.delete(authSessions).where(eq(authSessions.adminId, adminToDelete.id));
    await db.delete(admins).where(eq(admins.id, adminToDelete.id));
  }
  await db.delete(roles).where(eq(roles.name, 'test-uploads-role'));
}

describe('uploads routes', () => {
  afterEach(async () => {
    await cleanup();
  });

  it('rejects an unauthenticated sign request', async () => {
    const app = createApp({ emailAdapter: createFakeEmailAdapter(), cloudinary: createFakeCloudinaryClient(new Map()) });
    const response = await request(app).post('/api/uploads/sign').send({ purpose: 'card_news', targetType: 'cardNewsProject', resourceType: 'image' });
    expect(response.status).toBe(401);
  });

  it('signs an upload, finalizes it against the verified Cloudinary resource, and deletes it', async () => {
    await seedAdmin();
    const resources = new Map<string, CloudinaryResource>();
    const app = createApp({ emailAdapter: createFakeEmailAdapter(), cloudinary: createFakeCloudinaryClient(resources) });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const signed = await request(app)
      .post('/api/uploads/sign')
      .set('Cookie', cookie)
      .send({ purpose: 'card_news', targetType: 'cardNewsProject', resourceType: 'image' });
    expect(signed.status).toBe(200);
    const { uploadSessionId, folder, signature } = signed.body.data;
    expect(signature).toContain(folder);

    const publicId = `${folder}/photo1`;
    resources.set(publicId, {
      publicId,
      assetId: 'asset-1',
      secureUrl: `https://res.cloudinary.com/test/image/upload/${publicId}.jpg`,
      resourceType: 'image',
      format: 'jpg',
      bytes: 12345,
      width: 800,
      height: 600,
      duration: null,
    });

    // A finalize request whose publicId doesn't match the signed folder must be rejected —
    // the client-reported publicId is otherwise the only thing tying the request to a session.
    const wrongFolder = await request(app)
      .post(`/api/uploads/${uploadSessionId}/finalize`)
      .set('Cookie', cookie)
      .send({ publicId: 'some/other/folder/photo1' });
    expect(wrongFolder.status).toBe(400);

    const finalized = await request(app)
      .post(`/api/uploads/${uploadSessionId}/finalize`)
      .set('Cookie', cookie)
      .send({ publicId });
    expect(finalized.status).toBe(200);
    expect(finalized.body.data.secureUrl).toBe(resources.get(publicId)!.secureUrl);
    expect(finalized.body.data.bytes).toBe(12345);

    // Re-finalizing the same (now-completed) session must fail rather than create a duplicate asset.
    const reFinalize = await request(app)
      .post(`/api/uploads/${uploadSessionId}/finalize`)
      .set('Cookie', cookie)
      .send({ publicId });
    expect(reFinalize.status).toBe(410);

    const deleted = await request(app).delete(`/api/uploads/media/${finalized.body.data.id}`).set('Cookie', cookie);
    expect(deleted.status).toBe(200);
    expect(deleted.body.data.status).toBe('deleted');
  });

  it('rejects finalize when Cloudinary has no matching resource', async () => {
    await seedAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter(), cloudinary: createFakeCloudinaryClient(new Map()) });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const signed = await request(app)
      .post('/api/uploads/sign')
      .set('Cookie', cookie)
      .send({ purpose: 'card_news', targetType: 'cardNewsProject', resourceType: 'image' });
    const { uploadSessionId, folder } = signed.body.data;

    const finalized = await request(app)
      .post(`/api/uploads/${uploadSessionId}/finalize`)
      .set('Cookie', cookie)
      .send({ publicId: `${folder}/missing` });
    expect(finalized.status).toBe(404);
  });
});
