import { describe, expect, it } from 'vitest';
import { EnvError, loadEnv, webServerEnvSchema, workerEnvSchema } from './index';

describe('loadEnv', () => {
  it('applies defaults and treats empty strings as unset', () => {
    const env = loadEnv(webServerEnvSchema, {
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'x'.repeat(40),
      NEXT_PUBLIC_APP_NAME: '',
    });
    expect(env.NEXT_PUBLIC_APP_NAME).toBe('Lynx École');
  });

  it('leaves the substitute portal unconfigured by default, with safe proxy defaults', () => {
    const base = {
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'x'.repeat(40),
    };
    const defaults = loadEnv(webServerEnvSchema, { ...base, SUB_PORTAL_DATABASE_URL: '' });
    expect(defaults.SUB_PORTAL_DATABASE_URL).toBeUndefined();
    expect(defaults).toMatchObject({
      SUB_CODE_HMAC_KEYS: '',
      CLIENT_IP_HEADER: 'x-forwarded-for',
      TRUSTED_PROXY_HOPS: 1,
    });
    expect(
      loadEnv(webServerEnvSchema, {
        ...base,
        SUB_PORTAL_DATABASE_URL: 'postgresql://lynx_sub_portal:x@127.0.0.1:54322/postgres',
        SUB_CODE_HMAC_KEYS: '1:abc',
        CLIENT_IP_HEADER: 'X-Real-IP',
        TRUSTED_PROXY_HOPS: '2',
      }),
    ).toMatchObject({
      SUB_PORTAL_DATABASE_URL: 'postgresql://lynx_sub_portal:x@127.0.0.1:54322/postgres',
      SUB_CODE_HMAC_KEYS: '1:abc',
      CLIENT_IP_HEADER: 'x-real-ip',
      TRUSTED_PROXY_HOPS: 2,
    });
    expect(() => loadEnv(webServerEnvSchema, { ...base, TRUSTED_PROXY_HOPS: '9' })).toThrow(
      /TRUSTED_PROXY_HOPS/,
    );
    expect(() => loadEnv(webServerEnvSchema, { ...base, CLIENT_IP_HEADER: 'x forwarded' })).toThrow(
      /CLIENT_IP_HEADER/,
    );
  });

  it('keeps AI off by default and needs a key for Anthropic', () => {
    const env = loadEnv(workerEnvSchema, { DATABASE_URL: 'postgres://x', AI_PROVIDER: '' });
    expect(env).toMatchObject({
      AI_PROVIDER: 'none',
      AI_MODEL: 'claude-opus-5-5',
      AI_EFFORT: 'medium',
      AI_JOB_RETENTION_DAYS: 30,
    });
    expect(() =>
      loadEnv(workerEnvSchema, { DATABASE_URL: 'postgres://x', AI_PROVIDER: 'anthropic' }),
    ).toThrow(/ANTHROPIC_API_KEY/);
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
