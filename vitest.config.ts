import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
          environment: 'node',
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
