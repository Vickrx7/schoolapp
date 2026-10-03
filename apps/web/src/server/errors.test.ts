import { describe, expect, it, vi } from 'vitest';
import fr from '../../messages/fr-CA.json';

// errors.ts is server-only; the marker package throws outside a React server bundle.
vi.mock('server-only', () => ({}));
const { errorKey, readinessFieldErrors, READINESS_CODES, reportError } = await import('./errors');
const { originalConsole } = await import('@lynx/observability');

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

  it('maps the library codes to their messages', () => {
    const library = {
      LXL01: 'libraryNotReady',
      LXL02: 'librarySafetyNotes',
      LXL03: 'libraryFaithReviewNeeded',
      LXL04: 'libraryWrongStatus',
      LXL05: 'libraryOwnItem',
      LXL06: 'libraryLocked',
      LXL07: 'libraryConflict',
      LXL08: 'libraryTooLargeForAi',
      LXL09: 'libraryLevelExists',
      LXL10: 'libraryPersonalLevels',
    };
    for (const [code, key] of Object.entries(library)) {
      expect(errorKey({ code }), code).toBe(key);
      expect(fr.errors, code).toHaveProperty(key);
    }
    // Errors the library's actions return themselves (not SQLSTATEs).
    for (const key of ['libraryStudentNames', 'libraryInvalidContent', 'libraryChanged']) {
      expect(fr.errors, key).toHaveProperty(key);
    }
  });

  it('maps the Phase 5 codes to their messages', () => {
    const phase5 = {
      LXC01: 'classSessionOpen',
      LXC02: 'classSessionChanged',
      LXC03: 'classSessionNoMore',
      LXC04: 'classModeNotPlayable',
      LXC05: 'classSessionEnded',
      LXM01: 'libraryRemixArchived',
      LXM02: 'libraryRemixLicence',
      LXM03: 'libraryShareCap',
      LXR01: 'libraryRateOwn',
      LXR02: 'libraryRateNotApproved',
    };
    for (const [code, key] of Object.entries(phase5)) {
      expect(errorKey({ code }), code).toBe(key);
      expect(fr.errors, code).toHaveProperty(key);
    }
    // Returned by the class-mode actions themselves when this server has no device access.
    expect(fr.errors).toHaveProperty('classPortalNotConfigured');
  });

  it('maps the « Mon année » codes to their messages (D-123, D-124)', () => {
    const yearPlan = {
      LXY01: 'yearPlanWindow',
      LXY02: 'yearPlanExpectation',
      LXY03: 'reportPeriodOutsideYear',
    };
    for (const [code, key] of Object.entries(yearPlan)) {
      expect(errorKey({ code }), code).toBe(key);
      expect(fr.errors, code).toHaveProperty(key);
    }
    // Field errors of the domain's unitPlanSchema and reportPeriodFormSchema.
    expect(fr.errors).toHaveProperty('datesBoth');
    expect(fr.errors).toHaveProperty('beforePeriodStart');
  });

  it('maps the « Commentaires de bulletin » code to its message (D-129)', () => {
    expect(errorKey({ code: 'LXK01' })).toBe('reportBankNotTeaching');
    expect(fr.errors).toHaveProperty('reportBankNotTeaching');
  });

  it('maps the « Info-parents » codes to their messages (D-137, D-138)', () => {
    expect(errorKey({ code: 'LXN01' })).toBe('newsletterWeek');
    expect(errorKey({ code: 'LXN02' })).toBe('newsletterPurged');
    expect(errorKey({ code: 'LXN03' })).toBe('newsletterTooLargeForAi');
    expect(errorKey({ code: 'LXN04' })).toBe('newsletterNothingToTranslate');
    expect(errorKey({ code: 'LXN05' })).toBe('newsletterStale');
    expect(errorKey({ code: 'LXN06' })).toBe('newsletterBusy');
    // newsletterConflict: a save on a revision a colleague changed (server/actions/newsletters.ts).
    // newsletterChanged and newsletterTooLargeForAi are also the worker's job errors (D-139);
    // newsletterUnconfirmed: « Envoyer à l'IA » without the box ticked (server/actions/newsletter-ai.ts).
    for (const key of [
      'newsletterWeek',
      'newsletterPurged',
      'newsletterConflict',
      'newsletterTooLargeForAi',
      'newsletterNothingToTranslate',
      'newsletterStale',
      'newsletterBusy',
      'newsletterChanged',
      'newsletterUnconfirmed',
    ]) {
      expect(fr.errors, key).toHaveProperty(key);
    }
  });

  it('maps the Phase 6 codes to their messages', () => {
    const phase6 = {
      LXU01: 'lastBoardAdmin',
      LXU02: 'staffOtherBoard',
      LXU05: 'staffSelf',
      LXU06: 'staffStillActive',
      LXU07: 'staffSelfRole',
      LXU08: 'staffLastRole',
      LXO01: 'noSchoolYear',
      LXF01: 'feedbackLimit',
    };
    for (const [code, key] of Object.entries(phase6)) {
      expect(errorKey({ code }), code).toBe(key);
      expect(fr.errors, code).toHaveProperty(key);
    }
    // Returned by the Phase 6 actions themselves: a duplicate (23505) where it has a meaning of
    // its own, an invitation's failure, and the error pages' reference (D-111).
    for (const key of [
      'staffAlreadyInvited',
      'sampleClassExists',
      'emailConflict',
      'authNotConfigured',
      'authRefused',
      'invitationExpired',
      'reference',
      'reportProblem',
    ]) {
      expect(fr.errors, key).toHaveProperty(key);
    }
  });

  it('turns what a resource is missing into a field error with a message', () => {
    expect(readinessFieldErrors({ code: 'LXL01', details: 'expectations' })).toEqual({
      'readiness.expectations': 'readiness.expectations',
    });
    for (const code of READINESS_CODES) {
      const errors = readinessFieldErrors({ code: 'LXL01', details: code });
      expect(fr.errors, code).toHaveProperty(errors![`readiness.${code}`]!);
    }
    // Another error, or a detail the app does not know: no field error.
    expect(readinessFieldErrors({ code: 'LXL02' })).toBeUndefined();
    expect(readinessFieldErrors({ code: 'LXL01', details: 'something' })).toBeUndefined();
    expect(readinessFieldErrors({ code: 'LXL01', details: null })).toBeUndefined();
    expect(readinessFieldErrors(null)).toBeUndefined();
  });

  it('keeps the generic mappings', () => {
    expect(errorKey({ code: '42501' })).toBe('forbidden');
    expect(errorKey({ code: '22023' })).toBe('invalid');
    expect(errorKey({ code: 'XX000' })).toBe('unexpected');
    expect(errorKey(null)).toBe('unexpected');
  });

  it('logs unexpected errors as one scrubbed line (D-111)', () => {
    const lines: string[] = [];
    const spy = vi
      .spyOn(originalConsole, 'error')
      .mockImplementation((line) => void lines.push(String(line)));
    try {
      expect(
        reportError('inviteStaff', {
          code: 'XX000',
          message:
            'duplicate key value violates unique constraint "users_email_key": Key (email)=(isabelle.tremblay@demo.lynx.test) already exists',
          details: 'Failing row contains (Léa, 613-555-0142)',
        }),
      ).toBe('unexpected');
      // Known errors are the user's message, not a fault: nothing is logged.
      expect(reportError('saveUnit', { code: '42501', message: 'Léa' })).toBe('forbidden');
    } finally {
      spy.mockRestore();
    }
    expect(lines).toHaveLength(1);
    for (const sentinel of ['isabelle', 'tremblay', 'Léa', '555-0142', 'users_email_key']) {
      expect(lines[0]).not.toContain(sentinel);
    }
    expect(JSON.parse(lines[0]!)).toMatchObject({
      level: 'error',
      component: 'web',
      message: 'unexpected',
      context: 'inviteStaff',
      error: {
        code: 'XX000',
        message:
          'duplicate key value violates unique constraint "…": Key (email)=(…) already exists',
      },
    });
  });
});
