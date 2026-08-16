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
import { loadEnv } from './env';
import { createResendEmailAdapter } from './services/email';

export interface AppOverrides {
  emailAdapter?: import('./services/email').EmailAdapter;
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
