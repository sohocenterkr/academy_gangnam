import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Load repo-root .env into process.env so server-side tests (which call
// loadEnv()/connect to the real dev DB via server/db.ts) work the same way
// under plain `vitest run` as they do under the `dotenv -e .env --` npm
// scripts.
Object.assign(process.env, loadEnv(process.env.NODE_ENV ?? 'development', __dirname, ''));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'shared'),
    },
  },
  test: {
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    projects: [
      {
        extends: true,
        test: {
          name: 'client',
          include: ['client/**/*.{test,spec}.{ts,tsx}'],
          environment: 'jsdom',
        },
      },
      {
        extends: true,
        test: {
          name: 'server',
          include: ['server/**/*.{test,spec}.{ts,tsx}'],
          exclude: [
            'server/routes/messagingSettings.test.ts',
            'server/routes/messageDrafts.test.ts',
            'server/routes/messageCampaigns.test.ts',
            'server/services/messageDispatch.test.ts',
          ],
          environment: 'node',
        },
      },
      {
        // Split out from 'server': these suites all touch the single integration_settings row a
        // real Pushbullet connection uses (one row per provider, unique constraint). Running
        // them in parallel let them interleave and corrupt/delete that row — see
        // server/testUtils/pushbulletIntegrationFixture.ts. fileParallelism: false forces them
        // to run one at a time without slowing down the rest of the server suite.
        extends: true,
        test: {
          name: 'server-pushbullet-singleton',
          include: [
            'server/routes/messagingSettings.test.ts',
            'server/routes/messageDrafts.test.ts',
            'server/routes/messageCampaigns.test.ts',
            'server/services/messageDispatch.test.ts',
          ],
          environment: 'node',
          fileParallelism: false,
        },
      },
      {
        extends: true,
        test: {
          name: 'shared',
          include: ['shared/**/*.{test,spec}.{ts,tsx}'],
          environment: 'node',
        },
      },
    ],
  },
});
