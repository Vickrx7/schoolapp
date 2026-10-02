import { describe, expect, it } from 'vitest';
import { AuthAdminError, authAdminErrorCode, createAuthAdmin } from './auth-admin';

const pool = { query: async () => ({ rows: [] }) } as never;

describe('authAdminErrorCode (D-107)', () => {
  it('retries when Auth did not answer, is busy or failed', () => {
    expect(authAdminErrorCode({})).toBe('transient');
    expect(authAdminErrorCode({ status: 0 })).toBe('transient');
    expect(authAdminErrorCode({ status: 408 })).toBe('transient');
    expect(authAdminErrorCode({ status: 429, code: 'over_request_rate_limit' })).toBe('transient');
    expect(authAdminErrorCode({ status: 500, code: 'unexpected_failure' })).toBe('transient');
    expect(authAdminErrorCode({ status: 503 })).toBe('transient');
  });

  it('recognizes an address that already has an account', () => {
    expect(authAdminErrorCode({ status: 422, code: 'email_exists' })).toBe('exists');
    expect(authAdminErrorCode({ status: 422, code: 'user_already_exists' })).toBe('exists');
    expect(authAdminErrorCode({ status: 422 })).toBe('exists');
  });

  it('recognizes an account that is gone', () => {
    expect(authAdminErrorCode({ status: 404, code: 'user_not_found' })).toBe('notFound');
    expect(authAdminErrorCode({ status: 404 })).toBe('notFound');
  });

  it('treats any other client error as a refusal (the invitation fails as authRefused)', () => {
    expect(authAdminErrorCode({ status: 400, code: 'validation_failed' })).toBe('refused');
    expect(authAdminErrorCode({ status: 422, code: 'email_address_invalid' })).toBe('refused');
    expect(authAdminErrorCode({ status: 403, code: 'not_admin' })).toBe('refused');
    expect(authAdminErrorCode({ status: 401 })).toBe('refused');
  });

  it('describes itself with the status and code only', () => {
    const error = new AuthAdminError('refused', 422, 'email_address_invalid');
    expect(error.message).toBe('auth admin: refused (422 email_address_invalid)');
    expect(new AuthAdminError('transient', null, null).message).toBe('auth admin: transient');
  });
});

describe('createAuthAdmin', () => {
  it('is off without the Auth URL or the service role key', () => {
    expect(
      createAuthAdmin({ SUPABASE_URL: undefined, SUPABASE_SERVICE_ROLE_KEY: 'k'.repeat(40) }, pool),
    ).toBeNull();
    expect(
      createAuthAdmin(
        { SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_SERVICE_ROLE_KEY: undefined },
        pool,
      ),
    ).toBeNull();
  });

  it('is on with both', () => {
    const admin = createAuthAdmin(
      { SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_SERVICE_ROLE_KEY: 'k'.repeat(40) },
      pool,
    );
    expect(admin).not.toBeNull();
    expect(Object.keys(admin!).sort()).toEqual([
      'createUser',
      'deleteUser',
      'findUserId',
      'setBanned',
    ]);
  });
});
