import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseClientError } from '../server/client-error';
import { clientErrorReport, messageHash, newReference, referenceFor } from './report-client-error';

describe('browser error reports (D-111)', () => {
  it('uses the digest of a server error as its reference, else a random one', () => {
    expect(referenceFor({ digest: '2338285476' })).toBe('2338285476');
    expect(referenceFor({ digest: '2338285476@E394' })).toBe('2338285476@E394');
    expect(referenceFor({ digest: 'NEXT_REDIRECT;/login' })).toMatch(/^[0-9a-z]{8}$/);
    expect(referenceFor({})).toMatch(/^[0-9a-z]{8}$/);
    const refs = new Set(Array.from({ length: 50 }, () => newReference()));
    expect(refs.size).toBe(50);
  });

  it('hashes the message instead of sending it', async () => {
    const message = "Cannot read properties of undefined (reading 'Léa')";
    expect(await messageHash(message)).toBe(
      createHash('sha256').update(message).digest('hex').slice(0, 16),
    );
    const report = await clientErrorReport(
      { name: 'TypeError', message },
      'k3x9a0bq',
      '/classes/0b5e7c1a-2f3d-4e5f-8a9b-0c1d2e3f4a5b/students',
    );
    expect(report).toEqual({
      name: 'TypeError',
      ref: 'k3x9a0bq',
      route: '/classes/[id]/students',
      messageHash: createHash('sha256').update(message).digest('hex').slice(0, 16),
    });
    expect(JSON.stringify(report)).not.toContain('Léa');
  });

  it('builds a report the server accepts', async () => {
    const report = await clientErrorReport(
      { name: 'Weird name with Léa', message: 'x' },
      referenceFor({ digest: '2338285476' }),
      '/suppleance/plan',
    );
    expect(report.name).toBe('Error');
    expect(parseClientError(JSON.stringify(report))).toEqual(report);
  });
});
