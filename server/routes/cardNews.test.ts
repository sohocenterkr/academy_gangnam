import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { db } from '../db';
import {
  admins,
  roles,
  auditLogs,
  authSessions,
  platformPresets,
  cardNewsProjects,
  cardNewsMedia,
  cardNewsCards,
  aiGenerationLogs,
  mediaAssets,
} from '@shared/schema';
import { hashPassword } from '../utils/password';
import { SUPER_ADMIN_WILDCARD_PERMISSION } from '@shared/permissions';
import { createFakeEmailAdapter } from '../services/email';
import { createApp } from '../app';
import type { OpenAIClient } from '../services/openaiCardNews';

function fakeOpenAI(): OpenAIClient {
  return {
    generateCardNewsCopy: async (input) => ({
      cards: Array.from({ length: input.cardCount }, (_, i) => ({ title: `카드 제목 ${i + 1}`, body: `카드 본문 ${i + 1}` })),
      model: 'gpt-4o-mini',
      promptTokens: 300,
      completionTokens: 150,
      estimatedCostUsd: 0.0001,
    }),
  };
}

const SUPER_EMAIL = 'test-cardnews-super@example.com';
const PASSWORD = 'test-cardnews-password-123';
const PRESET_NAME = 'test-cardnews-프리셋';
const PROJECT_NAME = 'test-cardnews-프로젝트';

async function seedFixtures() {
  const [role] = await db
    .insert(roles)
    .values({ name: 'test-cardnews-role', permissions: [SUPER_ADMIN_WILDCARD_PERMISSION], createdAt: new Date(), updatedAt: new Date() })
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
  const [preset] = await db
    .insert(platformPresets)
    .values({ platform: 'instagram', postType: 'feed', name: PRESET_NAME, widthPx: 1080, heightPx: 1080, createdBy: admin!.id, updatedBy: admin!.id })
    .returning();
  const [media] = await db
    .insert(mediaAssets)
    .values({
      ownerAdminId: admin!.id,
      purpose: 'card_news',
      targetType: 'cardNewsProject',
      cloudinaryPublicId: `test-cardnews/${Date.now()}`,
      secureUrl: 'https://res.cloudinary.com/test/image/upload/test.jpg',
      resourceType: 'image',
      bytes: 1000,
      status: 'active',
    })
    .returning();
  return { presetId: preset!.id, mediaId: media!.id };
}

async function loginAs(app: ReturnType<typeof createApp>, email: string): Promise<string> {
  const response = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  const cookie = response.headers['set-cookie']?.[0];
  if (!cookie) throw new Error('login did not return a session cookie');
  return cookie;
}

async function cleanup() {
  const projects = await db.select({ id: cardNewsProjects.id }).from(cardNewsProjects).where(eq(cardNewsProjects.name, PROJECT_NAME));
  for (const project of projects) {
    await db.delete(aiGenerationLogs).where(eq(aiGenerationLogs.projectId, project.id));
    await db.delete(cardNewsCards).where(eq(cardNewsCards.projectId, project.id));
    await db.delete(cardNewsMedia).where(eq(cardNewsMedia.projectId, project.id));
    await db.delete(cardNewsProjects).where(eq(cardNewsProjects.id, project.id));
  }
  await db.delete(mediaAssets).where(eq(mediaAssets.purpose, 'card_news'));
  await db.delete(platformPresets).where(eq(platformPresets.name, PRESET_NAME));

  const adminToDelete = await db.query.admins.findFirst({ where: eq(admins.email, SUPER_EMAIL) });
  if (adminToDelete) {
    await db.delete(auditLogs).where(eq(auditLogs.adminId, adminToDelete.id));
    await db.delete(authSessions).where(eq(authSessions.adminId, adminToDelete.id));
    await db.delete(admins).where(eq(admins.id, adminToDelete.id));
  }
  await db.delete(roles).where(eq(roles.name, 'test-cardnews-role'));
}

describe('card news routes', () => {
  afterEach(async () => {
    await cleanup();
  });

  it('rejects an unauthenticated request', async () => {
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const response = await request(app).get('/api/card-news');
    expect(response.status).toBe(401);
  });

  it('creates a draft project, links media, requires privacy confirmation before enabling AI, and soft-deletes', async () => {
    const { presetId, mediaId } = await seedFixtures();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const created = await request(app).post('/api/card-news').set('Cookie', cookie).send({ name: PROJECT_NAME, presetId });
    expect(created.status).toBe(200);
    expect(created.body.data.status).toBe('draft');
    expect(created.body.data.expiresAt).toBeTruthy();

    const linked = await request(app)
      .post(`/api/card-news/${created.body.data.id}/media`)
      .set('Cookie', cookie)
      .send({ mediaId, role: 'source' });
    expect(linked.status).toBe(200);

    const detail = await request(app).get(`/api/card-news/${created.body.data.id}`).set('Cookie', cookie);
    expect(detail.body.data.media).toHaveLength(1);

    // Turning sendPhotosToAi on without confirming privacy must be rejected (spec §13.7 step 4).
    const unconfirmed = await request(app)
      .patch(`/api/card-news/${created.body.data.id}`)
      .set('Cookie', cookie)
      .send({ sendPhotosToAi: true, expectedUpdatedAt: detail.body.data.updatedAt });
    expect(unconfirmed.status).toBe(400);

    const confirmed = await request(app)
      .patch(`/api/card-news/${created.body.data.id}`)
      .set('Cookie', cookie)
      .send({ sendPhotosToAi: true, privacyConfirmed: true, expectedUpdatedAt: detail.body.data.updatedAt });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data.sendPhotosToAi).toBe(true);
    expect(confirmed.body.data.privacyConfirmedBy).toBeTruthy();

    const unlinked = await request(app).delete(`/api/card-news/${created.body.data.id}/media/${mediaId}`).set('Cookie', cookie);
    expect(unlinked.status).toBe(200);

    const deleted = await request(app).delete(`/api/card-news/${created.body.data.id}`).set('Cookie', cookie);
    expect(deleted.status).toBe(200);

    const afterDelete = await request(app).get(`/api/card-news/${created.body.data.id}`).set('Cookie', cookie);
    expect(afterDelete.status).toBe(404);
  });

  it('rejects generate when AI is not configured, then generates cards and lets the admin edit them', async () => {
    const { presetId } = await seedFixtures();
    const noAiApp = createApp({ emailAdapter: createFakeEmailAdapter() });
    const noAiCookie = await loginAs(noAiApp, SUPER_EMAIL);
    const created = await request(noAiApp).post('/api/card-news').set('Cookie', noAiCookie).send({ name: PROJECT_NAME, presetId });

    const unconfigured = await request(noAiApp).post(`/api/card-news/${created.body.data.id}/generate`).set('Cookie', noAiCookie).send({ cardCount: 2 });
    expect(unconfigured.status).toBe(503);

    const app = createApp({ emailAdapter: createFakeEmailAdapter(), openai: fakeOpenAI() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const estimate = await request(app).post(`/api/card-news/${created.body.data.id}/cost-estimate`).set('Cookie', cookie).send({ cardCount: 2 });
    expect(estimate.status).toBe(200);
    expect(estimate.body.data.estimatedCostUsd).toBeGreaterThan(0);

    const generated = await request(app).post(`/api/card-news/${created.body.data.id}/generate`).set('Cookie', cookie).send({ cardCount: 2 });
    expect(generated.status).toBe(200);
    expect(generated.body.data.cards).toHaveLength(2);
    expect(generated.body.data.cards[0].title).toBe('카드 제목 1');

    const afterGenerate = await request(app).get(`/api/card-news/${created.body.data.id}`).set('Cookie', cookie);
    expect(afterGenerate.body.data.status).toBe('editing');
    expect(afterGenerate.body.data.cards).toHaveLength(2);

    const edited = await request(app)
      .put(`/api/card-news/${created.body.data.id}/cards`)
      .set('Cookie', cookie)
      .send({ cards: [{ title: '수정된 제목', body: '수정된 본문' }] });
    expect(edited.status).toBe(200);
    expect(edited.body.data).toHaveLength(1);
    expect(edited.body.data[0].title).toBe('수정된 제목');
    expect(edited.body.data[0].status).toBe('ready');
  });
});
