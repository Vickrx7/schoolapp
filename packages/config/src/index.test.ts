import { describe, expect, it } from 'vitest';
import { EnvError, loadEnv, webServerEnvSchema, workerEnvSchema } from './index';

describe('loadEnv', () => {
  it('applies defaults and treats empty strings as unset', () => {
    const env = loadEnv(webServerEnvSchema, {
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'x'.repeat(40),
      AI_PROVIDER: '',
    });
    expect(env.AI_PROVIDER).toBe('none');
    expect(env.NEXT_PUBLIC_APP_NAME).toBe('Lynx École');
  });

  it('lists every problem in one readable error', () => {
    expect(() => loadEnv(workerEnvSchema, { WORKER_CONCURRENCY: '0' })).toThrow(EnvError);
    try {
      loadEnv(workerEnvSchema, { WORKER_CONCURRENCY: '0' });
    } catch (e) {
      expect(String(e)).toMatch(/DATABASE_URL/);
      expect(String(e)).toMatch(/WORKER_CONCURRENCY/);
    }
  });
});
