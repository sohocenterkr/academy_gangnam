import { Router } from 'express';
import { getNowKSTISOString } from '../../shared/kst';

export const healthRouter = Router();

healthRouter.get('/health', (req, res) => {
  res.json({
    data: {
      status: 'ok',
    },
    meta: {
      requestId: req.requestId,
      kstTimestamp: getNowKSTISOString(),
    },
  });
});
