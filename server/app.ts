import express, { type Express } from 'express';
import { requestId } from './middleware/requestId';
import { errorHandler } from './middleware/errorHandler';
import { healthRouter } from './routes/health';
import { createAuthRouter } from './routes/auth';
import { loadEnv } from './env';

export function createApp(): Express {
  const env = loadEnv();
  const app = express();

  app.use(requestId);
  app.use(express.json());
  app.use(
    '/api/auth',
    createAuthRouter({ sessionSecret: env.AUTH_SESSION_SECRET, isProduction: env.NODE_ENV === 'production' })
  );
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
