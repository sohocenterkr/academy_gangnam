import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

describe('loadEnv', () => {
  it('applies defaults when optional values are missing', () => {
    const env = loadEnv({});

    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(8787);
  });

  it('coerces PORT from a string to a number', () => {
    const env = loadEnv({ PORT: '3000' });

    expect(env.PORT).toBe(3000);
  });

  it('rejects an invalid APP_URL', () => {
    expect(() => loadEnv({ APP_URL: 'not-a-url' })).toThrow(/APP_URL/);
  });
});
