import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from '../server/app';
import { loadEnv } from '../server/env';
import { bootstrapAdmin } from '../server/services/bootstrapAdmin';

const env = loadEnv();
const app = createApp();

// Runs once per cold start (module scope persists across warm invocations
// on the same instance), not once per request.
let bootstrapPromise: Promise<void> | null = null;

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!bootstrapPromise) {
    bootstrapPromise = bootstrapAdmin(env).catch((error: unknown) => {
      bootstrapPromise = null;
      throw error;
    });
  }
  await bootstrapPromise;
  app(req, res);
}
