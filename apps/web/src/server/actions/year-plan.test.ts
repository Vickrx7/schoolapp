/**
 * « Mon année »'s actions (DECISIONS D-123, D-126): « Enregistrer ces dates » keeps the unit's
 * title, description and attentes and saves only the weeks shown; « Commencer l'unité » starts a
 * unit of the class, finishing the current one only when asked. The database's checks (row level
 * security, LXY01) decide in the end; these tests check what the actions send.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireSession = vi.fn();
const createClient = vi.fn();

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next-intl/server', () => ({ getLocale: vi.fn(async () => 'fr-CA') }));
vi.mock('../session', () => ({ requireSession: () => requireSession() }));
vi.mock('../supabase', () => ({ createSupabaseServerClient: () => createClient() }));
vi.mock('../queries/classes', () => ({ loadClass: vi.fn(async () => null) }));
vi.mock('../queries/year-plan', () => ({ loadExpectationChoices: vi.fn(async () => []) }));

const { saveUnitDates, startPlannedUnit } = await import('./year-plan');

const CLASS = 'e0000000-0000-4000-8000-000000000003';
const UNIT = '30000000-0000-4000-8000-000000000301';
const SUBJECT = '40000000-0000-4000-8000-000000000001';
const EXPECTATION = '20000000-0000-4000-8000-000000030c11';

/** A database client whose `units` read returns `unit`, recording the filters and the RPCs. */
function client(unit: Record<string, unknown> | null, rpcError: { code: string } | null = null) {
  const filters: [string, unknown][] = [];
  const rpc = vi.fn(async () => ({ data: UNIT, error: rpcError }));
  const query = {
    select: () => query,
    eq: (column: string, value: unknown) => {
      filters.push([column, value]);
      return query;
    },
    maybeSingle: async () => ({ data: unit, error: null }),
  };
  createClient.mockResolvedValue({ from: () => query, rpc });
  return { filters, rpc };
}

beforeEach(() => {
  requireSession.mockReset();
  requireSession.mockResolvedValue({ userId: 'u' });
  createClient.mockReset();
});

describe('saveUnitDates (« Enregistrer ces dates »)', () => {
  it('saves the weeks and keeps the unit as it is', async () => {
    const { filters, rpc } = client({
      subject_id: SUBJECT,
      title: 'Les nombres',
      description: 'Valeur de position.',
      unit_expectations: [{ expectation_id: EXPECTATION }],
    });
    expect(
      await saveUnitDates(CLASS, UNIT, { startsOn: '2026-09-14', endsOn: '2026-10-09' }),
    ).toEqual({ ok: true, data: undefined });
    // The unit is read in its class only.
    expect(filters).toEqual([
      ['id', UNIT],
      ['class_id', CLASS],
    ]);
    expect(rpc).toHaveBeenCalledWith('save_unit_plan', {
      p_unit_id: UNIT,
      p_class_id: CLASS,
      p_subject_id: SUBJECT,
      p_title: 'Les nombres',
      p_description: 'Valeur de position.',
      p_starts_on: '2026-09-14',
      p_ends_on: '2026-10-09',
      p_expectation_ids: [EXPECTATION],
    });
  });

  it('refuses dates that are not a window, before reading anything', async () => {
    for (const window of [
      { startsOn: '2026-10-09', endsOn: '2026-09-14' },
      { startsOn: '2026-09-14', endsOn: 'demain' },
      null,
    ]) {
      expect(await saveUnitDates(CLASS, UNIT, window as never)).toEqual({
        ok: false,
        error: 'invalid',
      });
    }
    expect(
      await saveUnitDates('pas-une-classe', UNIT, { startsOn: '2026-09-14', endsOn: '2026-09-18' }),
    ).toEqual({ ok: false, error: 'invalid' });
    expect(createClient).not.toHaveBeenCalled();
  });

  it('says « introuvable » for a unit of another class, and maps LXY01', async () => {
    const { rpc } = client(null);
    expect(
      await saveUnitDates(CLASS, UNIT, { startsOn: '2026-09-14', endsOn: '2026-09-18' }),
    ).toEqual({ ok: false, error: 'notFound' });
    expect(rpc).not.toHaveBeenCalled();
    client(
      { subject_id: SUBJECT, title: 'Les nombres', description: null, unit_expectations: [] },
      { code: 'LXY01' },
    );
    expect(
      await saveUnitDates(CLASS, UNIT, { startsOn: '2026-07-06', endsOn: '2026-07-10' }),
    ).toEqual({ ok: false, error: 'yearPlanWindow' });
  });
});

describe('startPlannedUnit (« Commencer l’unité »)', () => {
  it('starts a unit of the class, finishing the current one only when asked', async () => {
    const { filters, rpc } = client({ id: UNIT });
    expect(await startPlannedUnit(CLASS, UNIT, false)).toEqual({ ok: true, data: undefined });
    expect(filters).toEqual([
      ['id', UNIT],
      ['class_id', CLASS],
    ]);
    expect(rpc).toHaveBeenLastCalledWith('start_unit', {
      p_unit_id: UNIT,
      p_finish_current: false,
    });
    await startPlannedUnit(CLASS, UNIT, true);
    expect(rpc).toHaveBeenLastCalledWith('start_unit', {
      p_unit_id: UNIT,
      p_finish_current: true,
    });
  });

  it('refuses a unit of another class and anything but a yes or no', async () => {
    const { rpc } = client(null);
    expect(await startPlannedUnit(CLASS, UNIT, false)).toEqual({ ok: false, error: 'notFound' });
    expect(await startPlannedUnit(CLASS, UNIT, 'oui' as never)).toEqual({
      ok: false,
      error: 'invalid',
    });
    expect(await startPlannedUnit(CLASS, 'pas-une-unite', true)).toEqual({
      ok: false,
      error: 'invalid',
    });
    expect(rpc).not.toHaveBeenCalled();
  });
});
