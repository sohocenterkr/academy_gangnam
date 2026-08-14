import { createApp } from './app';
import { loadEnv } from './env';
import { bootstrapAdmin } from './services/bootstrapAdmin';

const env = loadEnv();

async function main() {
  await bootstrapAdmin(env);

  const app = createApp();
  app.listen(env.PORT, () => {
    console.log(`API server listening on http://localhost:${env.PORT}`);
  });
}

main().catch((error: unknown) => {
  console.error('Failed to start server:', error);
  process.exitCode = 1;
});
