import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { db } from '../db';
import {
  admins,
  roles,
  auditLogs,
  authSessions,
  students,
  guardians,
  studentGuardians,
  gradeLevels,
  optOuts,
  integrationSettings,
  messagingDevices,
  messageCampaigns,
  messageCampaignMedia,
  messageRecipients,
  messageSendItems,
} from '@shared/schema';
import { hashPassword } from '../utils/password';
import { SUPER_ADMIN_WILDCARD_PERMISSION } from '@shared/permissions';
import { createFakeEmailAdapter } from '../services/email';
import { createApp } from '../app';
import {
  clearPushbulletIntegration,
  restorePushbulletIntegration,
  snapshotPushbulletIntegration,
  type PushbulletIntegrationSnapshot,
} from '../testUtils/pushbulletIntegrationFixture';

const SUPER_EMAIL = 'test-drafts-super@example.com';
const PASSWORD = 'test-drafts-password-123';
const GRADE_NAME = 'test-drafts-grade';
const GUARDIAN_PHONE = '01099998888';
const STUDENT1_NAME = 'test-drafts-철수';
const STUDENT2_NAME = 'test-drafts-영희';

async function seedFixtures() {
  const [role] = await db
    .insert(roles)
    .values({ name: 'test-drafts-role', permissions: [SUPER_ADMIN_WILDCARD_PERMISSION], createdAt: new Date(), updatedAt: new Date() })
    .returning();
  const [admin] = await db
    .insert(admins)
    .values({ email: SUPER_EMAIL, name: '수퍼', passwordHash: await hashPassword(PASSWORD), roleId: role!.id, status: 'active', createdAt: new Date(), updatedAt: new Date() })
    .returning();
  const [grade] = await db.insert(gradeLevels).values({ name: GRADE_NAME, sortOrder: 0 }).returning();
  const [guardian] = await db.insert(guardians).values({ name: '김보호', phoneNormalized: GUARDIAN_PHONE }).returning();
  const [student1] = await db
    .insert(students)
    .values({ name: STUDENT1_NAME, phoneNormalized: '01011112222', gradeLevelId: grade!.id, registrationDate: '2026-08-01', statusEffectiveDate: '2026-08-01', createdAt: new Date(), updatedAt: new Date() })
    .returning();
  const [student2] = await db
    .insert(students)
    .values({ name: STUDENT2_NAME, phoneNormalized: '01033334444', gradeLevelId: grade!.id, registrationDate: '2026-08-01', statusEffectiveDate: '2026-08-01', createdAt: new Date(), updatedAt: new Date() })
    .returning();
  await db.insert(studentGuardians).values([
    { studentId: student1!.id, guardianId: guardian!.id, relationship: '모', isPrimary: true, receiveMessages: true },
    { studentId: student2!.id, guardianId: guardian!.id, relationship: '모', isPrimary: true, receiveMessages: true },
  ]);
  const [integration] = await db
    .insert(integrationSettings)
    .values({ provider: 'pushbullet', displayName: 'test', status: 'connected', createdBy: admin!.id, updatedBy: admin!.id })
    .returning();
  const [device] = await db
    .insert(messagingDevices)
    .values({ integrationId: integration!.id, externalDeviceId: 'dev-x', nickname: '기기', isEnabled: true })
    .returning();
  return { gradeId: grade!.id, guardianId: guardian!.id, studentId1: student1!.id, studentId2: student2!.id, deviceId: device!.id, integrationId: integration!.id };
}

async function loginAs(app: ReturnType<typeof createApp>, email: string): Promise<string> {
  const response = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  const cookie = response.headers['set-cookie']?.[0];
  if (!cookie) throw new Error('login did not return a session cookie');
  return cookie;
}

async function cleanup() {
  const campaigns = await db.select({ id: messageCampaigns.id }).from(messageCampaigns).where(eq(messageCampaigns.name, 'test-drafts-campaign'));
  for (const c of campaigns) {
    const recipients = await db.select({ id: messageRecipients.id }).from(messageRecipients).where(eq(messageRecipients.campaignId, c.id));
    for (const r of recipients) {
      await db.delete(messageSendItems).where(eq(messageSendItems.recipientId, r.id));
    }
    await db.delete(messageRecipients).where(eq(messageRecipients.campaignId, c.id));
    await db.delete(messageCampaignMedia).where(eq(messageCampaignMedia.campaignId, c.id));
    await db.delete(messageCampaigns).where(eq(messageCampaigns.id, c.id));
  }

  await db.delete(optOuts).where(eq(optOuts.phoneNormalized, GUARDIAN_PHONE));

  const testStudents = await db.select({ id: students.id }).from(students).where(eq(students.name, STUDENT1_NAME));
  for (const s of testStudents) await db.delete(studentGuardians).where(eq(studentGuardians.studentId, s.id));
  const testStudents2 = await db.select({ id: students.id }).from(students).where(eq(students.name, STUDENT2_NAME));
  for (const s of testStudents2) await db.delete(studentGuardians).where(eq(studentGuardians.studentId, s.id));
  await db.delete(students).where(eq(students.name, STUDENT1_NAME));
  await db.delete(students).where(eq(students.name, STUDENT2_NAME));
  await db.delete(guardians).where(eq(guardians.phoneNormalized, GUARDIAN_PHONE));
  await db.delete(gradeLevels).where(eq(gradeLevels.name, GRADE_NAME));

  // integration_settings/messaging_devices are the shared Pushbullet singleton — cleared and
  // restored around the whole suite (see beforeAll/beforeEach/afterAll below), not per-test here.
}

async function cleanupAdminFixtures() {
  const adminToDelete = await db.query.admins.findFirst({ where: eq(admins.email, SUPER_EMAIL) });
  if (adminToDelete) {
    await db.delete(auditLogs).where(eq(auditLogs.adminId, adminToDelete.id));
    await db.delete(authSessions).where(eq(authSessions.adminId, adminToDelete.id));
    await db.delete(admins).where(eq(admins.id, adminToDelete.id));
  }
  await db.delete(roles).where(eq(roles.name, 'test-drafts-role'));
}

describe('message drafts routes', () => {
  let preExistingIntegration: PushbulletIntegrationSnapshot;

  beforeAll(async () => {
    preExistingIntegration = await snapshotPushbulletIntegration();
  });

  beforeEach(async () => {
    await clearPushbulletIntegration();
  });

  afterEach(async () => {
    // Order matters: campaigns reference the device (device_id), and the integration row
    // references the test admin (created_by) — so campaigns must go before the integration
    // is cleared, which must go before the admin is deleted.
    await cleanup();
    await clearPushbulletIntegration();
    await cleanupAdminFixtures();
  });

  afterAll(async () => {
    await restorePushbulletIntegration(preExistingIntegration);
  });

  it('rejects an unauthenticated request', async () => {
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const response = await request(app).post('/api/message-drafts').send({ name: 'x', messageType: 'informational' });
    expect(response.status).toBe(401);
  });

  it('merges siblings sharing one guardian phone into a single recipient by default', async () => {
    const { gradeId, deviceId } = await seedFixtures();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const created = await request(app).post('/api/message-drafts').set('Cookie', cookie).send({ name: 'test-drafts-campaign', messageType: 'informational' });
    expect(created.status).toBe(200);
    const draftId = created.body.data.id;

    await request(app).patch(`/api/message-drafts/${draftId}/recipients`).set('Cookie', cookie).send({ recipientType: 'grade', filter: { gradeLevelId: gradeId }, duplicateStrategy: 'merge' });
    await request(app).patch(`/api/message-drafts/${draftId}/content`).set('Cookie', cookie).send({ bodySource: '{{이름}} 학생, 안내드립니다.', mediaIds: [] });

    const preview = await request(app).post(`/api/message-drafts/${draftId}/recipient-preview`).set('Cookie', cookie);
    expect(preview.status).toBe(200);
    expect(preview.body.data.includedCount).toBe(1);
    expect(preview.body.data.sample[0].studentNames).toEqual([STUDENT1_NAME, STUDENT2_NAME]);

    const approved = await request(app)
      .post(`/api/message-drafts/${draftId}/approve`)
      .set('Cookie', cookie)
      .send({ sendMode: 'immediate', deviceId });
    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe('queued');
    expect(approved.body.data.totalContacts).toBe(1);
    expect(approved.body.data.totalStudents).toBe(2);
  });

  it('splits siblings into separate recipients when duplicateStrategy is separate', async () => {
    const { gradeId, deviceId } = await seedFixtures();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const created = await request(app).post('/api/message-drafts').set('Cookie', cookie).send({ name: 'test-drafts-campaign', messageType: 'informational' });
    const draftId = created.body.data.id;

    await request(app).patch(`/api/message-drafts/${draftId}/recipients`).set('Cookie', cookie).send({ recipientType: 'grade', filter: { gradeLevelId: gradeId }, duplicateStrategy: 'separate' });
    await request(app).patch(`/api/message-drafts/${draftId}/content`).set('Cookie', cookie).send({ bodySource: '{{이름}} 학생, 안내드립니다.', mediaIds: [] });

    const preview = await request(app).post(`/api/message-drafts/${draftId}/recipient-preview`).set('Cookie', cookie);
    expect(preview.body.data.includedCount).toBe(2);

    const approved = await request(app).post(`/api/message-drafts/${draftId}/approve`).set('Cookie', cookie).send({ sendMode: 'immediate', deviceId });
    expect(approved.body.data.totalContacts).toBe(2);
  });

  it('blocks approval when an opted-out recipient is included, until explicitly confirmed', async () => {
    const { gradeId, deviceId } = await seedFixtures();
    await db.insert(optOuts).values({ phoneNormalized: GUARDIAN_PHONE, status: 'active', effectiveDate: '2026-08-01' });

    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const created = await request(app).post('/api/message-drafts').set('Cookie', cookie).send({ name: 'test-drafts-campaign', messageType: 'informational' });
    const draftId = created.body.data.id;
    await request(app).patch(`/api/message-drafts/${draftId}/recipients`).set('Cookie', cookie).send({ recipientType: 'grade', filter: { gradeLevelId: gradeId }, duplicateStrategy: 'merge' });
    await request(app).patch(`/api/message-drafts/${draftId}/content`).set('Cookie', cookie).send({ bodySource: '안내드립니다.', mediaIds: [] });

    const blocked = await request(app).post(`/api/message-drafts/${draftId}/approve`).set('Cookie', cookie).send({ sendMode: 'immediate', deviceId });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('OPT_OUT_RECIPIENTS');

    const confirmed = await request(app)
      .post(`/api/message-drafts/${draftId}/approve`)
      .set('Cookie', cookie)
      .send({ sendMode: 'immediate', deviceId, confirmOptOutOverride: true });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data.optOutOverrideConfirmed).toBe(true);
  });
});
