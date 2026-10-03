/**
 * The Anthropic provider's batches (DECISIONS D-098, test A4), against a stand-in for the API:
 * every test swaps `fetch`, so nothing leaves the machine. What is sent (custom ids, the output
 * schema, effort, max_tokens, the cached system prompt) and how each kind of result is read.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createAnthropicProvider } from './providers';
import { AiProviderError, type BatchItem, type BatchItemResult } from './types';

interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'request-id': 'req_test' },
  });

const notFound = () =>
  json({ type: 'error', error: { type: 'not_found_error', message: 'gone' } }, 404);

const BATCH = {
  id: 'msgbatch_1',
  type: 'message_batch',
  processing_status: 'in_progress',
  request_counts: { processing: 1, succeeded: 0, errored: 0, canceled: 0, expired: 0 },
  created_at: '2026-11-03T12:00:00Z',
  expires_at: '2026-11-04T12:00:00Z',
  ended_at: null,
  archived_at: null,
  cancel_initiated_at: null,
  results_url: null,
};

const message = (text: string, stopReason = 'end_turn') => ({
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-opus-5-5',
  content: [{ type: 'text', text }],
  stop_reason: stopReason,
  stop_sequence: null,
  usage: {
    input_tokens: 1200,
    output_tokens: 800,
    cache_read_input_tokens: 3000,
    cache_creation_input_tokens: 40,
  },
});

const ids = Array.from({ length: 8 }, (_, i) => `00000000-0000-4000-8000-00000000000${i}`);

const RESULT_LINES = [
  { custom_id: ids[0], result: { type: 'succeeded', message: message('{"answer": "oui"}') } },
  {
    custom_id: ids[1],
    result: {
      type: 'errored',
      error: {
        type: 'error',
        request_id: 'req_bad',
        error: { type: 'invalid_request_error', message: 'schema too large' },
      },
    },
  },
  {
    custom_id: ids[2],
    result: {
      type: 'errored',
      error: { type: 'error', request_id: null, error: { type: 'api_error', message: 'x' } },
    },
  },
  { custom_id: ids[3], result: { type: 'expired' } },
  { custom_id: ids[4], result: { type: 'succeeded', message: message('{"answer": 3}') } },
  { custom_id: ids[5], result: { type: 'succeeded', message: message('', 'refusal') } },
  { custom_id: ids[6], result: { type: 'canceled' } },
  // A request this run does not know (never read).
  {
    custom_id: 'someone-else',
    result: { type: 'succeeded', message: message('{"answer": "non"}') },
  },
  {
    custom_id: ids[7],
    result: { type: 'succeeded', message: message('{"answer": "oui', 'max_tokens') },
  },
];

function mockApi(overrides: Partial<Record<string, () => Response>> = {}) {
  const calls: Call[] = [];
  const fetch = async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = (init.method ?? 'GET').toUpperCase();
    const key = `${method} ${url.pathname}`;
    calls.push({
      method,
      path: url.pathname,
      body: init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
    });
    const override = overrides[key];
    if (override) return override();
    switch (key) {
      case 'POST /v1/messages/count_tokens':
        return json({ input_tokens: 4321 });
      case 'POST /v1/messages/batches':
        return json(BATCH);
      case 'GET /v1/messages/batches/msgbatch_1':
        return json({
          ...BATCH,
          processing_status: 'ended',
          results_url: 'https://api.anthropic.com/v1/messages/batches/msgbatch_1/results',
        });
      case 'GET /v1/messages/batches/msgbatch_1/results':
        return new Response(RESULT_LINES.map((l) => JSON.stringify(l)).join('\n') + '\n', {
          headers: { 'content-type': 'application/binary' },
        });
      case 'POST /v1/messages/batches/msgbatch_1/cancel':
        return json({ ...BATCH, processing_status: 'canceling' });
      case 'DELETE /v1/messages/batches/msgbatch_1':
        return json({ id: 'msgbatch_1', type: 'message_batch_deleted' });
      default:
        return notFound();
    }
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

const schema = z.object({ answer: z.string() });
const item = (customId: string): BatchItem => ({
  customId,
  system: 'Système de la ressource.',
  user: 'Type de ressource : Jeu-questionnaire',
  schema,
  maxTokens: 64_000,
  fake: () => ({ answer: 'oui' }),
});

function provider(api: ReturnType<typeof mockApi>, model = 'claude-opus-5-5') {
  return createAnthropicProvider({
    apiKey: 'sk-test-key-000000000000',
    model,
    effort: 'medium',
    fetch: api.fetch,
  });
}

describe('the Anthropic batch provider', () => {
  it('counts input tokens with the same system, message and output format', async () => {
    const api = mockApi();
    const count = await provider(api).batch!.countInputTokens(item(ids[0]!));
    expect(count).toBe(4321);
    expect(api.calls).toHaveLength(1);
    const body = api.calls[0]!.body!;
    expect(body).toMatchObject({
      model: 'claude-opus-5-5',
      system: [
        { type: 'text', text: 'Système de la ressource.', cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: 'Type de ressource : Jeu-questionnaire' }],
      output_config: { effort: 'medium', format: { type: 'json_schema' } },
    });
    expect(JSON.stringify(body)).toContain('"answer"');
    expect(body).not.toHaveProperty('max_tokens');
  });

  it('submits one batch: custom ids, max_tokens, effort and the JSON schema of each request', async () => {
    const api = mockApi();
    const { batchId } = await provider(api).batch!.submit([item(ids[0]!), item(ids[1]!)]);
    expect(batchId).toBe('msgbatch_1');
    expect(api.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /v1/messages/batches']);
    const requests = api.calls[0]!.body!.requests as {
      custom_id: string;
      params: Record<string, unknown>;
    }[];
    expect(requests.map((r) => r.custom_id)).toEqual([ids[0], ids[1]]);
    for (const r of requests) {
      expect(r.params).toMatchObject({
        model: 'claude-opus-5-5',
        max_tokens: 64_000,
        system: [{ type: 'text', cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user' }],
        output_config: {
          effort: 'medium',
          format: { type: 'json_schema', schema: { type: 'object' } },
        },
      });
    }
  });

  it('never sends a batch twice: a failed creation is not retried', async () => {
    const api = mockApi({
      'POST /v1/messages/batches': () =>
        json({ type: 'error', error: { type: 'api_error', message: 'x' } }, 500),
    });
    const error = await provider(api)
      .batch!.submit([item(ids[0]!)])
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiProviderError);
    expect((error as AiProviderError).code).toBe('aiUnavailable');
    expect(api.calls).toHaveLength(1);
  });

  it('sends no effort to a model that does not take one', async () => {
    const api = mockApi();
    await provider(api, 'claude-haiku-4-5').batch!.submit([item(ids[0]!)]);
    const [request] = api.calls[0]!.body!.requests as { params: { output_config: object } }[];
    expect(request!.params.output_config).not.toHaveProperty('effort');
  });

  it('reports the batch state', async () => {
    const api = mockApi();
    expect(await provider(api).batch!.status('msgbatch_1')).toEqual({ state: 'ended' });
  });

  it('reads every kind of result, for the pending requests only', async () => {
    const api = mockApi();
    const pending = new Map(ids.map((id) => [id, item(id)]));
    const results: BatchItemResult[] = [];
    for await (const r of provider(api).batch!.results('msgbatch_1', pending)) results.push(r);
    const byId = new Map(results.map((r) => [r.customId, r]));
    expect(results).toHaveLength(8);
    expect(byId.has('someone-else')).toBe(false);
    expect(byId.get(ids[0]!)).toEqual({
      customId: ids[0],
      output: { answer: 'oui' },
      stopReason: 'end_turn',
      model: 'claude-opus-5-5',
      requestId: 'msg_1',
      usage: { inputTokens: 1200, outputTokens: 800, cacheReadTokens: 3000, cacheWriteTokens: 40 },
    });
    expect(ids.map((id) => [byId.get(id)!.output === null, byId.get(id)!.stopReason])).toEqual([
      [false, 'end_turn'],
      [true, 'batch_invalid_request'],
      [true, 'batch_server_error'],
      [true, 'batch_expired'],
      [true, 'invalid_schema'],
      [true, 'refusal'],
      [true, 'batch_canceled'],
      [true, 'max_tokens'],
    ]);
    // A request the API refused keeps its request id (support), and costs nothing.
    expect(byId.get(ids[1]!)).toMatchObject({ requestId: 'req_bad', usage: { outputTokens: 0 } });
    // A refused or cut-off answer is billed: its usage is kept.
    expect(byId.get(ids[5]!)!.usage.outputTokens).toBe(800);
  });

  it('cancels and deletes batches, and a batch already gone is not an error', async () => {
    const api = mockApi();
    const batch = provider(api).batch!;
    await batch.cancel('msgbatch_1');
    await batch.remove('msgbatch_1');
    await expect(batch.cancel('msgbatch_gone')).resolves.toBeUndefined();
    await expect(batch.remove('msgbatch_gone')).resolves.toBeUndefined();
    expect(api.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /v1/messages/batches/msgbatch_1/cancel',
      'DELETE /v1/messages/batches/msgbatch_1',
      'POST /v1/messages/batches/msgbatch_gone/cancel',
      'DELETE /v1/messages/batches/msgbatch_gone',
    ]);
  });

  it('turns a rejected key into aiConfig', async () => {
    const api = mockApi({
      'GET /v1/messages/batches/msgbatch_1': () =>
        json({ type: 'error', error: { type: 'authentication_error', message: 'x' } }, 401),
    });
    const error = await provider(api)
      .batch!.status('msgbatch_1')
      .catch((e: unknown) => e);
    expect((error as AiProviderError).code).toBe('aiConfig');
  });
});
