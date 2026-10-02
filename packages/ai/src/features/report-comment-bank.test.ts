import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { contentSchema } from '@lynx/content';
import { describe, expect, it } from 'vitest';
import { features } from '../index';
import { Redactor, type KnownPerson } from '../privacy';
import { loadPrompt } from '../prompts';
import { createFakeProvider } from '../providers';
import { priceFor } from '../pricing';
import { runFeature } from '../run';
import {
  REPORT_BANK_LENGTH_KEYS,
  REPORT_BANK_LENGTHS,
  REPORT_BANK_MAX_EXPECTATIONS,
  REPORT_BANK_AI_PERIODS,
  reportBankContent,
  reportCommentBankFeature as feature,
  reportCommentBankInputSchema,
  type ReportBankAiEntry,
  type ReportCommentBankAiOutput,
  type ReportCommentBankInput,
} from './report-comment-bank';

const NOW = new Date('2026-10-02T12:00:00Z');
const MAT = 'ece67150-44d3-4e6e-b772-d9bde2165caf';
const ERE = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

const exp = (n: number, code: string, text: string) => ({
  key: `E${n}`,
  expectationId: `20000000-0000-4000-8000-0000000300${String(n).padStart(2, '0')}`,
  code,
  text,
  kind: 'specific' as const,
  strandLabel: 'Nombres',
});

const B1_1 = exp(
  1,
  'B1.1',
  "Lire, représenter, composer et décomposer des nombres naturels jusqu'à 1 000 de différentes façons.",
);
const B1_2 = exp(2, 'B1.2', "Comparer et ordonner des nombres naturels jusqu'à 1 000.");

type Scope = ReportCommentBankInput['scope'];

/** A request as `app.report_comment_bank_ai_input` builds it. */
function request(
  scope: Scope = 'subject',
  changes: Partial<ReportCommentBankInput> = {},
): ReportCommentBankInput {
  return reportCommentBankInputSchema.parse({
    itemType: 'report_comments',
    scope,
    period: 'term',
    length: 'medium',
    gradeCodes: ['3'],
    gradeLabels: ['3e année'],
    subjectId: scope === 'learning_skills' ? null : scope === 'religion' ? ERE : MAT,
    subjectLabel:
      scope === 'learning_skills'
        ? null
        : scope === 'religion'
          ? 'Enseignement religieux'
          : 'Mathématiques',
    expectations: scope === 'subject' ? [B1_1, B1_2] : [],
    teacherNote: '',
    ...changes,
  });
}

const people: KnownPerson[] = [
  { name: 'Aïcha', kind: 'student' },
  { name: 'Samuel', kind: 'student' },
  { name: 'Isabelle Tremblay', kind: 'staff' },
];

/** The fake answer, normalized as `checkOutput` does. */
const answer = (input: ReportCommentBankInput) => feature.normalize!(feature.fake(input), input);

const entry = (changes: Partial<ReportBankAiEntry> = {}): ReportBankAiEntry => ({
  kind: 'strength',
  expectationKey: 'E1',
  skill: null,
  level: 3,
  progress: null,
  rating: null,
  category: null,
  neutral: '{prénom} lit des nombres jusqu’à 1 000.',
  feminine: '',
  masculine: '',
  ...changes,
});

/** The fake answer with one more entry, normalized. */
function withEntry(input: ReportCommentBankInput, extra: Partial<ReportBankAiEntry>) {
  const fake = feature.fake(input);
  return feature.normalize!({ ...fake, entries: [...fake.entries, entry(extra)] }, input);
}

describe('report_comment_bank: the request', () => {
  it('is routed by the worker under its own name, with prompt v1', () => {
    expect(features.report_comment_bank).toBe(feature);
    expect(feature.name).toBe('report_comment_bank');
    expect(feature.promptVersion).toBe('v1');
  });

  it('takes one grade, the subject that fits the scope and 0 to 12 attentes', () => {
    expect(request().expectations).toHaveLength(2);
    expect(request('learning_skills').subjectId).toBeNull();
    expect(request('religion').subjectLabel).toBe('Enseignement religieux');
    const ok = request();
    const bad = (changes: Record<string, unknown>) =>
      reportCommentBankInputSchema.safeParse({ ...ok, ...changes }).success;
    expect(bad({})).toBe(true);
    expect(bad({ expectations: [] })).toBe(true);
    expect(bad({ itemType: 'rubric' })).toBe(false);
    expect(bad({ period: 'any' })).toBe(false);
    expect(bad({ length: 'long' })).toBe(false);
    expect(bad({ gradeCodes: ['3', '4'], gradeLabels: ['3e année', '4e année'] })).toBe(false);
    expect(bad({ subjectId: null })).toBe(false);
    expect(bad({ teacherNote: 'x'.repeat(501) })).toBe(false);
    expect(bad({ expectations: [B1_2] })).toBe(false);
    const many = Array.from({ length: REPORT_BANK_MAX_EXPECTATIONS + 1 }, (_, i) =>
      exp(i + 1, `B1.${i + 1}`, 'Texte.'),
    );
    expect(bad({ expectations: many })).toBe(false);
    expect(bad({ expectations: many.slice(0, 12) })).toBe(true);
    const skills = request('learning_skills');
    expect(reportCommentBankInputSchema.safeParse({ ...skills, subjectId: MAT }).success).toBe(
      false,
    );
    expect(
      reportCommentBankInputSchema.safeParse({ ...skills, expectations: [B1_1] }).success,
    ).toBe(false);
  });

  it('de-identifies the note and every label, and refuses a personal detail', () => {
    const redactor = new Redactor(people, NOW);
    const { input, blocked } = feature.redactInput(
      request('subject', { teacherNote: 'Pour Aïcha et Samuel, des exemples concrets.' }),
      redactor,
    );
    expect(blocked).toEqual([]);
    expect(input.teacherNote).toBe('Pour Élève A et Élève B, des exemples concrets.');
    expect(input.expectations[0]!.text).toBe(B1_1.text);
    const email = feature.redactInput(
      request('subject', { teacherNote: 'Écrire à parent@example.com' }),
      new Redactor(people, NOW),
    );
    expect(email.blocked.map((b) => b.kind)).toEqual(['email']);
  });

  it('sends grade, subject, report, length, attentes with keys and the note: no ids', () => {
    const redactor = new Redactor(people, NOW);
    const { input } = feature.redactInput(
      request('subject', { teacherNote: 'Insister sur le calcul mental, comme Aïcha le fait.' }),
      redactor,
    );
    const message = feature.buildUserMessage(input);
    expect(message).toContain("Année d'études : 3e année");
    expect(message).toContain('Matière : Mathématiques');
    expect(message).toContain('Bulletin : Bulletin scolaire (1re et 2e étapes)');
    expect(message).toContain('Niveaux de rendement (`level`) : 1, 2, 3, 4');
    expect(message).toContain('au plus 400 caractères par texte');
    expect(message).toContain(
      "- E2 — B1.2 (contenu d’apprentissage · Nombres) : Comparer et ordonner des nombres naturels jusqu'à 1 000.",
    );
    expect(message).toContain('comme Élève A le fait.');
    expect(message).not.toMatch(UUID);
    expect(message).not.toMatch(/Aïcha|Samuel|Tremblay|Isabelle|école|classe/);
    expect(message.trimEnd().endsWith('</precisions>')).toBe(true);
    expect(() => redactor.assertSafeOutbound(message)).not.toThrow();

    const general = feature.buildUserMessage(request('subject', { expectations: [] }));
    expect(general).toContain('Attentes visées : aucune (commentaires généraux');
    expect(general).toContain("Précisions de l'enseignant·e : aucune.");

    const skills = feature.buildUserMessage(
      request('learning_skills', { period: 'progress', length: 'short' }),
    );
    expect(skills).toContain('pour les habiletés d’apprentissage et les habitudes de travail');
    expect(skills).not.toContain('Matière :');
    expect(skills).toContain('- independent_work : Autonomie');
    expect(skills).toContain('excellent (E — Excellent)');
    expect(skills).toContain('au plus 250 caractères par texte');
    expect(skills).not.toContain('Attentes');
  });

  it('sends the common part and only the scope’s and the report’s sections', async () => {
    const prompt = await loadPrompt('report_comment_bank', 'v1');
    const sections = [...prompt.matchAll(/<!-- section: ([a-z_:]+) -->/g)].map((m) => m[1]);
    expect(new Set(sections)).toEqual(
      new Set([
        'scope:subject',
        'scope:learning_skills',
        'scope:religion',
        'period:term',
        'period:progress',
      ]),
    );
    const subject = feature.systemPrompt!(prompt, request());
    expect(subject).toContain('## Règles essentielles');
    expect(subject).toContain('## Pour une matière');
    expect(subject).toContain('## Bulletin scolaire');
    expect(subject).not.toContain('## Bulletin de progrès');
    expect(subject).not.toContain('## Pour les habiletés');
    expect(subject).not.toContain('<!--');
    // The achievement chart's qualifiers, as rubrics have them (D-131).
    expect(subject).toContain(
      'niveau 3 « avec efficacité », niveau 4 « avec beaucoup d’efficacité »',
    );
    expect(subject).toContain('niveau 3 « générale »');
    const religion = feature.systemPrompt!(prompt, request('religion', { period: 'progress' }));
    expect(religion).toContain('## Pour l’enseignement religieux');
    expect(religion).toContain('## Bulletin de progrès');
    const skills = feature.systemPrompt!(prompt, request('learning_skills'));
    expect(skills).toContain('## Pour les habiletés');
    expect(skills).not.toMatch(/## Bulletin (scolaire|de progrès)/);
    for (const system of [subject, religion, skills]) {
      expect(() => new Redactor(people, NOW).assertSafeOutbound(system)).not.toThrow();
    }
  });
});

describe('report_comment_bank: answers', () => {
  it('has a structured-output schema, and the fake answer matches it', () => {
    expect(() => zodOutputFormat(feature.outputSchema)).not.toThrow();
    for (const scope of ['subject', 'learning_skills', 'religion'] as const) {
      const input = request(scope);
      expect(feature.outputSchema.safeParse(feature.fake(input)).success, scope).toBe(true);
    }
  });

  it('the fake answer passes every check for every scope, report and length', () => {
    for (const scope of ['subject', 'learning_skills', 'religion'] as const) {
      for (const period of REPORT_BANK_AI_PERIODS) {
        for (const length of REPORT_BANK_LENGTH_KEYS) {
          for (const expectations of scope === 'subject' ? [[], [B1_1, B1_2]] : [[]]) {
            const input = request(scope, { period, length, expectations });
            const output = answer(input);
            expect(feature.validate(output, input), `${scope} ${period} ${length}`).toEqual([]);
            expect(
              output.entries.every((e) => e.neutral.length <= REPORT_BANK_LENGTHS[length]),
            ).toBe(true);
          }
        }
      }
    }
    // Twelve attentes stay within the bank's 160 entries.
    const twelve = request('subject', {
      expectations: Array.from({ length: 12 }, (_, i) => exp(i + 1, `B${i + 1}.1`, 'Texte.')),
    });
    expect(feature.validate(answer(twelve), twelve)).toEqual([]);
  });

  it('normalizes for free: placeholder, articles, labels, keys and repeated wordings', () => {
    const input = request();
    const raw: ReportCommentBankAiOutput = {
      title: "Commentaires d'étape",
      summary: 'Résumé',
      keywords: 'bulletin',
      entries: [
        entry({
          kind: 'Point fort',
          expectationKey: ' e2 ',
          category: 'Mise en application',
          neutral: "Les idées d'{prenom} sont claires; [Prénom] compare avec efficacité.",
          feminine: "Les idées d'{prenom} sont claires; [Prénom] compare avec efficacité.",
          masculine: '{ prénom } est attentif.',
        }),
        entry({
          kind: 'Prochaines étapes',
          expectationKey: null,
          level: 2.2,
        }),
      ],
    };
    const [a, b] = feature.normalize!(raw, input).entries;
    expect(a).toMatchObject({
      kind: 'strength',
      expectationKey: 'E2',
      expectationCodes: ['B1.2'],
      category: 'application',
      neutral: 'Les idées de {prénom} sont claires; {prénom} compare avec efficacité.',
      feminine: '',
      masculine: '{prénom} est attentif.',
    });
    expect(b).toMatchObject({ kind: 'next_step', expectationCodes: [], level: 2 });
    expect(feature.normalize!(raw, input).title).toBe('Commentaires d’étape');

    const skills = request('learning_skills');
    const [s] = feature.normalize!(
      {
        ...raw,
        entries: [
          entry({
            expectationKey: null,
            level: null,
            skill: 'Sens de l’organisation',
            rating: 'T',
          }),
        ],
      },
      skills,
    ).entries;
    expect(s).toMatchObject({ skill: 'organization', rating: 'good' });
    const progress = request('subject', { period: 'progress' });
    const [p] = feature.normalize!(
      { ...raw, entries: [entry({ level: null, progress: 'Progresse très bien' })] },
      progress,
    ).entries;
    expect(p!.progress).toBe('very_well');
  });

  it('turns into the bank the library stores, which passes `final`', () => {
    const input = request();
    const content = reportBankContent(answer(input), input);
    expect(contentSchema('report_comments', 'final').safeParse(content).success).toBe(true);
    expect(content.entries[0]).toEqual({
      kind: 'strength',
      skill: null,
      level: 1,
      progress: null,
      rating: null,
      category: 'application',
      expectationCodes: ['B1.1'],
      neutral: expect.stringContaining('{prénom}'),
      feminine: '',
      masculine: '',
    });
    expect(Object.keys(content.entries[0]!)).not.toContain('expectationKey');
  });

  it('refuses (and retries) what a bank must not hold', () => {
    const input = request();
    const problems = (extra: Partial<ReportBankAiEntry>) =>
      feature.validate(withEntry(input, extra), input);
    expect(problems({ expectationKey: 'E9' })).toContain(
      `entries.${answer(input).entries.length}.expectationKey: not in the request`,
    );
    expect(problems({ neutral: '{prénom} compare des nombres (B1.2).' }).join()).toMatch(
      /codeInText.*curriculum code not given \(B1\.2\)/,
    );
    expect(problems({ neutral: '{nom} compare des nombres.' }).join()).toContain('placeholder');
    expect(problems({ neutral: 'Élève A compare des nombres.' })).toContain(
      'entries: a person marker',
    );
    expect(problems({ neutral: `{prénom} ${'compare '.repeat(60)}` }).join()).toContain(
      'longer than 400',
    );
    expect(
      problems({ level: 2, category: 'habiletes', neutral: '{prénom} compare avec efficacité.' }),
    ).toContain(`entries.${answer(input).entries.length}.neutral: qualifier of level 3`);
    expect(problems({ neutral: '{prénom} compare les prix du week-end.' }).join()).toContain(
      'not Canadian French (week-end)',
    );
    expect(problems({ progress: 'well' }).join()).toContain('progress: not for this report');
    expect(problems({ kind: 'remark' }).join()).toContain('kind: invalid');

    // Every attente has a point fort and a prochaine étape for each level.
    const fake = answer(input);
    const missing = feature.validate(
      {
        ...fake,
        entries: fake.entries.filter((e) => !(e.expectationKey === 'E2' && e.level === 4)),
      },
      input,
    );
    expect(missing).toEqual([
      'entries: no strength for E2 at 4',
      'entries: no next_step for E2 at 4',
    ]);
    // An entry without a level counts for every level.
    const anyLevel = feature.validate(
      {
        ...fake,
        entries: [
          ...fake.entries.filter((e) => !(e.expectationKey === 'E2' && e.level === 4)),
          entry({ expectationKey: 'E2', level: null }),
          entry({ expectationKey: 'E2', level: null, kind: 'next_step' }),
        ],
      },
      input,
    );
    expect(anyLevel).toEqual([]);

    const skills = request('learning_skills');
    const skillFake = answer(skills);
    expect(
      feature.validate(
        { ...skillFake, entries: skillFake.entries.filter((e) => e.skill !== 'initiative') },
        skills,
      ),
    ).toEqual(['entries: no strength for initiative', 'entries: no next_step for initiative']);
    expect(
      feature
        .validate(
          withEntry(skills, { expectationKey: null, skill: 'initiative', level: 2 }),
          skills,
        )
        .join(),
    ).toContain('a level or progress mark for a learning skill');

    expect(feature.validate({ ...fake, title: ' ' }, input)).toContain('title: required');
    expect(
      feature.validate(
        {
          ...fake,
          entries: [
            ...fake.entries,
            ...fake.entries,
            ...fake.entries,
            ...fake.entries,
            ...fake.entries,
            ...fake.entries,
            ...fake.entries,
            ...fake.entries,
            ...fake.entries,
            ...fake.entries,
          ],
        },
        input,
      ),
    ).toContain('entries: tooMany');
  });

  it('runs end to end with the fake provider: names stay out, the answer is the bank', async () => {
    const run = await runFeature({
      feature,
      provider: createFakeProvider(),
      price: priceFor('fake'),
      systemPrompt: await loadPrompt('report_comment_bank', 'v1'),
      input: request('subject', {
        teacherNote: 'Comme pour Aïcha, insister sur la droite numérique.',
      }),
      people,
      now: NOW,
    });
    expect(run.status).toBe('succeeded');
    expect(run.sentText).toContain('Comme pour Élève A, insister');
    expect(run.sentText).not.toMatch(/Aïcha|Samuel|Tremblay/);
    expect(run.sentText).not.toMatch(UUID);
    const texts = run.output!.entries.map((e) => e.neutral).join('\n');
    expect(texts).not.toMatch(/Aïcha|Élève A/);
    expect(
      run.output!.entries.every((e) => e.kind === 'general' || e.neutral.includes('{prénom}')),
    ).toBe(true);
  });
});
