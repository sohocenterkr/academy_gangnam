import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environmentMatchGlobs: [
      ['client/**', 'jsdom'],
      ['server/**', 'node'],
      ['shared/**', 'node'],
    ],
    setupFiles: ['./vitest.setup.ts'],
  },
});
