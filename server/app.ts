import express, { type Express } from 'express';
import { requestId } from './middleware/requestId';
import { errorHandler } from './middleware/errorHandler';
import { healthRouter } from './routes/health';
import { createAuthRouter } from './routes/auth';
import { createRolesRouter } from './routes/roles';
import { createAdminsRouter } from './routes/admins';
import { createAcademySettingsRouter } from './routes/academySettings';
import { createSchoolsRouter } from './routes/schools';
import { createGradeLevelsRouter } from './routes/gradeLevels';
import { createGuardiansRouter } from './routes/guardians';
import { createStudentsRouter } from './routes/students';
import { createStudentGuardiansRouter } from './routes/studentGuardians';
import { createCheckInRouter } from './routes/checkIn';
import { createCheckInsRouter } from './routes/checkIns';
import { createInstructorsRouter } from './routes/instructors';
import { createCoursesRouter } from './routes/courses';
import { createCourseSchedulesRouter } from './routes/courseSchedules';
import { createCourseExceptionsRouter } from './routes/courseExceptions';
import { createEnrollmentsRouter } from './routes/enrollments';
import { createUploadsRouter } from './routes/uploads';
import { createMessagingSettingsRouter } from './routes/messagingSettings';
import { createMessageTemplatesRouter } from './routes/messageTemplates';
import { createMessageDraftsRouter } from './routes/messageDrafts';
import { createMessageCampaignsRouter, createMessageUsageRouter } from './routes/messageCampaigns';
import { createPushbulletSmsClient, type PushbulletSmsClient } from './services/pushbulletSms';
import { createPlatformPresetsRouter } from './routes/platformPresets';
import { createCardNewsRouter } from './routes/cardNews';
import { createDashboardRouter } from './routes/dashboard';
import { createAuditLogsRouter } from './routes/auditLogs';
import { createCronRouter } from './routes/cron';
import { loadEnv } from './env';
import { createResendEmailAdapter } from './services/email';
import { createCloudinaryClient, type CloudinaryClient } from './services/cloudinary';
import { createPushbulletClient, type PushbulletClient } from './services/pushbullet';

export interface AppOverrides {
  emailAdapter?: import('./services/email').EmailAdapter;
  cloudinary?: CloudinaryClient;
  pushbullet?: PushbulletClient;
  pushbulletTokenEncryptionKey?: string;
  pushbulletSms?: PushbulletSmsClient;
  cronSecret?: string;
}

export function createApp(overrides: AppOverrides = {}): Express {
  const env = loadEnv();
  const app = express();

  const emailAdapter = overrides.emailAdapter ?? createResendEmailAdapter(env.RESEND_API_KEY, env.RESEND_FROM_EMAIL);

  app.use(requestId);
  app.use(express.json());
  app.use(
    '/api/auth',
    createAuthRouter({
      sessionSecret: env.AUTH_SESSION_SECRET,
      isProduction: env.NODE_ENV === 'production',
      emailAdapter,
      appUrl: env.APP_URL ?? 'http://localhost:5173',
    })
  );
  app.use('/api/roles', createRolesRouter({ sessionSecret: env.AUTH_SESSION_SECRET }));
  app.use(
    '/api/admins',
    createAdminsRouter({
      sessionSecret: env.AUTH_SESSION_SECRET,
      appUrl: env.APP_URL ?? 'http://localhost:5173',
      emailAdapter,
    })
  );
  app.use('/api/settings/academy', createAcademySettingsRouter({ sessionSecret: env.AUTH_SESSION_SECRET }));
  app.use('/api/schools', createSchoolsRouter({ sessionSecret: env.AUTH_SESSION_SECRET }));
  app.use('/api/grade-levels', createGradeLevelsRouter({ sessionSecret: env.AUTH_SESSION_SECRET }));
  app.use('/api/guardians', createGuardiansRouter({ sessionSecret: env.AUTH_SESSION_SECRET }));
  app.use('/api/students', createStudentsRouter({ sessionSecret: env.AUTH_SESSION_SECRET }));
  app.use('/api/student-guardians', createStudentGuardiansRouter({ sessionSecret: env.AUTH_SESSION_SECRET }));
  app.use('/api/check-in', createCheckInRouter({ sessionSecret: env.AUTH_SESSION_SECRET }));
  app.use('/api/check-ins', createCheckInsRouter({ sessionSecret: env.AUTH_SESSION_SECRET }));
  app.use('/api/instructors', createInstructorsRouter({ sessionSecret: env.AUTH_SESSION_SECRET }));
  app.use('/api/courses', createCoursesRouter({ sessionSecret: env.AUTH_SESSION_SECRET }));
  app.use('/api', createCourseSchedulesRouter({ sessionSecret: env.AUTH_SESSION_SECRET }));
  app.use('/api', createCourseExceptionsRouter({ sessionSecret: env.AUTH_SESSION_SECRET }));
  app.use('/api/enrollments', createEnrollmentsRouter({ sessionSecret: env.AUTH_SESSION_SECRET }));

  const cloudinaryConfigured =
    env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET && env.CLOUDINARY_UPLOAD_ROOT;
  const cloudinary = overrides.cloudinary ?? (cloudinaryConfigured
    ? createCloudinaryClient({
        cloudName: env.CLOUDINARY_CLOUD_NAME!,
        apiKey: env.CLOUDINARY_API_KEY!,
        apiSecret: env.CLOUDINARY_API_SECRET!,
        uploadRoot: env.CLOUDINARY_UPLOAD_ROOT!,
      })
    : undefined);
  if (cloudinary) {
    app.use(
      '/api/uploads',
      createUploadsRouter({
        sessionSecret: env.AUTH_SESSION_SECRET,
        cloudinary,
        cloudName: env.CLOUDINARY_CLOUD_NAME ?? '',
        apiKey: env.CLOUDINARY_API_KEY ?? '',
        uploadRoot: env.CLOUDINARY_UPLOAD_ROOT ?? '',
      })
    );
  }

  app.use('/api/message-templates', createMessageTemplatesRouter({ sessionSecret: env.AUTH_SESSION_SECRET }));
  app.use('/api/message-drafts', createMessageDraftsRouter({ sessionSecret: env.AUTH_SESSION_SECRET }));
  app.use('/api/message-usage', createMessageUsageRouter({ sessionSecret: env.AUTH_SESSION_SECRET }));

  const tokenEncryptionKey = overrides.pushbulletTokenEncryptionKey ?? env.PUSHBULLET_TOKEN_ENCRYPTION_KEY;
  app.use(
    '/api/message-campaigns',
    createMessageCampaignsRouter({
      sessionSecret: env.AUTH_SESSION_SECRET,
      dispatch: {
        pushbulletSms: overrides.pushbulletSms ?? createPushbulletSmsClient(),
        tokenEncryptionKey: tokenEncryptionKey ?? '',
      },
    })
  );

  if (overrides.pushbullet || tokenEncryptionKey) {
    app.use(
      '/api/messaging',
      createMessagingSettingsRouter({
        sessionSecret: env.AUTH_SESSION_SECRET,
        pushbullet: overrides.pushbullet ?? createPushbulletClient(),
        tokenEncryptionKey: tokenEncryptionKey ?? '',
      })
    );
  }

  app.use('/api/platform-presets', createPlatformPresetsRouter({ sessionSecret: env.AUTH_SESSION_SECRET }));
  app.use('/api/card-news', createCardNewsRouter({ sessionSecret: env.AUTH_SESSION_SECRET }));
  app.use('/api/dashboard', createDashboardRouter({ sessionSecret: env.AUTH_SESSION_SECRET }));
  app.use('/api/audit-logs', createAuditLogsRouter({ sessionSecret: env.AUTH_SESSION_SECRET }));

  const cronSecret = overrides.cronSecret ?? env.CRON_SECRET;
  if (cronSecret) {
    app.use(
      '/api/cron',
      createCronRouter({
        cronSecret,
        dispatch: { pushbulletSms: overrides.pushbulletSms ?? createPushbulletSmsClient(), tokenEncryptionKey: tokenEncryptionKey ?? '' },
        cloudinary,
      })
    );
  }

  app.use('/api', healthRouter);
  app.use('/api', (req, res) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: '요청한 API를 찾을 수 없습니다.',
        requestId: req.requestId,
      },
    });
  });
  app.use(errorHandler);

  return app;
}
