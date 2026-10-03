import { describe, expect, it } from 'vitest';
import { normalizeAiContent } from './ai';
import { contentPackItemSchema, itemHash, packItemFromSeed } from './pack-format';
import { reviewReadiness, type ReadinessInput } from './readiness';
import { renderStudentDoc } from './render/student';
import { renderTeacherDoc } from './render/teacher';
import { docToPlainText } from './render/plain';
import {
  CLASSMATE_GONE,
  classmateToken,
  clipDraftText,
  commentLength,
  elidesBefore,
  fillDraftText,
  unfillDraftText,
  entryQualifierProblems,
  entryText,
  fillComment,
  normalizeCommentTemplate,
  plainSpaces,
  REPORT_CARD_QUALIFIERS,
  reportQualifierLevels,
  unfillComment,
} from './report-comments';
import { ACHIEVEMENT_QUALIFIERS, qualifierLevels } from './rubric';
import { sampleCanonical } from './samples';
import { contentSchema, emptyContent } from './schemas';
import { seedItemSchema } from './seed-pack';
import { packToSql } from './seed-sql';
import { frenchStrings } from './style';
import { FIRST_NAME_TOKEN, hasCurriculumCode, hasStrayPlaceholder } from './types/report-comments';

type Entry = ReturnType<typeof sampleCanonical<'report_comments'>>['content']['entries'][number];

const entry = (changes: Partial<Entry> = {}): Entry => ({
  kind: 'strength',
  skill: null,
  level: null,
  progress: null,
  rating: null,
  category: null,
  expectationCodes: [],
  neutral: '{prénom} participe aux discussions.',
  feminine: '',
  masculine: '',
  ...changes,
});

const bank = (changes: Record<string, unknown> = {}) => ({
  title: '',
  objective: '',
  teacherNote: '',
  scope: 'subject',
  period: 'term',
  entries: [entry()],
  ...changes,
});

const finalIssues = (content: unknown) =>
  (contentSchema('report_comments', 'final').safeParse(content).error?.issues ?? []).map(
    (i) => `${i.path.join('.')} ${i.message}`,
  );

describe('comment bank: the schema (D-129)', () => {
  it('parses the sample in all three modes and starts empty for a term report', () => {
    const { content } = sampleCanonical('report_comments');
    expect(contentSchema('report_comments', 'ai').safeParse(content).success).toBe(true);
    expect(contentSchema('report_comments', 'draft').safeParse(content).success).toBe(true);
    expect(finalIssues(content)).toEqual([]);
    const empty = emptyContent('report_comments');
    expect(empty).toMatchObject({ scope: 'subject', period: 'term', entries: [] });
    expect(contentSchema('report_comments', 'draft').safeParse(empty).success).toBe(true);
    expect(finalIssues(empty)).toEqual(['entries tooFew']);
  });

  it('keeps marks consistent with the scope and the period in final', () => {
    // A skill exactly for learning skills; a rating only with a skill.
    expect(finalIssues(bank({ entries: [entry({ skill: 'initiative' })] }))).toEqual([
      'entries.0.skill invalid',
    ]);
    expect(finalIssues(bank({ scope: 'learning_skills' }))).toEqual(['entries.0.skill invalid']);
    expect(
      finalIssues(
        bank({
          scope: 'learning_skills',
          entries: [entry({ skill: 'collaboration', rating: 'excellent' })],
        }),
      ),
    ).toEqual([]);
    expect(finalIssues(bank({ entries: [entry({ rating: 'good' })] }))).toEqual([
      'entries.0.rating invalid',
    ]);
    // Levels for a term report, progress marks for a progress report, both for « Les deux ».
    expect(finalIssues(bank({ period: 'progress', entries: [entry({ level: 3 })] }))).toEqual([
      'entries.0.level invalid',
    ]);
    expect(finalIssues(bank({ entries: [entry({ progress: 'well' })] }))).toEqual([
      'entries.0.progress invalid',
    ]);
    expect(
      finalIssues(bank({ period: 'any', entries: [entry({ level: 2, progress: 'well' })] })),
    ).toEqual([]);
    expect(finalIssues(bank({ entries: [entry({ level: 5 })] }))).toEqual([
      'entries.0.level tooLarge',
    ]);
  });

  it('allows only {prénom} between braces, and no curriculum code in a text', () => {
    expect(finalIssues(bank({ entries: [entry({ neutral: '{nom} lit bien.' })] }))).toEqual([
      'entries.0.neutral placeholder',
    ]);
    expect(finalIssues(bank({ entries: [entry({ feminine: '{prénom lit bien.' })] }))).toEqual([
      'entries.0.feminine placeholder',
    ]);
    expect(
      finalIssues(bank({ entries: [entry({ masculine: '{prénom} réussit B1.2 et B2.5.' })] })),
    ).toEqual(['entries.0.masculine codeInText']);
    expect(hasStrayPlaceholder(`${FIRST_NAME_TOKEN} et ${FIRST_NAME_TOKEN}`)).toBe(false);
    expect(hasStrayPlaceholder('[prénom]')).toBe(false);
    expect(hasCurriculumCode('Selon l’attente C1.3, …')).toBe(true);
    expect(hasCurriculumCode('Elle compte jusqu’à 1.5 litre.')).toBe(false);
    // A neutral text is required; feminine and masculine are not; 400 characters at most.
    expect(finalIssues(bank({ entries: [entry({ neutral: ' ' })] }))).toEqual([
      'entries.0.neutral required',
    ]);
    expect(finalIssues(bank({ entries: [entry({ neutral: 'x'.repeat(401) })] }))).toEqual([
      'entries.0.neutral tooLong',
    ]);
  });

  it('indexes the texts, never the machine values', () => {
    const { content } = sampleCanonical('report_comments');
    const strings = frenchStrings('report_comments', content);
    expect(strings).toContain(content.entries[0]!.neutral);
    for (const value of ['subject', 'term', 'strength', 'B1.2']) {
      expect(strings, value).not.toContain(value);
    }
  });
});

describe('comment bank: {prénom} and elision (D-131)', () => {
  it('elides before a vowel, a mute H and Y followed by a consonant', () => {
    for (const name of ['Aïcha', 'Olivier', 'Emma', 'Édouard', 'Hugo', 'Yves', 'Ugo', 'Œlla']) {
      expect(elidesBefore(name), name).toBe(true);
    }
    for (const name of ['Youssef', 'Yann', 'Samuel', 'Zoé', 'Léa', '', '-']) {
      expect(elidesBefore(name), name).toBe(false);
    }
  });

  it('fills the name, eliding « de », « que », « lorsque » and « puisque »', () => {
    const fill = (template: string, name: string) => fillComment(template, name);
    expect(fill('Les idées de {prénom} sont claires.', 'Aïcha')).toBe(
      'Les idées d’Aïcha sont claires.',
    );
    expect(fill('Le travail de {prénom} progresse.', 'Hugo')).toBe('Le travail d’Hugo progresse.');
    expect(fill('Le travail de {prénom} progresse.', 'Yves')).toBe('Le travail d’Yves progresse.');
    expect(fill('Le travail de {prénom} progresse.', 'Youssef')).toBe(
      'Le travail de Youssef progresse.',
    );
    expect(fill('Le travail de {prénom} progresse.', 'Samuel')).toBe(
      'Le travail de Samuel progresse.',
    );
    expect(fill('Il faut que {prénom} relise.', 'Olivier')).toBe('Il faut qu’Olivier relise.');
    expect(fill('Lorsque {prénom} doute, elle demande.', 'Emma')).toBe(
      'Lorsqu’Emma doute, elle demande.',
    );
    expect(fill('Puisque {prénom} explique, tout va.', 'Édouard')).toBe(
      'Puisqu’Édouard explique, tout va.',
    );
    // A capital at the start of a sentence stays.
    expect(fill('De {prénom}, on retient la rigueur.', 'Aïcha')).toBe(
      'D’Aïcha, on retient la rigueur.',
    );
    // An elided article in the template comes back in full before a name that does not elide;
    // both apostrophes are read.
    expect(fill("Les efforts d'{prénom} paient.", 'Samuel')).toBe('Les efforts de Samuel paient.');
    expect(fill('Les efforts d’{prénom} paient.', 'Aïcha')).toBe('Les efforts d’Aïcha paient.');
    expect(fill('Qu’{prénom} continue!', 'Zoé')).toBe('Que Zoé continue!');
    // Every token, and words that only end like an article are left alone.
    expect(fill('{prénom} lit. Bravo, {prénom}!', 'Léa')).toBe('Léa lit. Bravo, Léa!');
    expect(fill('Jusque {prénom}', 'Aïcha')).toBe('Jusque Aïcha');
  });

  it('stores the template form and gives back the same text', () => {
    const texts: [string, string][] = [
      ['Les idées d’Aïcha sont claires. Aïcha relit.', 'Aïcha'],
      ["Les idées d'Aïcha sont claires.", 'Aïcha'],
      ['D’Aïcha, on retient la rigueur.', 'Aïcha'],
      ['Le travail de Youssef progresse; Youssef relit.', 'Youssef'],
      ['Il faut qu’Olivier relise, lorsqu’Olivier doute.', 'Olivier'],
      ['Samuel et Rose lisent une rose.', 'Rose'],
      ['Marie-Ève aide Marie.', 'Marie'],
    ];
    for (const [text, name] of texts) {
      const template = unfillComment(text, name);
      expect(template, text).not.toMatch(new RegExp(`(?<![\\p{L}-])${name}(?![\\p{L}-])`, 'u'));
      expect(fillComment(template, name), text).toBe(text);
    }
    expect(unfillComment('Les idées d’Aïcha et de Zoé.', 'Aïcha')).toBe(
      'Les idées d’{prénom} et de Zoé.',
    );
    // Another student's name stays; the name in lower case is a word, not the name.
    expect(unfillComment('Rose aide Léa à cueillir une rose.', 'Rose')).toBe(
      '{prénom} aide Léa à cueillir une rose.',
    );
    expect(unfillComment('Marie-Ève aide Marie.', 'Marie')).toBe('Marie-Ève aide {prénom}.');
    // A wrong elision is corrected on the way back (documented).
    expect(fillComment(unfillComment('Le travail de Aïcha.', 'Aïcha'), 'Aïcha')).toBe(
      'Le travail d’Aïcha.',
    );
    expect(unfillComment('Texte', '  ')).toBe('Texte');
  });

  it('stores every first name of the class in template form, in any case (post-MVP review)', () => {
    const lea = { id: '10000000-0000-4000-8000-000000000001', firstName: 'Léa' };
    const noah = { id: '20000000-0000-4000-8000-000000000002', firstName: 'Noah' };
    const rose = { id: '30000000-0000-4000-8000-000000000003', firstName: 'Rose' };
    const marieEve = { id: '40000000-0000-4000-8000-000000000004', firstName: 'Marie-Ève' };
    const marie = { id: '50000000-0000-4000-8000-000000000005', firstName: 'Marie' };
    const aicha = { id: '60000000-0000-4000-8000-000000000006', firstName: 'Aïcha' };
    const roster = [lea, noah, rose, marieEve, marie, aicha];
    const unfill = (text: string, student = lea) => unfillDraftText(text, student, roster);
    // The student's own name without its accent, in capitals or in lower case.
    expect(unfill('Lea lit bien.')).toBe('{prénom} lit bien.');
    expect(unfill('LÉA lit bien.')).toBe('{prénom} lit bien.');
    expect(unfill('léa a oublié son livre.')).toBe('{prénom} a oublié son livre.');
    // A classmate's name is stored by a token of her id, never as typed.
    expect(unfill('Léa et Noah travaillent ensemble.')).toBe(
      `{prénom} et ${classmateToken(noah.id)} travaillent ensemble.`,
    );
    expect(unfill('Léa aide noah et AÏCHA.')).toBe(
      `{prénom} aide ${classmateToken(noah.id)} et ${classmateToken(aicha.id)}.`,
    );
    // The longest name first; a name that is a word in lower case stays a word.
    expect(unfill('Marie-Ève aide Marie, Marie Eve et une rose.', rose)).toBe(
      `${classmateToken(marieEve.id)} aide ${classmateToken(marie.id)}, ${classmateToken(marieEve.id)} et une rose.`,
    );
    expect(unfill('Rose cueille une rose.', rose)).toBe('{prénom} cueille une rose.');
    // Other names (a parent, a nickname) stay as typed.
    expect(unfill('La mère de Léa (Mme Diallo) a appelé; Lili rit.')).toBe(
      'La mère de {prénom} (Mme Diallo) a appelé; Lili rit.',
    );
    // Back with the roster's spelling, and the article elided for the student's own name.
    const template = unfill('Le travail de Aïcha aide Lea.', aicha);
    expect(template).toBe(`Le travail de {prénom} aide ${classmateToken(lea.id)}.`);
    expect(fillDraftText(template, 'Aïcha', roster)).toBe('Le travail d’Aïcha aide Léa.');
    // A correctly written comment comes back exactly as written.
    for (const text of [
      'Léa et Noah travaillent ensemble; d’Aïcha, on retient la rigueur.',
      'Marie-Ève aide Marie à cueillir une rose.',
    ]) {
      for (const student of roster) {
        expect(fillDraftText(unfill(text, student), student.firstName, roster), text).toBe(text);
      }
    }
    // A classmate who left the class: no name to put back.
    expect(fillDraftText(`Avec ${classmateToken(noah.id)}.`, 'Léa', [lea])).toBe(
      `Avec ${CLASSMATE_GONE}.`,
    );
  });

  it('clips a stored text without cutting a token in two', () => {
    expect(clipDraftText('abc', 10)).toBe('abc');
    expect(clipDraftText('Bravo {prénom}!', 8)).toBe('Bravo ');
    expect(clipDraftText('Bravo {prénom}!', 14)).toBe('Bravo {prénom}');
  });

  it('spells a loose placeholder and writes the article before it in full', () => {
    expect(normalizeCommentTemplate('{prenom}, {Prénom}, [prénom], { prénom }')).toBe(
      '{prénom}, {prénom}, {prénom}, {prénom}',
    );
    expect(normalizeCommentTemplate('Les efforts d’{prénom}; qu’{prénom}; Lorsqu’{prénom}')).toBe(
      'Les efforts de {prénom}; que {prénom}; Lorsque {prénom}',
    );
  });

  it('picks the wording, counts code points and copies with plain spaces', () => {
    const e = entry({ neutral: 'Neutre', feminine: 'Féminin', masculine: '  ' });
    expect(entryText(e, 'feminine')).toBe('Féminin');
    expect(entryText(e, 'masculine')).toBe('Neutre');
    expect(entryText(e, 'neutral')).toBe('Neutre');
    expect(commentLength('Élève')).toBe(5);
    expect(commentLength('Élève')).toBe(5);
    expect(commentLength('a\r\nb\nc')).toBe(5);
    expect(commentLength('😀')).toBe(1);
    expect(plainSpaces('Bravo : 1 000 $')).toBe('Bravo : 1 000 $');
  });
});

describe('comment bank: qualifiers of the achievement chart', () => {
  it('finds each level’s qualifier: the achievement chart’s, as rubrics have it (D-131)', () => {
    expect(REPORT_CARD_QUALIFIERS).toBe(ACHIEVEMENT_QUALIFIERS);
    expect(reportQualifierLevels('habiletes', 'avec une efficacité limitée')).toEqual([1]);
    expect(reportQualifierLevels('communication', 'avec une certaine efficacité')).toEqual([2]);
    expect(reportQualifierLevels('application', 'résout des problèmes avec efficacité')).toEqual([
      3,
    ]);
    expect(reportQualifierLevels('application', "avec beaucoup d'efficacité")).toEqual([4]);
    expect(reportQualifierLevels('communication', 'avec\u00a0une certaine efficacité')).toEqual([
      2,
    ]);
    expect(reportQualifierLevels('habiletes', 'sans qualificatif')).toEqual([]);
    expect(reportQualifierLevels('connaissance', 'une compréhension limitée')).toEqual([1]);
    expect(reportQualifierLevels('connaissance', 'une connaissance partielle')).toEqual([2]);
    expect(reportQualifierLevels('connaissance', 'une compréhension générale')).toEqual([3]);
    expect(reportQualifierLevels('connaissance', 'une connaissance approfondie')).toEqual([4]);
  });

  it('accepts « bonne compréhension » as level 3 for knowledge, for banks only', () => {
    expect(reportQualifierLevels('connaissance', 'une bonne compréhension')).toEqual([3]);
    expect(reportQualifierLevels('connaissance', 'de bonnes connaissances')).toEqual([3]);
    // Rubrics keep the chart's word.
    expect(qualifierLevels('connaissance', 'une bonne compréhension')).toEqual([]);
    // Only for knowledge, and only « bonne » before what is known.
    expect(reportQualifierLevels('habiletes', 'une bonne compréhension')).toEqual([]);
    expect(reportQualifierLevels('connaissance', 'une bonne idée')).toEqual([]);
  });

  it('flags an entry that uses another level’s qualifier', () => {
    expect(
      entryQualifierProblems(
        entry({
          level: 2,
          category: 'habiletes',
          neutral: '{prénom} résout avec beaucoup d’efficacité.',
        }),
      ),
    ).toEqual([{ field: 'neutral', foundLevel: 4 }]);
    expect(
      entryQualifierProblems(
        entry({
          level: 3,
          category: 'habiletes',
          neutral: '{prénom} résout avec efficacité.',
        }),
      ),
    ).toEqual([]);
    // Without a level or a category, nothing is checked.
    expect(
      entryQualifierProblems(
        entry({ category: 'habiletes', neutral: 'avec une efficacité limitée' }),
      ),
    ).toEqual([]);
  });
});

describe('comment bank: the AI shape, documents and readiness', () => {
  it('normalizes the placeholder and drops a wording that repeats the neutral one', () => {
    const content = normalizeAiContent('report_comments', {
      ...bank(),
      entries: [
        {
          ...entry(),
          neutral: "Les idées d'{prenom} sont claires.",
          feminine: 'Les idées d’{Prénom} sont claires.',
          masculine: 'Il est attentif.',
        },
      ],
    });
    expect(content.entries[0]).toMatchObject({
      neutral: 'Les idées de {prénom} sont claires.',
      feminine: '',
      masculine: 'Il est attentif.',
    });
  });

  it('renders a teacher document only, by attente, kind and level', () => {
    const { content } = sampleCanonical('report_comments');
    expect(renderStudentDoc('report_comments', content, { itemTitle: 'Banque', number: 1 })).toBe(
      null,
    );
    const text = docToPlainText(
      renderTeacherDoc({ itemTitle: 'Banque' }, 'report_comments', content),
    );
    expect(text).toContain('Banque de commentaires de bulletin');
    // A subject's bank: no « Pour : Une matière » (its subject is the item's).
    expect(text).not.toContain('Pour :');
    expect(text).toContain('Bulletin : Bulletin scolaire');
    expect(text.indexOf('Attente B1.2')).toBeLessThan(text.indexOf('Commentaires généraux'));
    expect(text.indexOf('Points forts')).toBeLessThan(text.indexOf('Prochaines étapes'));
    expect(text).toContain('Niveau 3 · Habiletés de la pensée : {prénom} compare');
    const skills = docToPlainText(
      renderTeacherDoc({ itemTitle: 'Habiletés' }, 'report_comments', {
        ...bank({
          scope: 'learning_skills',
          entries: [
            entry({ skill: 'collaboration', rating: 'good', feminine: 'Elle aide.' }),
            entry({ skill: 'responsibility', kind: 'next_step' }),
          ],
        }),
      }),
    );
    expect(skills.indexOf('Fiabilité')).toBeLessThan(skills.indexOf('Esprit de collaboration'));
    expect(skills).toContain('T — Très bien : {prénom} participe');
    expect(skills).toContain('Au féminin : Elle aide.');
  });

  const ready = (
    item: Partial<ReadinessInput['item']>,
    content: Record<string, unknown> = sampleCanonical('report_comments').content,
  ) =>
    reviewReadiness({
      item: {
        type: 'report_comments',
        gradeCodes: ['3'],
        subjectId: 'mat',
        subjectCode: 'mat',
        durationMinutes: null,
        materials: null,
        keywords: 'bulletin',
        tagIds: [],
        expectationIds: [],
        safetyNotes: null,
        subFriendly: false,
        ...item,
      },
      versions: [{ languageLevelId: null, content, answerKey: null }],
      boardLevelIds: [],
      forApproval: true,
    });
  const blocking = (r: ReturnType<typeof ready>) => r.blocking.map((b) => b.code);

  it('needs no duration, materials or attentes; the subject follows the scope', () => {
    expect(ready({}).ready).toBe(true);
    expect(ready({}).warnings).toEqual([]);
    expect(blocking(ready({ subjectId: null, subjectCode: null }))).toEqual(['subject']);
    const skills = bank({
      scope: 'learning_skills',
      entries: [entry({ skill: 'initiative', rating: 'excellent' })],
    });
    expect(blocking(ready({ subjectId: null, subjectCode: null }, skills))).toEqual([]);
    expect(blocking(ready({}, skills))).toEqual(['scope']);
    const religion = bank({ scope: 'religion' });
    expect(blocking(ready({ subjectId: 'ere', subjectCode: 'ere' }, religion))).toEqual([]);
    expect(blocking(ready({}, religion))).toEqual(['scope']);
    expect(blocking(ready({ subjectId: 'ere', subjectCode: 'ere' }))).toEqual(['scope']);
    // A caller that does not know the subject's code skips that part.
    expect(blocking(ready({ subjectCode: undefined }, religion))).toEqual([]);
  });

  it('warns about an entry with another level’s qualifier', () => {
    const wrong = bank({
      entries: [
        entry({ level: 1, category: 'communication', neutral: 'avec beaucoup d’efficacité' }),
      ],
    });
    expect(ready({}, wrong).warnings).toEqual([
      { code: 'qualifier', versionIndex: 0, path: ['entries', 0] },
    ]);
  });
});

describe('comment bank: seed and content packs', () => {
  const seed = (changes: Record<string, unknown> = {}) => ({
    slug: 'commentaires-habiletes-test',
    type: 'report_comments',
    title: 'Habiletés d’apprentissage',
    source: 'board_created',
    status: 'board_approved',
    shareScope: 'board',
    approvedBy: 'nathalie.roy@demo.lynx.test',
    gradeCodes: ['3', '5'],
    subjectCode: null,
    durationMinutes: null,
    keywords: 'bulletin',
    formats: { printable: true, projectable: false, interactive: false },
    versions: [
      {
        level: null,
        content: bank({
          scope: 'learning_skills',
          entries: [entry({ skill: 'organization', rating: 'excellent' })],
        }),
      },
    ],
    ...changes,
  });

  it('accepts a learning-skills bank without subject, duration or materials', () => {
    const parsed = seedItemSchema.safeParse(seed());
    expect(parsed.error?.issues ?? []).toEqual([]);
    const item = packItemFromSeed(parsed.data!, { curriculumVersions: {}, referenceTypes: {} });
    expect(item).toMatchObject({ subjectCode: null, durationMinutes: null, materials: '' });
    expect(contentPackItemSchema.safeParse(item).error?.issues ?? []).toEqual([]);
    expect(item.hash).toBe(itemHash(item));
    const sql = packToSql(
      {
        slug: 'test',
        version: '2026.1',
        title: 'Test',
        publisher: 'IP Lynx',
        board: 'csc-demo',
        items: ['commentaires-habiletes-test'],
      },
      [seed()],
      { curriculumVersions: {}, referenceTypes: {} },
    );
    expect(sql).toMatch(/v_pack, null, null, null,/);
    expect(sql).not.toContain('r_subject_');
  });

  it('refuses a missing subject elsewhere, and a duration on a bank', () => {
    const paths = (raw: unknown) =>
      (seedItemSchema.safeParse(raw).error?.issues ?? []).map(
        (i) => `${i.path.join('.')} ${i.message}`,
      );
    expect(paths(seed({ versions: [{ level: null, content: bank() }] }))).toEqual([
      'subjectCode required',
    ]);
    expect(paths(seed({ durationMinutes: 30 }))).toEqual(['durationMinutes notAllowed']);
    const item = packItemFromSeed(
      seedItemSchema.parse(
        seed({ subjectCode: 'mat', versions: [{ level: null, content: bank() }] }),
      ),
      { curriculumVersions: {}, referenceTypes: {} },
    );
    const { hash: _hash, ...rest } = { ...item, subjectCode: null };
    const withoutSubject = { ...rest, hash: itemHash(rest) };
    expect(
      (contentPackItemSchema.safeParse(withoutSubject).error?.issues ?? []).map((i) =>
        i.path.join('.'),
      ),
    ).toEqual(['subjectCode']);
  });
});
