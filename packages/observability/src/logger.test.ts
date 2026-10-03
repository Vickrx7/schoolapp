import { afterEach, describe, expect, it, vi } from 'vitest';
import { graphileLogger } from './graphile';
import { createLogger, guardConsole, markLogged, originalConsole, type LogLevel } from './logger';
import { scrubError } from './scrub';

function collector() {
  const lines: { level: LogLevel; entry: Record<string, unknown>; raw: string }[] = [];
  const write = (raw: string, level: LogLevel) =>
    lines.push({ level, raw, entry: JSON.parse(raw) as Record<string, unknown> });
  return { lines, write };
}

/** Sentinels: none of them may ever reach a line. */
const SENTINELS = ['Léa', 'lea.parent@courriel.ca', '613-555-0142', 'K1A 0B1', '123456789'];

describe('createLogger', () => {
  it('writes one JSON line per entry with the fixed fields first', () => {
    const { lines, write } = collector();
    const logger = createLogger('jobs', { component: 'worker', release: '0.6.0', write });
    logger.info('dispatched', { count: 3, eventId: '0b5e7c1a-2f3d-4e5f-8a9b-0c1d2e3f4a5b' });
    logger.warn('slow', { ms: 1200 });
    logger.error('failed', { ok: false });
    expect(lines.map((l) => l.level)).toEqual(['info', 'warn', 'error']);
    expect(Object.keys(lines[0]!.entry)).toEqual([
      'time',
      'level',
      'component',
      'release',
      'scope',
      'message',
      'count',
      'eventId',
    ]);
    expect(lines[0]!.entry).toMatchObject({
      level: 'info',
      component: 'worker',
      release: '0.6.0',
      scope: 'jobs',
      message: 'dispatched',
      count: 3,
      eventId: '0b5e7c1a-2f3d-4e5f-8a9b-0c1d2e3f4a5b',
    });
    expect(lines.every((l) => !l.raw.includes('\n'))).toBe(true);
  });

  it('scrubs every string, error and nested value a careless caller passes', () => {
    const { lines, write } = collector();
    const logger = createLogger('test', { component: 'web', release: 'dev', write });
    class PrivacyViolation extends Error {
      constructor(readonly findings: { kind: string; match: string }[]) {
        super('refusing to send personal information (name)');
        this.name = 'PrivacyViolation';
      }
    }
    logger.error('failed for "Léa" at lea.parent@courriel.ca', {
      message: 'Key (email)=(lea.parent@courriel.ca) already exists',
      phone: '613-555-0142',
      nested: { postal: 'K1A 0B1', list: ['OEN 123456789', 7, null, true] },
      error: new PrivacyViolation([{ kind: 'name', match: 'Léa' }]),
      instance: new Map([['name', 'Léa']]),
      when: new Date('2026-10-02T12:00:00Z'),
      fn: () => 'Léa',
      skipped: undefined,
    });
    const raw = lines[0]!.raw;
    for (const sentinel of SENTINELS) expect(raw).not.toContain(sentinel);
    expect(lines[0]!.entry).toMatchObject({
      message: 'failed for "…" at [courriel]',
      nested: { postal: '[code postal]', list: ['OEN [nombre]', 7, null, true] },
      error: { name: 'PrivacyViolation' },
      instance: '[objet]',
      when: '2026-10-02T12:00:00.000Z',
    });
    expect(lines[0]!.entry).not.toHaveProperty('fn');
    expect(lines[0]!.entry).not.toHaveProperty('skipped');
  });

  it('keeps references and refuses to overwrite the fixed fields', () => {
    const { lines, write } = collector();
    const logger = createLogger('test', { component: 'web', release: 'dev', write });
    logger.error('client error', {
      ref: 'k3x9a0bq',
      digest: '2338285476',
      other: '2338285476',
      messageHash: '0123456789abcdef',
      badHash: '0123456789abcdef',
      toString: 'lea.parent@courriel.ca',
      level: 'info',
      scope: 'forged',
    });
    expect(lines[0]!.entry).toMatchObject({
      level: 'error',
      scope: 'test',
      ref: 'k3x9a0bq',
      digest: '2338285476',
      other: '[nombre]',
      messageHash: '0123456789abcdef',
      badHash: '[nombre]abcdef',
      toString: '[courriel]',
    });
  });

  it('passes an already scrubbed error through unchanged', () => {
    const { lines, write } = collector();
    const logger = createLogger('test', { component: 'web', release: 'dev', write });
    const error = Object.assign(new Error('boom'), { digest: '2338285476' });
    const scrubbed = scrubError(error);
    logger.error('failed', { error: scrubbed });
    expect(lines[0]!.entry.error).toEqual(JSON.parse(JSON.stringify(scrubbed)));
  });

  it('bounds deep and long structures', () => {
    const { lines, write } = collector();
    const logger = createLogger('test', { component: 'web', release: 'dev', write });
    logger.info('deep', {
      a: { b: { c: { d: { e: { f: 'too deep' } } } } },
      many: Array.from({ length: 80 }, (_, i) => i),
    });
    expect(JSON.stringify(lines[0]!.entry.a)).toBe('{"b":{"c":{"d":{"e":"[…]"}}}}');
    expect(lines[0]!.entry.many).toHaveLength(50);
  });

  it('never throws', () => {
    const logger = createLogger('test', {
      component: 'web',
      release: 'dev',
      write: () => {
        throw new Error('disk full');
      },
    });
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => logger.error('x', { circular })).not.toThrow();
  });

  it('writes errors to stderr and the rest to stdout by default', () => {
    const out = vi.spyOn(originalConsole, 'log').mockImplementation(() => undefined);
    const err = vi.spyOn(originalConsole, 'error').mockImplementation(() => undefined);
    try {
      const logger = createLogger('test', { component: 'web', release: 'dev' });
      logger.info('to stdout');
      logger.warn('to stdout too');
      logger.error('to stderr');
      expect(out.mock.calls.map(([line]) => JSON.parse(String(line)).message)).toEqual([
        'to stdout',
        'to stdout too',
      ]);
      expect(err.mock.calls.map(([line]) => JSON.parse(String(line)).message)).toEqual([
        'to stderr',
      ]);
    } finally {
      out.mockRestore();
      err.mockRestore();
    }
  });
});

describe('guardConsole', () => {
  const saved = { ...console };
  afterEach(() => {
    Object.assign(console, saved);
    delete (console as unknown as Record<symbol, unknown>)[
      Symbol.for('lynx.observability.guarded')
    ];
  });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 40));

  class PrivacyViolation extends Error {
    constructor(readonly findings: { kind: string; match: string }[]) {
      super('refusing to send personal information (name)');
      this.name = 'PrivacyViolation';
    }
  }

  it("turns console output into scrubbed lines and never shows an error's properties", async () => {
    const { lines, write } = collector();
    guardConsole(createLogger('console', { component: 'web', release: 'dev', write }), {
      holdMs: 10,
    });
    // How Next prints a failed request: a coloured prefix, then the error.
    console.error('\u001B[31m⨯\u001B[39m', new PrivacyViolation([{ kind: 'name', match: 'Léa' }]));
    console.warn('could not reach lea.parent@courriel.ca', { name: 'Léa' });
    console.log('✓ Ready in 120ms');
    console.error('plain text about K1A 0B1');
    await settle();
    for (const sentinel of SENTINELS) {
      expect(lines.map((l) => l.raw).join()).not.toContain(sentinel);
    }
    expect(lines.map((l) => [l.level, l.entry.message])).toEqual([
      ['warn', 'could not reach [courriel]'],
      ['info', '✓ Ready in 120ms'],
      ['error', 'plain text about [code postal]'],
      ['error', '⨯'],
    ]);
    expect(lines[3]!.entry.error).toMatchObject({ name: 'PrivacyViolation' });
  });

  it('drops the copy of an error a request handler logged, before or after it', async () => {
    const { lines, write } = collector();
    guardConsole(createLogger('console', { component: 'web', release: 'dev', write }), {
      holdMs: 10,
    });
    const before = new Error('logged before it was printed');
    markLogged(before);
    console.error('⨯', before);
    // Next 16 prints first, then calls onRequestError.
    const after = new Error('logged right after it was printed');
    console.error('⨯', after);
    await Promise.resolve();
    markLogged(after);
    console.error('⨯', new Error('nobody logged this one'));
    await settle();
    expect(lines).toHaveLength(1);
    expect(lines[0]!.entry.error).toMatchObject({ message: 'nobody logged this one' });
  });

  it('is installed once', () => {
    const first = collector();
    const second = collector();
    guardConsole(createLogger('console', { component: 'web', release: 'dev', write: first.write }));
    guardConsole(
      createLogger('console', { component: 'web', release: 'dev', write: second.write }),
    );
    console.info('hello');
    expect(first.lines).toHaveLength(1);
    expect(second.lines).toHaveLength(0);
  });
});

describe('graphileLogger', () => {
  it("scrubs graphile-worker's messages and keeps only the error of its metadata", () => {
    const { lines, write } = collector();
    const factory = graphileLogger(
      createLogger('graphile', { component: 'worker', release: 'dev', write }),
    );
    const log = factory({
      label: 'worker',
      taskIdentifier: 'ai_run_job',
      jobId: '42',
      workerId: 'w1',
    });
    const error = Object.assign(new Error('Key (email)=(lea.parent@courriel.ca) already exists'), {
      findings: [{ kind: 'name', match: 'Léa' }],
    });
    log(
      'error',
      `Failed task 42 (ai_run_job, 3.00ms, attempt 1 of 25) with error '${error.message}':\n  at x (/srv/apps/worker/src/ai.ts:1:1)`,
      { failure: true, job: { payload: { name: 'Léa' } }, error, duration: 3 },
    );
    log('warning', 'slow job for "Léa"');
    log('info', 'Worker connected and looking for jobs...');
    log('debug', 'Léa debug detail');
    for (const sentinel of SENTINELS)
      expect(lines.map((l) => l.raw).join()).not.toContain(sentinel);
    expect(lines.map((l) => l.level)).toEqual(['error', 'warn', 'info']);
    expect(lines[0]!.entry).toMatchObject({
      message: "Failed task 42 (ai_run_job, 3.00ms, attempt 1 of 25) with error '…':",
      label: 'worker',
      task: 'ai_run_job',
      jobId: '42',
      workerId: 'w1',
      error: { name: 'Error', message: 'Key (email)=(…) already exists' },
    });
    expect(lines[0]!.entry).not.toHaveProperty('job');
    expect(lines[1]!.entry.message).toBe('slow job for "…"');
  });
});
