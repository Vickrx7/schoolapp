import { describe, expect, it } from 'vitest';
import {
  adminEnvSchema,
  appNameFrom,
  appReleaseFrom,
  DEFAULT_OPERATOR_NAME,
  EnvError,
  loadEnv,
  operatorNameFrom,
  webServerEnvSchema,
  workerEnvSchema,
} from './index';

describe('loadEnv', () => {
  it('applies defaults and treats empty strings as unset', () => {
    const env = loadEnv(webServerEnvSchema, {
      SUPABASE_URL: 'http://127.0.0.1:54321',
      SUPABASE_ANON_KEY: 'x'.repeat(40),
      APP_NAME: '',
    });
    expect(env).toMatchObject({
      SUPABASE_URL: 'http://127.0.0.1:54321',
      APP_NAME: 'Lynx École',
      APP_RELEASE: 'dev',
      APP_BASE_URL: 'http://localhost:3000',
    });
    expect(env.SUPPORT_EMAIL).toBeUndefined();
    expect(env.PRIVACY_CONTACT_EMAIL).toBeUndefined();
  });

  it('leaves the substitute portal unconfigured by default, with safe proxy defaults', () => {
    const base = {
      SUPABASE_URL: 'http://127.0.0.1:54321',
      SUPABASE_ANON_KEY: 'x'.repeat(40),
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

  it('leaves quizzes on devices off by default (D-083)', () => {
    const base = {
      SUPABASE_URL: 'http://127.0.0.1:54321',
      SUPABASE_ANON_KEY: 'x'.repeat(40),
    };
    const defaults = loadEnv(webServerEnvSchema, {
      ...base,
      CLASS_PORTAL_DATABASE_URL: '',
      CLASS_PORTAL_HMAC_KEY: '',
    });
    expect(defaults.CLASS_PORTAL_DATABASE_URL).toBeUndefined();
    expect(defaults.CLASS_PORTAL_HMAC_KEY).toBe('');
    expect(
      loadEnv(webServerEnvSchema, {
        ...base,
        CLASS_PORTAL_DATABASE_URL: 'postgresql://lynx_class_portal:x@127.0.0.1:54322/postgres',
        CLASS_PORTAL_HMAC_KEY: 'a2V5',
      }),
    ).toMatchObject({
      CLASS_PORTAL_DATABASE_URL: 'postgresql://lynx_class_portal:x@127.0.0.1:54322/postgres',
      CLASS_PORTAL_HMAC_KEY: 'a2V5',
    });
  });

  it('caps a bulk generation run at 100 USD by default, 1,000 at most (D-096)', () => {
    const worker = { DATABASE_URL: 'postgres://x' };
    expect(loadEnv(workerEnvSchema, worker).BULK_MAX_RUN_USD).toBe(100);
    expect(loadEnv(workerEnvSchema, { ...worker, BULK_MAX_RUN_USD: '25.5' }).BULK_MAX_RUN_USD).toBe(
      25.5,
    );
    for (const bad of ['0', '-1', '1001', 'beaucoup']) {
      expect(() => loadEnv(workerEnvSchema, { ...worker, BULK_MAX_RUN_USD: bad }), bad).toThrow(
        /BULK_MAX_RUN_USD/,
      );
    }
    // The admin CLI reads the same setting, so both sides agree on the cap.
    const admin = {
      SUPABASE_URL: 'http://127.0.0.1:54321',
      SUPABASE_SERVICE_ROLE_KEY: 'x'.repeat(40),
    };
    expect(loadEnv(adminEnvSchema, admin).BULK_MAX_RUN_USD).toBe(100);
    expect(loadEnv(adminEnvSchema, { ...admin, BULK_MAX_RUN_USD: '40' }).BULK_MAX_RUN_USD).toBe(40);
    expect(() => loadEnv(adminEnvSchema, { ...admin, BULK_MAX_RUN_USD: '5000' })).toThrow(
      /BULK_MAX_RUN_USD/,
    );
    expect(() => loadEnv(adminEnvSchema, {})).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('reads the settings at run time under their new names, the old NEXT_PUBLIC_ ones as fallbacks (D-113)', () => {
    const legacy = {
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'a'.repeat(40),
      NEXT_PUBLIC_APP_NAME: 'Au tableau!',
    };
    // An existing .env with only the old names keeps working...
    expect(loadEnv(webServerEnvSchema, legacy)).toMatchObject({
      SUPABASE_URL: 'http://127.0.0.1:54321',
      SUPABASE_ANON_KEY: 'a'.repeat(40),
      APP_NAME: 'Au tableau!',
    });
    // ...the new names win when both are set...
    const both = loadEnv(webServerEnvSchema, {
      ...legacy,
      SUPABASE_URL: 'https://api.exemple.ca',
      SUPABASE_ANON_KEY: 'b'.repeat(40),
      APP_NAME: 'Présent!',
    });
    expect(both).toMatchObject({
      SUPABASE_URL: 'https://api.exemple.ca',
      SUPABASE_ANON_KEY: 'b'.repeat(40),
      APP_NAME: 'Présent!',
    });
    // ...and the old names never come out of the parsed settings.
    expect(Object.keys(both).filter((k) => k.startsWith('NEXT_PUBLIC_'))).toEqual([]);
    // An empty new name falls back too (loadEnv treats it as unset).
    expect(loadEnv(webServerEnvSchema, { ...legacy, APP_NAME: '' }).APP_NAME).toBe('Au tableau!');
    expect(() => loadEnv(webServerEnvSchema, { SUPABASE_ANON_KEY: 'a'.repeat(40) })).toThrow(
      /SUPABASE_URL/,
    );
    // The admin CLI and the worker read SUPABASE_URL the same way.
    expect(
      loadEnv(adminEnvSchema, {
        NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
        SUPABASE_SERVICE_ROLE_KEY: 'x'.repeat(40),
      }).SUPABASE_URL,
    ).toBe('http://127.0.0.1:54321');
    expect(
      loadEnv(workerEnvSchema, {
        DATABASE_URL: 'postgres://x',
        NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
      }).SUPABASE_URL,
    ).toBe('http://127.0.0.1:54321');
  });

  it('names the product from APP_NAME, at run time (D-002, D-113)', () => {
    expect(appNameFrom({})).toBe('Lynx École');
    expect(appNameFrom({ APP_NAME: '  ' })).toBe('Lynx École');
    expect(appNameFrom({ NEXT_PUBLIC_APP_NAME: 'Ardoise' })).toBe('Ardoise');
    expect(appNameFrom({ APP_NAME: 'Présent!', NEXT_PUBLIC_APP_NAME: 'Ardoise' })).toBe('Présent!');
  });

  it('reads the release for log lines without failing (D-111)', () => {
    expect(appReleaseFrom({})).toBe('dev');
    expect(appReleaseFrom({ APP_RELEASE: '' })).toBe('dev');
    expect(appReleaseFrom({ APP_RELEASE: '0.6.0+build.7' })).toBe('0.6.0+build.7');
    expect(appReleaseFrom({ APP_RELEASE: 'not a release; rm -rf' })).toBe('dev');
    expect(appReleaseFrom({ APP_RELEASE: 'x'.repeat(41) })).toBe('dev');
  });

  it('checks the release name and the contact addresses (D-110, D-117)', () => {
    const base = { SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_ANON_KEY: 'x'.repeat(40) };
    expect(
      loadEnv(webServerEnvSchema, {
        ...base,
        APP_RELEASE: '0.6.0',
        SUPPORT_EMAIL: 'soutien@iplynx.ca',
        PRIVACY_CONTACT_EMAIL: 'confidentialite@iplynx.ca',
      }),
    ).toMatchObject({
      APP_RELEASE: '0.6.0',
      SUPPORT_EMAIL: 'soutien@iplynx.ca',
      PRIVACY_CONTACT_EMAIL: 'confidentialite@iplynx.ca',
    });
    for (const bad of ['0.6 beta', 'v'.repeat(41), '-rc', '<script>']) {
      expect(() => loadEnv(webServerEnvSchema, { ...base, APP_RELEASE: bad }), bad).toThrow(
        /APP_RELEASE/,
      );
    }
    expect(() => loadEnv(webServerEnvSchema, { ...base, SUPPORT_EMAIL: 'soutien' })).toThrow(
      /SUPPORT_EMAIL/,
    );
  });

  it('gives the worker its health port, release and heartbeat check, all off by default (D-112)', () => {
    const worker = { DATABASE_URL: 'postgres://x' };
    const defaults = loadEnv(workerEnvSchema, worker);
    expect(defaults).toMatchObject({ WORKER_HEALTH_PORT: 0, APP_RELEASE: 'dev' });
    expect(defaults.HEARTBEAT_URL_WORKER).toBeUndefined();
    expect(defaults.SUPABASE_URL).toBeUndefined();
    expect(defaults.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
    expect(
      loadEnv(workerEnvSchema, {
        ...worker,
        WORKER_HEALTH_PORT: '8081',
        APP_RELEASE: '0.6.0',
        HEARTBEAT_URL_WORKER: 'https://hc.exemple.ca/ping/abc',
        SUPABASE_URL: 'http://127.0.0.1:54321',
        SUPABASE_SERVICE_ROLE_KEY: 'x'.repeat(40),
      }),
    ).toMatchObject({
      WORKER_HEALTH_PORT: 8081,
      APP_RELEASE: '0.6.0',
      HEARTBEAT_URL_WORKER: 'https://hc.exemple.ca/ping/abc',
      SUPABASE_URL: 'http://127.0.0.1:54321',
    });
    for (const bad of ['-1', '65536', 'http']) {
      expect(() => loadEnv(workerEnvSchema, { ...worker, WORKER_HEALTH_PORT: bad }), bad).toThrow(
        /WORKER_HEALTH_PORT/,
      );
    }
    expect(() =>
      loadEnv(workerEnvSchema, { ...worker, HEARTBEAT_URL_WORKER: 'pas une url' }),
    ).toThrow(/HEARTBEAT_URL_WORKER/);
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

  it('names the operator from OPERATOR_NAME, IP Lynx by default (D-148)', () => {
    const admin = {
      SUPABASE_URL: 'http://127.0.0.1:54321',
      SUPABASE_SERVICE_ROLE_KEY: 'x'.repeat(40),
    };
    expect(loadEnv(adminEnvSchema, admin).OPERATOR_NAME).toBe('IP Lynx');
    expect(DEFAULT_OPERATOR_NAME).toBe('IP Lynx');
    expect(operatorNameFrom({})).toBe('IP Lynx');
    // Compose passes an unset setting as an empty string.
    expect(operatorNameFrom({ OPERATOR_NAME: '' })).toBe('IP Lynx');
    expect(operatorNameFrom({ OPERATOR_NAME: '  Service informatique du CSC Exemple ' })).toBe(
      'Service informatique du CSC Exemple',
    );
    expect(operatorNameFrom({ OPERATOR_NAME: 'Équipe TI — Conseil d’Exemple' })).toBe(
      'Équipe TI — Conseil d’Exemple',
    );
    expect(operatorNameFrom({ OPERATOR_NAME: 'é'.repeat(80) })).toHaveLength(80);
    expect(
      loadEnv(adminEnvSchema, { ...admin, OPERATOR_NAME: 'Marc Gagnon (TI)' }).OPERATOR_NAME,
    ).toBe('Marc Gagnon (TI)');
  });

  it('refuses a blank, long or hidden-character operator name (D-148)', () => {
    for (const bad of [
      '   ',
      'é'.repeat(81),
      'IP\nLynx',
      'IP\tLynx',
      'IP Lynx\u0007',
      'IP\u0085Lynx',
      'xnyL PI\u202E',
      'IP\u200BLynx',
      'IP\u2028Lynx',
      'IP\uFEFFLynx',
    ]) {
      expect(() => operatorNameFrom({ OPERATOR_NAME: bad }), JSON.stringify(bad)).toThrow(
        /OPERATOR_NAME/,
      );
    }
    expect(() => operatorNameFrom({ OPERATOR_NAME: ' \t ' })).toThrow(/must not be blank/);
    expect(() => operatorNameFrom({ OPERATOR_NAME: 'a\u0000b' })).toThrow(/invisible/);
    // The whole admin environment refuses it too, so no command runs with it.
    expect(() =>
      loadEnv(adminEnvSchema, {
        SUPABASE_URL: 'http://127.0.0.1:54321',
        SUPABASE_SERVICE_ROLE_KEY: 'x'.repeat(40),
        OPERATOR_NAME: 'x'.repeat(81),
      }),
    ).toThrow(EnvError);
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
