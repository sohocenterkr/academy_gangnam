import express, { type Express } from 'express';
import { requestId } from './middleware/requestId';
import { errorHandler } from './middleware/errorHandler';
import { healthRouter } from './routes/health';

export function createApp(): Express {
  const app = express();

  app.use(express.json());
  app.use(requestId);
  app.use('/api', healthRouter);
  app.use(errorHandler);

  return app;
}
