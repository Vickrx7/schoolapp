import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { differentiateFeature, type DifferentiateInput } from './features/differentiate';
import { priceFor } from './pricing';
import { createAnthropicProvider, type AnthropicProviderOptions } from './providers';
import { runFeature } from './run';
import { AiProviderError, type ProviderRequest } from './types';

// The Anthropic provider against a stand-in for the API: every test swaps `fetch`, so nothing
// leaves the machine. Answers are streamed as server-sent events, like the real API.

interface Call {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}
type Reply = (init: RequestInit) => Response | Promise<Response>;

function mockApi(...replies: Reply[]) {
  const calls: Call[] = [];
  const fetch = async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({
      url: String(url),
      headers: new Headers(init.headers),
      body: JSON.parse(String(init.body)) as Record<string, unknown>,
    });
    // The last reply repeats (for retries).
    return replies[Math.min(calls.length, replies.length) - 1]!(init);
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

const USAGE = {
  input_tokens: 1200,
  output_tokens: 1,
  cache_read_input_tokens: 300,
  cache_creation_input_tokens: 40,
};

function sse(events: object[]): string {
  return events
    .map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`)
    .join('');
}

function opening(text: string): object[] {
  return [
    {
      type: 'message_start',
      message: {
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-5-5',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: USAGE,
      },
    },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
  ];
}

/** A complete streamed answer. */
function answer(text: string, stopReason = 'end_turn'): Reply {
  return () =>
    new Response(
      sse([
        ...opening(text),
        { type: 'content_block_stop', index: 0 },
        {
          type: 'message_delta',
          delta: { stop_reason: stopReason, stop_sequence: null },
          usage: { output_tokens: 800 },
        },
        { type: 'message_stop' },
      ]),
      { headers: { 'content-type': 'text/event-stream', 'request-id': 'req_ok' } },
    );
}

/** An answer that starts, then an error arrives inside the stream. */
function brokenStream(errorType: string): Reply {
  return () =>
    new Response(
      sse(opening('{"answer": "par')) +
        `event: error\ndata: ${JSON.stringify({ type: 'error', error: { type: errorType, message: 'x' } })}\n\n`,
      { headers: { 'content-type': 'text/event-stream', 'request-id': 'req_broken' } },
    );
}

/** An answer that starts with `events`, then never finishes (until the call is aborted). */
function hanging(events: object[]): Reply {
  return (init) => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sse(events)));
        init.signal?.addEventListener('abort', () =>
          controller.error(new DOMException('aborted', 'AbortError')),
        );
      },
    });
    return new Response(body, {
      headers: { 'content-type': 'text/event-stream', 'request-id': 'req_slow' },
    });
  };
}

const hangingStream = hanging(opening('{"answer": "par'));

/** Only thinking so far: its text is not streamed (display "omitted", the default). */
const thinkingOnly: object[] = [
  opening('')[0]!,
  { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
];

/** No answer at all until the call is aborted. */
const noAnswer: Reply = (init) =>
  new Promise<never>((_, reject) =>
    init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))),
  );

function apiError(status: number, type: string): Reply {
  return () =>
    new Response(JSON.stringify({ type: 'error', error: { type, message: `${type} (test)` } }), {
      status,
      headers: {
        'content-type': 'application/json',
        'request-id': `req_${status}`,
        'retry-after-ms': '1',
      },
    });
}

const schema = z.object({ answer: z.string() });
const request: ProviderRequest<z.infer<typeof schema>> = {
  system: 'Système.',
  user: 'Élève A lit un texte.',
  schema,
  maxTokens: 64_000,
  fake: () => ({ answer: 'faux' }),
};

function provider(fetch: typeof globalThis.fetch, extra: Partial<AnthropicProviderOptions> = {}) {
  return createAnthropicProvider({
    apiKey: 'sk-test',
    model: 'claude-opus-5-5',
    effort: 'medium',
    fetch,
    ...extra,
  });
}

async function providerError(promise: Promise<unknown>): Promise<AiProviderError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AiProviderError);
  return error as AiProviderError;
}

describe('Anthropic provider: requests', () => {
  it('streams a request that carries only the prompt, the model settings and the schema', async () => {
    const api = mockApi(answer('{"answer": "oui"}'));
    const result = await provider(api.fetch).generate(request);

    expect(result).toMatchObject({ output: { answer: 'oui' }, stopReason: 'end_turn' });
    expect(api.calls).toHaveLength(1);
    const { url, body, headers } = api.calls[0]!;
    expect(url).toMatch(/\/v1\/messages$/);
    // No metadata, user, workspace or container: nothing that identifies a person or school.
    expect(Object.keys(body).sort()).toEqual([
      'max_tokens',
      'messages',
      'model',
      'output_config',
      'stream',
      'system',
    ]);
    expect(body).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: 64_000,
      stream: true,
      system: 'Système.',
      messages: [{ role: 'user', content: 'Élève A lit un texte.' }],
      output_config: { effort: 'medium', format: { type: 'json_schema' } },
    });
    expect(Object.keys(body.output_config as object).sort()).toEqual(['effort', 'format']);
    expect(headers.has('anthropic-user-profile-id')).toBe(false);
    expect(headers.has('anthropic-workspace-id')).toBe(false);
  });

  it('sends no effort level to Haiku, which does not accept one', async () => {
    const api = mockApi(answer('{"answer": "oui"}'));
    await provider(api.fetch, { model: 'claude-haiku-4-5' }).generate(request);
    expect(api.calls[0]!.body.output_config).not.toHaveProperty('effort');
  });

  it('reports usage, including cache reads and writes, and the API request id', async () => {
    const api = mockApi(answer('{"answer": "oui"}'));
    const result = await provider(api.fetch).generate(request);
    expect(result.usage).toEqual({
      inputTokens: 1200,
      outputTokens: 800,
      cacheReadTokens: 300,
      cacheWriteTokens: 40,
    });
    // The request-id header (req_…), not the message id (msg_…).
    expect(result.requestId).toBe('req_ok');
    expect(result.model).toBe('claude-opus-5-5');
  });
});

describe('Anthropic provider: answers', () => {
  it('reports a refusal and a cut-off answer without parsing them', async () => {
    for (const stopReason of ['refusal', 'max_tokens']) {
      const api = mockApi(answer('{"answer": "cou', stopReason));
      const result = await provider(api.fetch).generate(request);
      expect(result).toMatchObject({ output: null, stopReason, requestId: 'req_ok' });
      expect(result.usage.outputTokens).toBe(800);
    }
  });

  it('reports text that is not JSON and JSON that does not match the schema', async () => {
    const notJson = await provider(mockApi(answer('Voici le texte.')).fetch).generate(request);
    expect(notJson).toMatchObject({ output: null, stopReason: 'invalid_json' });
    const wrongShape = await provider(mockApi(answer('{"answer": 3}')).fetch).generate(request);
    expect(wrongShape).toMatchObject({ output: null, stopReason: 'invalid_schema' });
  });
});

describe('Anthropic provider: errors', () => {
  it('maps API errors to codes staff can act on', async () => {
    for (const [status, type, code] of [
      [401, 'authentication_error', 'aiConfig'],
      [403, 'permission_error', 'aiConfig'],
      [404, 'not_found_error', 'aiConfig'],
      [400, 'invalid_request_error', 'aiError'],
      [429, 'rate_limit_error', 'aiRateLimited'],
      [500, 'api_error', 'aiUnavailable'],
      [529, 'overloaded_error', 'aiUnavailable'],
    ] as const) {
      const api = mockApi(apiError(status, type));
      const error = await providerError(provider(api.fetch).generate(request));
      expect(error.code, `HTTP ${status}`).toBe(code);
      expect(error.requestId).toBe(`req_${status}`);
    }
  });

  it('retries 429 and 5xx before the answer starts, when nothing was generated yet', async () => {
    const api = mockApi(apiError(529, 'overloaded_error'), answer('{"answer": "oui"}'));
    const result = await provider(api.fetch).generate(request);
    expect(result.output).toEqual({ answer: 'oui' });
    expect(api.calls).toHaveLength(2);

    const failing = mockApi(apiError(500, 'api_error'));
    await providerError(provider(failing.fetch).generate(request));
    expect(failing.calls).toHaveLength(3);
  });

  it('does not retry a client error', async () => {
    const api = mockApi(apiError(400, 'invalid_request_error'));
    await providerError(provider(api.fetch).generate(request));
    expect(api.calls).toHaveLength(1);
  });

  it('keeps the usage of a stream that breaks, and does not send it again', async () => {
    const api = mockApi(brokenStream('overloaded_error'));
    const error = await providerError(provider(api.fetch).generate(request));
    expect(error.code).toBe('aiUnavailable');
    expect(error.requestId).toBe('req_broken');
    expect(error.usage).toMatchObject({ inputTokens: 1200, cacheReadTokens: 300 });
    expect(api.calls).toHaveLength(1);
  });

  it('abandons a slow answer at the deadline, keeps its usage and does not send it again', async () => {
    const api = mockApi(hangingStream);
    const error = await providerError(provider(api.fetch, { timeoutMs: 50 }).generate(request));
    expect(error.code).toBe('timeout');
    expect(error.requestId).toBe('req_slow');
    expect(error.usage).toMatchObject({ inputTokens: 1200 });
    expect(api.calls).toHaveLength(1);
  });

  it('estimates the output of an answer cut off before the API counted it', async () => {
    // The API counts output tokens only at the end (message_delta): the stream says 1 so far.
    const text = `{"answer": "${'Le castor construit un barrage. '.repeat(1000)}`;
    const api = mockApi(hanging(opening(text)));
    const error = await providerError(provider(api.fetch, { timeoutMs: 50 }).generate(request));
    expect(error.code).toBe('timeout');
    expect(error.usage!.inputTokens).toBe(1200);
    expect(error.usage!.outputTokens).toBeGreaterThanOrEqual(Math.ceil(text.length / 3));

    // No more than max_tokens.
    const capped = await providerError(
      provider(mockApi(hanging(opening(text))).fetch, { timeoutMs: 50 }).generate({
        ...request,
        maxTokens: 1000,
      }),
    );
    expect(capped.usage!.outputTokens).toBe(1000);

    // A stream that breaks mid-answer is estimated the same way.
    const broken = await providerError(
      provider(
        mockApi(
          () =>
            new Response(
              sse(opening(text)) +
                `event: error\ndata: ${JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'x' } })}\n\n`,
              { headers: { 'content-type': 'text/event-stream' } },
            ),
        ).fetch,
      ).generate(request),
    );
    expect(broken.usage!.outputTokens).toBeGreaterThanOrEqual(Math.ceil(text.length / 3));
  });

  it('counts thinking that is not shown by the time spent generating', async () => {
    const api = mockApi(hanging(thinkingOnly));
    const started = Date.now();
    const error = await providerError(provider(api.fetch, { timeoutMs: 300 }).generate(request));
    const seconds = (Date.now() - started) / 1000;
    expect(error.code).toBe('timeout');
    // About 100 tokens per second of generation: never less than the time already spent.
    expect(error.usage!.outputTokens).toBeGreaterThanOrEqual(20);
    expect(error.usage!.outputTokens).toBeLessThanOrEqual(Math.ceil(seconds * 100));
  });

  it('keeps the count the API sent before the stream broke', async () => {
    const api = mockApi(
      () =>
        new Response(
          sse([
            ...opening('{"answer": "oui"}'),
            { type: 'content_block_stop', index: 0 },
            {
              type: 'message_delta',
              delta: { stop_reason: 'end_turn', stop_sequence: null },
              usage: { output_tokens: 800 },
            },
          ]) +
            `event: error\ndata: ${JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'x' } })}\n\n`,
          { headers: { 'content-type': 'text/event-stream' } },
        ),
    );
    const error = await providerError(provider(api.fetch).generate(request));
    expect(error.usage!.outputTokens).toBe(800);
  });

  it('abandons a request that never gets an answer, without retrying it', async () => {
    const api = mockApi(noAnswer);
    const error = await providerError(provider(api.fetch, { timeoutMs: 50 }).generate(request));
    expect(error.code).toBe('timeout');
    expect(error.usage).toBeNull();
    expect(api.calls).toHaveLength(1);
  });

  it('stops when the caller’s signal fires', async () => {
    const api = mockApi(hangingStream);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);
    const error = await providerError(
      provider(api.fetch).generate({ ...request, signal: controller.signal }),
    );
    expect(error.code).toBe('timeout');
  });
});

describe('Anthropic provider through runFeature', () => {
  const NOW = new Date('2026-09-28T12:00:00Z');
  const input: DifferentiateInput = {
    title: 'Le castor de Léa',
    text: 'Léa observe un castor près de la rivière. Mme Tremblay explique le barrage.',
    objective: '',
    itemType: 'reading_passage',
    gradeCode: '3',
    gradeLabel: '3e année',
    subjectId: '33333333-3333-4333-8333-333333333333',
    subjectLabel: 'Sciences et technologie',
    levels: [
      {
        key: 'L1',
        languageLevelId: '11111111-1111-4111-8111-111111111111',
        label: 'Débutant',
        description: null,
      },
      {
        key: 'L2',
        languageLevelId: '22222222-2222-4222-8222-222222222222',
        label: 'Enrichi',
        description: null,
      },
    ],
  };
  const base = {
    feature: differentiateFeature,
    price: priceFor('claude-opus-5-5'),
    systemPrompt: 'Système.',
    input,
    people: [
      { name: 'Léa', kind: 'student' as const },
      { name: 'Isabelle Tremblay', kind: 'staff' as const },
    ],
    now: NOW,
  };
  const goodAnswer = JSON.stringify(
    differentiateFeature.fake({ ...input, title: 'Le castor', text: 'Élève A observe un castor.' }),
  );

  it('sends no names, level ids or subject id, and records the request id', async () => {
    const api = mockApi(answer(goodAnswer));
    const result = await runFeature({ ...base, provider: provider(api.fetch) });
    expect(result.status).toBe('succeeded');
    const sent = JSON.stringify(api.calls[0]!.body);
    expect(sent).not.toMatch(/Léa|L\\u00e9a|Tremblay|Isabelle/);
    expect(sent).not.toContain('11111111-1111');
    expect(sent).not.toContain('33333333-3333');
    expect(sent).toContain('Élève A observe un castor');
    expect(result.providerRequestIds).toEqual(['req_ok']);
  });

  it('makes one call for a refusal and three for answers that are not JSON', async () => {
    const refused = mockApi(answer('', 'refusal'));
    const r1 = await runFeature({ ...base, provider: provider(refused.fetch) });
    expect(r1).toMatchObject({ status: 'failed', errorCode: 'aiRefused', attempts: 1 });
    expect(refused.calls).toHaveLength(1);

    const garbled = mockApi(answer('pas du JSON'));
    const r2 = await runFeature({ ...base, provider: provider(garbled.fetch) });
    expect(r2).toMatchObject({ status: 'invalid_output', errorCode: 'invalidOutput' });
    expect(garbled.calls).toHaveLength(3);
    expect(r2.usage.inputTokens).toBe(3 * 1200);
    expect(r2.providerRequestIds).toEqual(['req_ok', 'req_ok', 'req_ok']);
  });

  it('counts a timed-out call: its usage, its cost and its request id', async () => {
    const api = mockApi(hangingStream);
    const result = await runFeature({ ...base, provider: provider(api.fetch), timeoutMs: 50 });
    expect(result).toMatchObject({ status: 'failed', errorCode: 'timeout', attempts: 1 });
    expect(result.sentText).not.toBeNull();
    expect(result.usage.inputTokens).toBe(1200);
    expect(result.usage.outputTokens).toBeGreaterThan(1);
    expect(result.costUsd).toBeGreaterThan(0);
    expect(result.providerRequestIds).toEqual(['req_slow']);
    expect(api.calls).toHaveLength(1);
  });
});
