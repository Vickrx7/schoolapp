import { readFileSync } from 'node:fs';
import { fillComment } from '@lynx/content';
import { describe, expect, it } from 'vitest';
import {
  COMMENT_LIMIT_DEFAULT,
  LEARNING_SKILLS_KEY,
  alternativesOf,
  bankPeriodOf,
  bankServesReport,
  commentStatus,
  composeFromPicks,
  composerSubjects,
  draftExpired,
  draftExpiresOn,
  dropStalePicks,
  emptyDraftComment,
  emptyReportDraft,
  entryInScope,
  isPeriodKey,
  noteKeywords,
  parseReportDraft,
  parseReportDraftKey,
  periodKey,
  reportDraftKey,
  reportReminders,
  resolveBankEntries,
  studentsWithWork,
  suggestEntries,
  wordingKey,
  type BankEntry,
  type ComposerMark,
  type ReportDraft,
} from './index';

const entry = (over: Partial<BankEntry>): BankEntry => ({
  kind: 'strength',
  skill: null,
  level: null,
  progress: null,
  rating: null,
  category: null,
  expectationCodes: [],
  neutral: '{prénom} travaille.',
  feminine: '',
  masculine: '',
  ...over,
});

const noMark: ComposerMark = { level: null, progress: null, ratings: {} };
const level = (n: number): ComposerMark => ({ ...noMark, level: n });

describe('report periods in the composer (D-130, D-135)', () => {
  it('keys a board period by its kind and chosen dates by the dates and the report', () => {
    expect(periodKey({ kind: 'term1' })).toBe('term1');
    expect(periodKey({ from: '2027-01-04', to: '2027-01-29', report: 'term' })).toBe(
      'custom-2027-01-04-2027-01-29-term',
    );
    expect(isPeriodKey('term1')).toBe(true);
    expect(isPeriodKey('custom-2027-01-04-2027-01-29-progress')).toBe(true);
    expect(isPeriodKey('custom-2027-01-04')).toBe(false);
    expect(isPeriodKey('x:y')).toBe(false);
  });

  it('takes a progress bank for the progress report and a report card bank for the terms', () => {
    expect(bankPeriodOf('progress')).toBe('progress');
    expect(bankPeriodOf('term1')).toBe('term');
    expect(bankPeriodOf('term2')).toBe('term');
    expect(bankServesReport('any', 'progress')).toBe(true);
    expect(bankServesReport('term', 'term')).toBe(true);
    expect(bankServesReport('term', 'progress')).toBe(false);
  });

  it('keeps the draft until 60 days after the remise (else the saisie, else the last day)', () => {
    const p = { endsOn: '2027-01-29', dueOn: '2027-02-05', issuedOn: '2027-02-12' };
    expect(draftExpiresOn(p)).toBe('2027-04-13');
    expect(draftExpiresOn({ ...p, issuedOn: null })).toBe('2027-04-06');
    expect(draftExpiresOn({ ...p, issuedOn: null, dueOn: null })).toBe('2027-03-30');
    expect(draftExpired('2027-04-13', '2027-04-13')).toBe(false);
    expect(draftExpired('2027-04-13', '2027-04-14')).toBe(true);
    expect(draftExpired('pas une date', '2027-04-14')).toBe(true);
  });

  it('reminds from 21 days before the saisie until that day, for the classes of its year', () => {
    const periods = [
      {
        kind: 'progress' as const,
        schoolYearId: 'y1',
        startsOn: '2026-09-02',
        endsOn: '2026-10-30',
        dueOn: '2026-11-06',
        issuedOn: '2026-11-13',
      },
      {
        kind: 'term1' as const,
        schoolYearId: 'y1',
        startsOn: '2026-09-02',
        endsOn: '2027-01-29',
        dueOn: null,
        issuedOn: null,
      },
      {
        kind: 'progress' as const,
        schoolYearId: 'y2',
        startsOn: '2027-09-02',
        endsOn: '2027-10-29',
        dueOn: '2027-11-05',
        issuedOn: null,
      },
    ];
    const classes = [
      { id: 'a', name: '3e', schoolYearId: 'y1' },
      { id: 'b', name: '5e', schoolYearId: 'y1' },
    ];
    expect(reportReminders({ periods, classes, today: '2026-10-15' })).toEqual([]);
    const first = reportReminders({ periods, classes, today: '2026-10-16' });
    expect(first).toEqual([{ kind: 'progress', date: '2026-11-06', due: true, classes }]);
    expect(reportReminders({ periods, classes, today: '2026-11-06' })).toHaveLength(1);
    expect(reportReminders({ periods, classes, today: '2026-11-07' })).toEqual([]);
    // Without a « saisie »: the period's last day; a year without classes reminds nobody.
    expect(reportReminders({ periods, classes, today: '2027-01-20' })).toEqual([
      { kind: 'term1', date: '2027-01-29', due: false, classes },
    ]);
    expect(reportReminders({ periods, classes, today: '2027-10-20' })).toEqual([]);
  });
});

describe('the subjects of « Bulletins » (D-135)', () => {
  const subjects = [
    { id: 'fra', label: 'Français' },
    { id: 'mat', label: 'Mathématiques' },
    { id: 'eps', label: 'Éducation physique et santé' },
    { id: 'art', label: 'Éducation artistique' },
  ];
  const paul = 'paul';
  const blocks = [
    { subjectId: 'fra', teacherId: null },
    { subjectId: 'mat', teacherId: null },
    { subjectId: 'eps', teacherId: paul },
    { subjectId: 'eps', teacherId: null },
    { subjectId: null, teacherId: null },
  ];

  it('gives a subject teacher his own subjects first, then the learning skills', () => {
    const choices = composerSubjects({ blocks, userId: paul, myRole: 'subject', subjects });
    expect(choices.map((c) => [c.key, c.group])).toEqual([
      ['eps', 'mine'],
      [LEARNING_SKILLS_KEY, 'learning_skills'],
      ['fra', 'other'],
      ['mat', 'other'],
      ['art', 'other'],
    ]);
  });

  it('gives the homeroom teacher the learning skills first, then the blocks without a teacher', () => {
    const choices = composerSubjects({
      blocks,
      userId: 'isabelle',
      myRole: 'homeroom',
      subjects,
    });
    expect(choices.map((c) => [c.key, c.group])).toEqual([
      [LEARNING_SKILLS_KEY, 'learning_skills'],
      ['fra', 'mine'],
      ['mat', 'mine'],
      ['eps', 'mine'],
      ['art', 'other'],
    ]);
    expect(choices[0]!.subject).toBeNull();
  });
});

describe('the entries proposed for a student (D-130)', () => {
  // B1 (overall) has B1.1 and B1.2; B2.3 is taught. Combined class: codes repeat by grade.
  const expectations = [
    { id: 'b1-3', code: 'B1', gradeCode: '3', parentId: null },
    { id: 'b11-3', code: 'B1.1', gradeCode: '3', parentId: 'b1-3' },
    { id: 'b12-3', code: 'B1.2', gradeCode: '3', parentId: 'b1-3' },
    { id: 'b23-3', code: 'B2.3', gradeCode: '3', parentId: null },
    { id: 'b11-4', code: 'B1.1', gradeCode: '4', parentId: null },
  ];
  const parents = new Map(expectations.map((e) => [e.id, e.parentId]));
  const bank = [
    entry({ level: 3, expectationCodes: ['B1.1'], neutral: 'B11 niveau 3' }),
    entry({ level: 2, expectationCodes: ['B1.1'], neutral: 'B11 niveau 2' }),
    entry({ level: 3, expectationCodes: ['B2.3'], neutral: 'B23 niveau 3' }),
    entry({ level: 3, expectationCodes: ['B9.9'], neutral: 'inconnue' }),
    entry({ kind: 'next_step', level: 3, expectationCodes: ['B1'], neutral: 'B1 étape' }),
    entry({ kind: 'strength', neutral: 'générale', feminine: 'générale F' }),
    entry({ kind: 'general', neutral: 'commentaire général' }),
    entry({ level: 3, expectationCodes: ['B1.2'], neutral: 'B12 niveau 3 calculs' }),
    entry({ level: 3, progress: null, expectationCodes: ['B2.3'], neutral: 'B23 alt' }),
  ];

  it('resolves attente codes within the student’s grade', () => {
    const three = resolveBankEntries(bank, { gradeCode: '3', expectations });
    expect(three[0]!.expectationIds).toEqual(['b11-3']);
    expect(three[3]!.expectationIds).toEqual([]);
    expect(three.map((e) => e.index)).toEqual(bank.map((_, i) => i));
    const four = resolveBankEntries(bank, { gradeCode: '4', expectations });
    expect(four[0]!.expectationIds).toEqual(['b11-4']);
    expect(four[2]!.expectationIds).toEqual([]);
  });

  it('counts an entry for its attente, its overall attente or one of its specific attentes', () => {
    const taught = new Set(['b11-3']);
    const scoped = (ids: string[]) => entryInScope({ expectationIds: ids }, taught, parents);
    expect(scoped(['b11-3'])).toBe(true);
    expect(scoped(['b1-3'])).toBe(true); // overall: a specific attente was taught
    expect(scoped(['b12-3'])).toBe(false); // a sibling is not enough
    expect(scoped(['b23-3'])).toBe(false);
    expect(scoped([])).toBe(true); // general entries always count
    expect(entryInScope({ expectationIds: ['b12-3'] }, new Set(['b1-3']), parents)).toBe(true);
    expect(entryInScope({ expectationIds: ['b23-3'] }, null, parents)).toBe(true);
  });

  const resolved = resolveBankEntries(bank, { gradeCode: '3', expectations });
  const base = {
    entries: resolved,
    scope: 'subject' as const,
    report: 'term' as const,
    parents,
  };

  it('proposes the mark’s entries, taught attentes first, others folded away', () => {
    const s = suggestEntries({ ...base, mark: level(3), taught: new Set(['b11-3']) });
    expect(s.needsMark).toBe(false);
    expect(s.strengths.map((x) => x.entry.neutral)).toEqual([
      'B11 niveau 3',
      'inconnue',
      'générale',
    ]);
    expect(s.nextSteps.map((x) => x.entry.neutral)).toEqual(['B1 étape']);
    expect(s.general.map((x) => x.entry.neutral)).toEqual(['commentaire général']);
    expect(s.outOfScope.map((x) => x.entry.neutral)).toEqual([
      'B23 niveau 3',
      'B12 niveau 3 calculs',
      'B23 alt',
    ]);
  });

  it('offers every entry for the mark when nothing was taught or nothing is loaded', () => {
    const s = suggestEntries({ ...base, mark: level(2), taught: null });
    expect(s.strengths.map((x) => x.entry.neutral)).toEqual(['B11 niveau 2', 'générale']);
    expect(s.outOfScope).toEqual([]);
  });

  it('without a mark, proposes only the entries for every mark', () => {
    const s = suggestEntries({ ...base, mark: noMark, taught: null });
    expect(s.needsMark).toBe(true);
    expect(s.strengths.map((x) => x.entry.neutral)).toEqual(['générale']);
    expect(s.general).toHaveLength(1);
  });

  it('puts entries sharing a word with « Mes notes » first', () => {
    const s = suggestEntries({
      ...base,
      mark: level(3),
      taught: null,
      notes: 'Ses calculs mentaux sont rapides, avec des erreurs.',
    });
    expect(s.strengths[0]!.entry.neutral).toBe('B12 niveau 3 calculs');
    expect(s.strengths[0]!.fromNotes).toBe(true);
    expect(s.strengths[1]!.fromNotes).toBe(false);
    expect(noteKeywords('{prénom} avec ses Calculs, très bien')).toEqual(['calculs']);
  });

  it('matches the progress report’s marks and the learning skills’ ratings', () => {
    const progress = resolveBankEntries(
      [
        entry({ progress: 'well', neutral: 'bien' }),
        entry({ progress: 'very_well', neutral: 'très bien' }),
        entry({ level: 3, neutral: 'niveau' }),
        entry({ neutral: 'toujours' }),
      ],
      { gradeCode: '3', expectations },
    );
    const p = suggestEntries({
      entries: progress,
      scope: 'subject',
      report: 'progress',
      mark: { ...noMark, progress: 'well' },
      taught: null,
      parents,
    });
    expect(p.strengths.map((x) => x.entry.neutral)).toEqual(['bien', 'toujours']);

    const skills = resolveBankEntries(
      [
        entry({ skill: 'organization', rating: 'good', neutral: 'org T' }),
        entry({ skill: 'responsibility', rating: 'excellent', neutral: 'fiab E' }),
        entry({ skill: 'responsibility', rating: 'good', neutral: 'fiab T' }),
        entry({ skill: 'collaboration', rating: 'good', neutral: 'collab T' }),
        entry({ kind: 'next_step', skill: 'organization', rating: null, neutral: 'org étape' }),
      ],
      { gradeCode: '3', expectations },
    );
    const k = suggestEntries({
      entries: skills,
      scope: 'learning_skills',
      report: 'term',
      mark: { ...noMark, ratings: { organization: 'good', responsibility: 'excellent' } },
      taught: null,
      parents,
    });
    // In the six skills' order: Fiabilité before Sens de l'organisation.
    expect(k.strengths.map((x) => x.entry.neutral)).toEqual(['fiab E', 'org T']);
    expect(k.nextSteps.map((x) => x.entry.neutral)).toEqual(['org étape']);
    expect(
      suggestEntries({
        entries: skills,
        scope: 'learning_skills',
        report: 'term',
        mark: noMark,
        taught: null,
        parents,
      }),
    ).toMatchObject({ needsMark: true, strengths: [], nextSteps: [] });
  });

  it('finds another wording of the same entry, never for entries about no attente', () => {
    expect(alternativesOf(resolved[2]!, resolved).map((e) => e.neutral)).toEqual(['B23 alt']);
    expect(alternativesOf(resolved[0]!, resolved)).toEqual([]);
    // Two general strengths say two different things.
    const general = resolveBankEntries(
      [entry({ neutral: 'enthousiasme' }), entry({ neutral: 'persévérance' })],
      { gradeCode: '3', expectations },
    );
    expect(alternativesOf(general[0]!, general)).toEqual([]);
    expect(wordingKey(general[0]!)).not.toBe(wordingKey(general[1]!));
  });

  it('builds the comment from the picks: strengths, general, next steps, in the wording', () => {
    const text = composeFromPicks(
      resolved,
      [{ index: 4 }, { index: 6 }, { index: 5 }, { index: 0 }, { index: 99 }],
      'feminine',
    );
    expect(text).toBe('générale F B11 niveau 3 commentaire général B1 étape');
    expect(composeFromPicks(resolved, [], 'neutral')).toBe('');
  });

  it('works with the demo bank « Mathématiques, 3e année » and fills the name with elision', () => {
    const demo = JSON.parse(
      readFileSync(
        new URL(
          '../../../../content/library/demo/items/commentaires-mat-3e-bulletin.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ) as { versions: { content: { entries: BankEntry[] } }[] };
    const entries = resolveBankEntries(demo.versions[0]!.content.entries, {
      gradeCode: '3',
      expectations: [],
    });
    const s = suggestEntries({
      entries,
      scope: 'subject',
      report: 'term',
      mark: level(3),
      taught: null,
      parents: new Map(),
    });
    expect(s.strengths.length).toBeGreaterThanOrEqual(5);
    expect(s.nextSteps.length).toBeGreaterThanOrEqual(5);
    const text = composeFromPicks(entries, [{ index: s.strengths[0]!.entry.index }], 'neutral');
    expect(text).toContain('{prénom}');
    expect(fillComment(text, 'Aïcha')).toMatch(/^Aïcha /);
  });
});

describe('the device draft (D-130)', () => {
  const user = '00000000-0000-4000-8000-000000000001';
  const cls = 'e0000000-0000-4000-8000-000000000003';
  const student = '10000000-0000-4000-8000-000000000001';
  const bank = '20000000-0000-4000-8000-000000000001';

  it('is keyed by the user, the class and the period', () => {
    const key = reportDraftKey(user, cls, 'term1');
    expect(key).toBe(`report:${user}:${cls}:term1`);
    expect(parseReportDraftKey(key)).toEqual({ userId: user, classId: cls, periodKey: 'term1' });
    expect(parseReportDraftKey('lesson:1:2')).toBeNull();
    expect(parseReportDraftKey('report:a:b')).toBeNull();
  });

  it('reads what it wrote, with defaults, and refuses anything else', () => {
    const draft = emptyReportDraft('2027-04-13');
    expect(draft.limit).toBe(COMMENT_LIMIT_DEFAULT);
    expect(draft.plainSpaces).toBe(true);
    expect(parseReportDraft(JSON.parse(JSON.stringify(draft)))).toEqual(draft);
    expect(
      parseReportDraft({
        v: 1,
        expiresOn: '2027-04-13',
        students: { [student]: { comments: { mat: { text: '{prénom} lit.' } } } },
      }),
    ).toEqual({
      ...draft,
      students: {
        [student]: {
          gradeCode: null,
          form: 'neutral',
          notes: '',
          comments: { mat: { ...emptyDraftComment(), text: '{prénom} lit.' } },
        },
      },
    });
    expect(parseReportDraft({ ...draft, v: 2 })).toBeNull();
    expect(parseReportDraft({ ...draft, expiresOn: 'demain' })).toBeNull();
    expect(parseReportDraft({ ...draft, limit: 50 })).toBeNull();
    expect(parseReportDraft({ ...draft, students: { Aïcha: {} } })).toBeNull();
    expect(parseReportDraft(null)).toBeNull();
  });

  it('drops the picks of an older revision of the bank, keeping the text', () => {
    const draft: ReportDraft = {
      ...emptyReportDraft('2027-04-13'),
      students: {
        [student]: {
          gradeCode: null,
          form: 'neutral',
          notes: '',
          comments: {
            mat: {
              ...emptyDraftComment(),
              level: 3,
              picks: [
                { itemId: bank, revision: 1, index: 2 },
                { itemId: bank, revision: 2, index: 3 },
              ],
              text: '{prénom} compte.',
            },
          },
        },
      },
    };
    const kept = dropStalePicks(draft, { itemId: bank, revision: 2 });
    expect(kept.students[student]!.comments.mat!.picks).toEqual([
      { itemId: bank, revision: 2, index: 3 },
    ]);
    expect(kept.students[student]!.comments.mat!.text).toBe('{prénom} compte.');
    expect(dropStalePicks(kept, { itemId: bank, revision: 2 })).toBe(kept);
  });

  it('gives each student a status, counted on the comment with the name', () => {
    expect(commentStatus(undefined, 'Aïcha', 1000)).toEqual({ kind: 'todo' });
    expect(commentStatus(emptyDraftComment(), 'Aïcha', 1000)).toEqual({ kind: 'todo' });
    expect(commentStatus({ ...emptyDraftComment(), level: 2 }, 'Aïcha', 1000)).toEqual({
      kind: 'started',
    });
    const text = { ...emptyDraftComment(), text: 'Les progrès de {prénom} sont réguliers.' };
    // « Les progrès d’Aïcha sont réguliers. » is 35 characters.
    expect(commentStatus(text, 'Aïcha', 1000)).toEqual({ kind: 'ready', length: 35 });
    expect(commentStatus(text, 'Aïcha', 30)).toEqual({ kind: 'over', length: 35, over: 5 });
    const draft: ReportDraft = {
      ...emptyReportDraft('2027-04-13'),
      students: {
        [student]: { gradeCode: null, form: 'neutral', notes: '', comments: { mat: text } },
        [bank]: { gradeCode: null, form: 'feminine', notes: '', comments: {} },
      },
    };
    expect(studentsWithWork(draft)).toEqual([student]);
  });
});
