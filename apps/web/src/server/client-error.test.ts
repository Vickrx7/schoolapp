import { describe, expect, it } from 'vitest';
import { createWindowLimiter, parseClientError, readLimitedText } from './client-error';

const report = (fields: Record<string, unknown>) =>
  JSON.stringify({ name: 'TypeError', ref: 'k3x9a0bq', route: '/today', ...fields });

describe('browser error reports (D-111)', () => {
  it('accepts a name, a reference, a route and a message hash', () => {
    expect(parseClientError(report({ messageHash: '0123456789abcdef' }))).toEqual({
      name: 'TypeError',
      ref: 'k3x9a0bq',
      route: '/today',
      messageHash: '0123456789abcdef',
    });
    expect(parseClientError(report({ ref: '2338285476' }))).toEqual({
      name: 'TypeError',
      ref: '2338285476',
      route: '/today',
    });
  });

  it('makes the route template again', () => {
    expect(
      parseClientError(
        report({ route: '/classes/0b5e7c1a-2f3d-4e5f-8a9b-0c1d2e3f4a5b/students?q=Léa#x' }),
      )?.route,
    ).toBe('/classes/[id]/students');
    expect(parseClientError(report({ route: '/isabelle@ecole.ca' }))?.route).toBe('/[x]');
  });

  it('refuses anything else: a message, free text, another shape', () => {
    for (const body of [
      'not json',
      '[]',
      'null',
      report({ message: 'Léa a oublié son lunch' }),
      report({ name: 'Error: Léa' }),
      report({ ref: 'Léa' }),
      report({ ref: 'isabelle@ecole.ca' }),
      report({ messageHash: 'Léa a oublié son lunch' }),
      report({ messageHash: '0123456789ABCDEF' }),
      report({ route: 'x'.repeat(301) }),
      report({ route: 42 }),
      JSON.stringify({ name: 'TypeError', route: '/today' }),
    ]) {
      expect(parseClientError(body), body).toBeNull();
    }
  });

  it('allows 30 reports a minute per address', () => {
    const limiter = createWindowLimiter({ limit: 30, windowMs: 60_000, maxKeys: 3 });
    const t0 = 1_000_000;
    for (let i = 0; i < 30; i++) expect(limiter.take('198.51.100.9', t0 + i)).toBe(true);
    expect(limiter.take('198.51.100.9', t0 + 100)).toBe(false);
    expect(limiter.take('203.0.113.7', t0 + 100)).toBe(true);
    expect(limiter.take('198.51.100.9', t0 + 60_000)).toBe(true);
  });

  it('forgets every address when the table is full', () => {
    const limiter = createWindowLimiter({ limit: 1, windowMs: 60_000, maxKeys: 2 });
    expect(limiter.take('a', 0)).toBe(true);
    expect(limiter.take('a', 1)).toBe(false);
    expect(limiter.take('b', 2)).toBe(true);
    expect(limiter.take('c', 3)).toBe(true);
    expect(limiter.take('a', 4)).toBe(true);
  });

  it('reads at most the size limit', async () => {
    const post = (body: BodyInit, headers?: Record<string, string>) =>
      new Request('http://localhost/api/client-error', { method: 'POST', body, headers });
    await expect(readLimitedText(post('{"a":1}'), 2048)).resolves.toBe('{"a":1}');
    await expect(readLimitedText(post('é'.repeat(1024)), 2048)).resolves.toBe('é'.repeat(1024));
    await expect(readLimitedText(post('x'.repeat(2049)), 2048)).resolves.toBeNull();
    // A body sent in pieces, with no declared length.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 10; i++) controller.enqueue(new Uint8Array(300));
        controller.close();
      },
    });
    const chunked = new Request('http://localhost/api/client-error', {
      method: 'POST',
      body: stream,
      duplex: 'half',
    } as RequestInit);
    await expect(readLimitedText(chunked, 2048)).resolves.toBeNull();
    await expect(
      readLimitedText(post('{}', { 'content-length': '999999' }), 2048),
    ).resolves.toBeNull();
  });
});
