// Source for the Vercel serverless function, deliberately kept OUTSIDE
// api/ — see scripts/build-vercel.ts for why. Bundled by that script into
// .vercel/output/functions/api/index.func/index.js; not imported by
// server/index.ts (local dev) or any test.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from './app';
import { loadEnv } from './env';
import { bootstrapAdmin } from './services/bootstrapAdmin';

// TEMPORARY DIAGNOSTIC — remove before finishing deployment setup.
console.log(
  'env presence check:',
  JSON.stringify(
    Object.fromEntries(
      [
        'NODE_ENV',
        'PORT',
        'APP_URL',
        'DATABASE_URL',
        'AUTH_SESSION_SECRET',
        'INITIAL_ADMIN_EMAIL',
        'INITIAL_ADMIN_PASSWORD',
        'INITIAL_ADMIN_NAME',
        'RESEND_API_KEY',
        'RESEND_FROM_EMAIL',
      ].map((key) => [key, { present: key in process.env, length: process.env[key]?.length ?? -1 }])
    )
  )
);

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
