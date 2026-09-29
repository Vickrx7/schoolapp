import { describe, expect, it, vi } from 'vitest';
import fr from '../../messages/fr-CA.json';

// errors.ts is server-only; the marker package throws outside a React server bundle.
vi.mock('server-only', () => ({}));
const { errorKey } = await import('./errors');

describe('database errors shown to users', () => {
  it('maps the substitute hand-off codes to their messages', () => {
    expect(errorKey({ code: 'LXS10' })).toBe('subPlanConflict');
    expect(errorKey({ code: 'LXS12' })).toBe('subPlanInUse');
    expect(errorKey({ code: 'LXS13' })).toBe('subCodeLimit');
    expect(errorKey({ code: 'LXS14' })).toBe('subDayOver');
    expect(errorKey({ code: 'LXS20' })).toBe('absencePast');
    expect(errorKey({ code: 'LXS21' })).toBe('absenceTooLong');
    expect(errorKey({ code: 'LXS22' })).toBe('absenceOverlap');
    expect(errorKey({ code: 'LXS15' })).toBe('subPlanAiStale');
    expect(errorKey({ code: 'LXS16' })).toBe('subReportChanged');
    expect(errorKey({ code: 'LXS23' })).toBe('absenceRequestReused');
  });

  it('has a message for every key', () => {
    const codes = [
      'LXS10',
      'LXS12',
      'LXS13',
      'LXS14',
      'LXS15',
      'LXS16',
      'LXS20',
      'LXS21',
      'LXS22',
      'LXS23',
    ];
    for (const code of codes) {
      expect(fr.errors, code).toHaveProperty(errorKey({ code }));
    }
    // Field errors of the absence form (packages/domain absenceFormSchema).
    expect(fr.errors).toHaveProperty('halfDaySingleDay');
  });

  it('keeps the generic mappings', () => {
    expect(errorKey({ code: '42501' })).toBe('forbidden');
    expect(errorKey({ code: '22023' })).toBe('invalid');
    expect(errorKey({ code: 'XX000' })).toBe('unexpected');
    expect(errorKey(null)).toBe('unexpected');
  });
});
