import { Router } from 'express';
import { getNowKSTISOString } from '@shared/kst';
import { checkDbConnection } from '../db';

export const healthRouter = Router();

healthRouter.get('/health', async (req, res) => {
  const dbOk = await checkDbConnection();

  res.json({
    data: {
      status: 'ok',
      db: dbOk ? 'ok' : 'error',
    },
    meta: {
      requestId: req.requestId,
      kstTimestamp: getNowKSTISOString(),
    },
  });
});
