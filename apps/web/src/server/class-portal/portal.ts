import 'server-only';
import { createHash } from 'node:crypto';
import type { GateResult } from './gate';
import { goneTokens, portalQuery } from './db';
import {
  answerResultSchema,
  deviceStateSchema,
  joinRowSchema,
  teamResultSchema,
  type AnswerResult,
  type ClassAnswer,
  type ClassTeamKey,
  type DeviceState,
  type JoinRow,
  type TeamResult,
} from './schemas';

/**
 * Typed wrappers around the five class_portal functions
 * (supabase/migrations/20261101090000_class_mode.sql, DECISIONS D-083 to D-088). Their results are
 * not in the generated types (class_portal is not an API schema), so they are parsed here with
 * `schemas.ts`, whose objects strip every key they do not list: whatever the database returned,
 * a device gets only its own view. Tokens, codes, keys and answers are never logged.
 *
 * A token the database called gone is remembered for a minute (as its SHA-256), so a device
 * polling with a dead token, or a flood of random tokens, stops at the web server.
 */

const tokenHash = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');

const GONE = { status: 'gone' } as const;

function remember<T extends { status: string }>(token: string, value: T): T {
  if (value.status === 'gone') goneTokens().add(tokenHash(token));
  return value;
}

const mapOk = <T, U>(result: GateResult<T>, map: (value: T) => U): GateResult<U> =>
  result.status === 'ok' ? { status: 'ok', value: map(result.value) } : result;

/** « Rejoindre »: exactly one of a typed code (normalized) or a class link token. */
export async function joinClassSession(input: {
  code: string | null;
  link: string | null;
  deviceKey: string;
  networkKey: string;
}): Promise<GateResult<JoinRow>> {
  const result = await portalQuery(
    'select outcome, token, expires_at, retry_after from class_portal.join($1, $2, $3, $4)',
    [input.code, input.link, input.deviceKey, input.networkKey],
  );
  return mapOk(result, (rows) => joinRowSchema.parse(rows[0]));
}

/** The device's poll; `unchanged` when the version it shows is current. */
export async function loadDeviceState(
  token: string,
  knownVersion: number | null,
): Promise<GateResult<DeviceState>> {
  if (goneTokens().has(tokenHash(token))) return { status: 'ok', value: GONE };
  const result = await portalQuery<{ state: unknown }>(
    'select class_portal.state($1, $2::integer) as state',
    [token, knownVersion],
  );
  return mapOk(result, (rows) => remember(token, deviceStateSchema.parse(rows[0]?.state)));
}

/** One answer to the question at `index` (the database grades it and keeps no typed text). */
export async function submitAnswer(
  token: string,
  index: number,
  response: ClassAnswer,
): Promise<GateResult<AnswerResult>> {
  if (goneTokens().has(tokenHash(token))) return { status: 'ok', value: GONE };
  const result = await portalQuery<{ result: unknown }>(
    'select class_portal.answer($1, $2::smallint, $3::jsonb) as result',
    [token, index, JSON.stringify(response)],
  );
  return mapOk(result, (rows) => remember(token, answerResultSchema.parse(rows[0]?.result)));
}

/** « Choisis ton équipe ». */
export async function chooseTeam(
  token: string,
  team: ClassTeamKey,
): Promise<GateResult<TeamResult>> {
  if (goneTokens().has(tokenHash(token))) return { status: 'ok', value: GONE };
  const result = await portalQuery<{ result: unknown }>(
    'select class_portal.set_team($1, $2) as result',
    [token, team],
  );
  return mapOk(result, (rows) => {
    const parsed = teamResultSchema.parse(rows[0]?.result);
    if ('status' in parsed && parsed.status === 'gone') goneTokens().add(tokenHash(token));
    return parsed;
  });
}

/** « Quitter la partie »: the token stops working; the device's answers stay until the end. */
export async function leaveSession(token: string): Promise<GateResult<null>> {
  const result = await portalQuery('select class_portal.leave($1)', [token]);
  if (result.status === 'ok') goneTokens().add(tokenHash(token));
  return mapOk(result, () => null);
}
