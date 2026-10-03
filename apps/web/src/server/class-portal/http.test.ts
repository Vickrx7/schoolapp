import { describe, expect, it } from 'vitest';
import { surfaceOf } from '../../lib/surface';
import { MAX_BODY_BYTES, busyResponse, jsonResponse, readJsonBody, sameOrigin } from './http';

const post = (body: BodyInit | null, headers: Record<string, string> = {}) =>
  new Request('http://localhost:3000/jouer/api/join', { method: 'POST', body, headers });

describe('device API plumbing (D-083, D-084)', () => {
  it('answers without caching, and 503 with Retry-After when busy', async () => {
    const ok = jsonResponse({ status: 'ok' });
    expect(ok.headers.get('cache-control')).toBe('no-store');
    expect(await ok.json()).toEqual({ status: 'ok' });
    const busy = busyResponse();
    expect(busy.status).toBe(503);
    expect(busy.headers.get('retry-after')).toBe('2');
    expect(busy.headers.get('cache-control')).toBe('no-store');
  });

  it('accepts POSTs from the app’s own origin only', () => {
    const app = 'https://ecole.example.ca';
    expect(sameOrigin('https://ecole.example.ca', app)).toBe(true);
    expect(sameOrigin('https://ecole.example.ca', `${app}/`)).toBe(true);
    expect(sameOrigin('http://ecole.example.ca', app)).toBe(false);
    expect(sameOrigin('https://evil.example', app)).toBe(false);
    expect(sameOrigin('https://ecole.example.ca.evil.example', app)).toBe(false);
    expect(sameOrigin('null', app)).toBe(false);
    expect(sameOrigin(null, app)).toBe(false);
    expect(sameOrigin('', app)).toBe(false);
  });

  it('reads a small JSON body and refuses large or broken ones', async () => {
    expect(await readJsonBody(post(JSON.stringify({ code: 'k7m 4r9' })))).toEqual({
      code: 'k7m 4r9',
    });
    expect(await readJsonBody(post('not json'))).toBeUndefined();
    expect(await readJsonBody(post(null))).toBeUndefined();
    const big = JSON.stringify({ text: 'x'.repeat(MAX_BODY_BYTES) });
    expect(await readJsonBody(post(big))).toBeUndefined();
    // A lying Content-Length does not let more through.
    expect(await readJsonBody(post(big, { 'content-length': '10' }))).toBeUndefined();
    expect(await readJsonBody(post('{}', { 'content-length': String(MAX_BODY_BYTES + 1) }))).toBe(
      undefined,
    );
  });

  it('marks /jouer as the student surface and nothing else', () => {
    expect(surfaceOf('/jouer')).toBe('jouer');
    expect(surfaceOf('/jouer/partie')).toBe('jouer');
    expect(surfaceOf('/jouer/api/state')).toBe('jouer');
    expect(surfaceOf('/jouerx')).toBe('app');
    expect(surfaceOf('/library/jouer')).toBe('app');
    expect(surfaceOf('/')).toBe('app');
  });
});
