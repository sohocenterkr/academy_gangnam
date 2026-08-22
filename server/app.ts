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
import { loadEnv } from './env';
import { createResendEmailAdapter } from './services/email';
import { createCloudinaryClient, type CloudinaryClient } from './services/cloudinary';

export interface AppOverrides {
  emailAdapter?: import('./services/email').EmailAdapter;
  cloudinary?: CloudinaryClient;
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
  if (overrides.cloudinary || cloudinaryConfigured) {
    const cloudinary =
      overrides.cloudinary ??
      createCloudinaryClient({
        cloudName: env.CLOUDINARY_CLOUD_NAME!,
        apiKey: env.CLOUDINARY_API_KEY!,
        apiSecret: env.CLOUDINARY_API_SECRET!,
        uploadRoot: env.CLOUDINARY_UPLOAD_ROOT!,
      });
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
