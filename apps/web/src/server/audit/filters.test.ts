import { describe, expect, it } from 'vitest';
import {
  auditCategoriesFor,
  auditFilterCount,
  auditHref,
  auditRpcFilters,
  parseAuditFilters,
  pickAuditScope,
  recentAlertFilters,
  toAuditSearchParams,
  type AuditScopes,
} from './filters';

const SCHOOL = 'c0000000-0000-4000-8000-000000000001';
const OTHER_SCHOOL = 'c0000000-0000-4000-8000-000000000002';
const BOARD = 'b0000000-0000-4000-8000-000000000001';
const OTHER_BOARD = 'b0000000-0000-4000-8000-000000000002';
const PERSON = 'd0000000-0000-4000-8000-000000000005';

const principal: AuditScopes = {
  schools: [{ id: SCHOOL, name: 'Saint-Exemple', boardId: BOARD, timezone: 'America/Toronto' }],
  boards: [],
};
const boardAdmin: AuditScopes = {
  schools: [],
  boards: [
    {
      id: BOARD,
      name: 'CSC Démo',
      timezone: 'America/Toronto',
      schools: [
        { id: SCHOOL, name: 'Saint-Exemple' },
        { id: OTHER_SCHOOL, name: 'Sainte-Marie' },
      ],
    },
  ],
};
const both: AuditScopes = { schools: principal.schools, boards: boardAdmin.boards };

// 2026-10-02 10:00 in Toronto.
const NOW = new Date('2026-10-02T14:00:00Z');

describe('the audit scope (D-103)', () => {
  it('is the school the person directs, by default and when asked', () => {
    expect(pickAuditScope({}, principal)).toEqual({ kind: 'school', schoolId: SCHOOL });
    expect(pickAuditScope({ school: SCHOOL.toUpperCase() }, principal)).toEqual({
      kind: 'school',
      schoolId: SCHOOL,
    });
  });

  it('is the board for a board admin, narrowed to one of its schools when asked', () => {
    expect(pickAuditScope({}, boardAdmin)).toEqual({
      kind: 'board',
      boardId: BOARD,
      schoolId: null,
    });
    expect(pickAuditScope({ board: BOARD, school: OTHER_SCHOOL }, boardAdmin)).toEqual({
      kind: 'board',
      boardId: BOARD,
      schoolId: OTHER_SCHOOL,
    });
    // A school of the board without `board`: still the board's view of it.
    expect(pickAuditScope({ school: OTHER_SCHOOL }, boardAdmin)).toEqual({
      kind: 'board',
      boardId: BOARD,
      schoolId: OTHER_SCHOOL,
    });
  });

  it('never takes a school or a board the person may not read', () => {
    expect(pickAuditScope({ school: OTHER_SCHOOL }, principal)).toEqual({
      kind: 'school',
      schoolId: SCHOOL,
    });
    expect(pickAuditScope({ board: OTHER_BOARD }, boardAdmin)).toEqual({
      kind: 'board',
      boardId: BOARD,
      schoolId: null,
    });
    expect(pickAuditScope({ board: BOARD }, principal)).toEqual({
      kind: 'school',
      schoolId: SCHOOL,
    });
    expect(pickAuditScope({ board: BOARD, school: 'not-an-id' }, boardAdmin)).toEqual({
      kind: 'board',
      boardId: BOARD,
      schoolId: null,
    });
    expect(pickAuditScope({}, { schools: [], boards: [] })).toBeNull();
    expect(parseAuditFilters({}, { schools: [], boards: [] }, NOW)).toBeNull();
  });

  it('lets a person who directs a school and administers its board choose either', () => {
    expect(pickAuditScope({}, both)).toEqual({ kind: 'school', schoolId: SCHOOL });
    expect(pickAuditScope({ board: BOARD }, both)).toEqual({
      kind: 'board',
      boardId: BOARD,
      schoolId: null,
    });
  });
});

describe('parseAuditFilters', () => {
  it('defaults to the last 30 days on the school’s clock', () => {
    expect(parseAuditFilters({}, principal, NOW)).toEqual({
      scope: { kind: 'school', schoolId: SCHOOL },
      from: '2026-09-03',
      to: '2026-10-02',
      category: null,
      actor: null,
      type: null,
      entity: null,
      before: null,
    });
    // 23:30 on October 2 in Toronto is already October 3 in UTC.
    expect(parseAuditFilters({}, principal, new Date('2026-10-03T03:30:00Z'))?.to).toBe(
      '2026-10-02',
    );
  });

  it('reads every filter', () => {
    const filters = parseAuditFilters(
      new URLSearchParams({
        school: SCHOOL,
        from: '2026-09-01',
        to: '2026-09-30',
        category: 'alerts',
        actor: PERSON,
        type: 'substitute',
        entity: SCHOOL,
        before: '1234',
      }),
      principal,
      NOW,
    );
    expect(filters).toEqual({
      scope: { kind: 'school', schoolId: SCHOOL },
      from: '2026-09-01',
      to: '2026-09-30',
      category: 'alerts',
      actor: PERSON,
      type: 'substitute',
      entity: SCHOOL,
      before: 1234,
    });
  });

  it('drops what is not valid', () => {
    const filters = parseAuditFilters(
      {
        from: '2026-02-30',
        to: 'yesterday',
        category: 'grades',
        actor: 'sophie@example.ca',
        type: 'robot',
        entity: '42',
        before: '-1',
      },
      principal,
      NOW,
    );
    expect(filters).toMatchObject({
      from: '2026-09-03',
      to: '2026-10-02',
      category: null,
      actor: null,
      type: null,
      entity: null,
      before: null,
    });
    expect(parseAuditFilters({ before: '0' }, principal, NOW)?.before).toBeNull();
    expect(parseAuditFilters({ before: '1e3' }, principal, NOW)?.before).toBeNull();
    // Repeated parameters: the first one.
    expect(parseAuditFilters({ category: ['access', 'alerts'] }, principal, NOW)?.category).toBe(
      'access',
    );
  });

  it('keeps the period in order, no later than today and at most 365 days long', () => {
    expect(parseAuditFilters({ to: '2027-01-01' }, principal, NOW)).toMatchObject({
      from: '2026-09-03',
      to: '2026-10-02',
    });
    expect(
      parseAuditFilters({ from: '2026-09-20', to: '2026-09-10' }, principal, NOW),
    ).toMatchObject({ from: '2026-09-10', to: '2026-09-10' });
    expect(parseAuditFilters({ from: '2020-01-01' }, principal, NOW)).toMatchObject({
      from: '2025-10-03',
      to: '2026-10-02',
    });
    expect(parseAuditFilters({ from: '2025-10-03' }, principal, NOW)).toMatchObject({
      from: '2025-10-03',
      to: '2026-10-02',
    });
    // `to` alone: the 30 days before it.
    expect(parseAuditFilters({ to: '2026-06-30' }, principal, NOW)).toMatchObject({
      from: '2026-06-01',
      to: '2026-06-30',
    });
  });
});

describe('links and the database’s filters', () => {
  const filters = parseAuditFilters(
    { board: BOARD, school: SCHOOL, category: 'access', type: 'user', before: '99' },
    boardAdmin,
    NOW,
  )!;

  it('round-trips through the address', () => {
    const params = toAuditSearchParams(filters);
    expect(params.toString()).toBe(
      `board=${BOARD}&school=${SCHOOL}&from=2026-09-03&to=2026-10-02&category=access&type=user&before=99`,
    );
    expect(parseAuditFilters(params, boardAdmin, NOW)).toEqual(filters);
  });

  it('starts paging again when a filter changes, unless asked to page', () => {
    expect(auditHref(filters, { category: 'library' })).toBe(
      `/audit?board=${BOARD}&school=${SCHOOL}&from=2026-09-03&to=2026-10-02&category=library&type=user`,
    );
    expect(auditHref(filters, { before: 42 })).toContain('&before=42');
    expect(auditHref(filters, {}, '/audit/export')).toMatch(/^\/audit\/export\?board=/);
  });

  it('gives the database the period as local midnights it turns into instants (D-009)', () => {
    expect(auditRpcFilters(filters, boardAdmin)).toEqual({
      boardId: BOARD,
      schoolId: SCHOOL,
      from: '2026-09-03 00:00:00 America/Toronto',
      to: '2026-10-03 00:00:00 America/Toronto',
      category: 'access',
      actorType: 'user',
    });
    const school = parseAuditFilters({ actor: PERSON, entity: SCHOOL }, principal, NOW)!;
    expect(auditRpcFilters(school, principal)).toEqual({
      schoolId: SCHOOL,
      from: '2026-09-03 00:00:00 America/Toronto',
      to: '2026-10-03 00:00:00 America/Toronto',
      actorUserId: PERSON,
      entityId: SCHOOL,
    });
    expect(recentAlertFilters(SCHOOL, '2026-09-26', 'America/Toronto')).toEqual({
      schoolId: SCHOOL,
      category: 'alerts',
      from: '2026-09-26 00:00:00 America/Toronto',
    });
  });

  it('counts the filters set besides the scope', () => {
    expect(auditFilterCount(parseAuditFilters({}, principal, NOW)!, '2026-10-02')).toBe(0);
    expect(auditFilterCount(filters, '2026-10-02')).toBe(2);
    expect(
      auditFilterCount(parseAuditFilters({ from: '2026-09-01' }, principal, NOW)!, '2026-10-02'),
    ).toBe(1);
  });
});

describe('the categories offered', () => {
  it('are the direction’s at a school and the board’s for a board', () => {
    expect(auditCategoriesFor({ kind: 'school', schoolId: SCHOOL }, principal)).toEqual([
      'alerts',
      'substitute',
      'access',
      'settings',
      'classes',
      'audit',
    ]);
    expect(
      auditCategoriesFor({ kind: 'board', boardId: BOARD, schoolId: null }, boardAdmin),
    ).toEqual(['alerts', 'access', 'settings', 'library', 'audit', 'system']);
  });

  it('are both when the person directs a school of the board they administer', () => {
    expect(auditCategoriesFor({ kind: 'school', schoolId: SCHOOL }, both)).toHaveLength(8);
    expect(
      auditCategoriesFor({ kind: 'board', boardId: BOARD, schoolId: null }, both),
    ).toHaveLength(8);
  });
});
