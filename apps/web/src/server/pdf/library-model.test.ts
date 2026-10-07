import { sampleCanonical } from '@lynx/content';
import { describe, expect, it } from 'vitest';
import {
  KEY_SENTINEL,
  LEVEL_NAMES,
  TEACHER_SENTINEL,
  libraryView,
  quizItem,
  studentSource,
  versionId,
  versionView,
} from './library-fixtures';
import {
  buildStudentPdfModel,
  buildTeacherPdfModel,
  libraryPdfFileName,
  libraryPdfHref,
  libraryPdfRequest,
  pdfFileSlug,
} from './library-model';

const ITEM = '60000000-0000-4000-8000-000000000001';

describe('buildStudentPdfModel', () => {
  it('prints each chosen version on its own pages, never a key, a teacher note or a level name', () => {
    const { item } = quizItem();
    const model = buildStudentPdfModel(studentSource(item), item.versions.length);
    expect(model.doc).toBe('student');
    expect(model.pages.map((p) => [p.key, p.doc.kind, p.doc.number])).toEqual(
      [1, 2, 3, 4, 5].map((n) => [versionId(n), 'student', n]),
    );
    const json = JSON.stringify(model);
    expect(json).not.toContain(KEY_SENTINEL);
    expect(json).not.toContain(TEACHER_SENTINEL);
    expect(json).not.toContain('Corrigé');
    for (const level of LEVEL_NAMES) expect(json).not.toContain(level);
    expect(model.info).toEqual({ title: 'Quiz : les nombres jusqu’à 1 000', language: 'fr-CA' });
    expect(model.fileName).toBe('quiz-les-nombres-jusqu-a-1-000-eleves.pdf');
    expect(model.partial).toBe(false);
    // Every question of the sheet, numbered from 1 on each version's pages.
    const numbers = model.pages[0]!.doc.blocks.flatMap((b) =>
      b.type === 'question' ? [b.number] : [],
    );
    expect(numbers).toEqual([1, 2, 3, 4, 5]);
  });

  it('names the versions printed when only some of them are', () => {
    const { item } = quizItem();
    const chosen = [item.versions[1]!, item.versions[3]!];
    const model = buildStudentPdfModel(studentSource(item, chosen), item.versions.length);
    expect(model.pages.map((p) => p.doc.number)).toEqual([2, 4]);
    expect(model.fileName).toBe('quiz-les-nombres-jusqu-a-1-000-eleves-v2-4.pdf');
  });

  it('has no page for a resource without a student sheet', () => {
    const { content } = sampleCanonical('lesson_plan');
    const item = libraryView('lesson_plan', {
      title: 'Trouver l’idée principale',
      versions: [versionView(1, content)],
    });
    const model = buildStudentPdfModel(studentSource(item), 1);
    expect(model.pages).toEqual([]);
    expect(model.partial).toBe(false);
  });

  it('skips a version that cannot be read and says so', () => {
    const { item } = quizItem();
    const unreadable = versionView(2, item.versions[1]!.content, 2);
    const model = buildStudentPdfModel(studentSource(item, [unreadable]), item.versions.length);
    expect(model.pages).toEqual([]);
    expect(model.partial).toBe(true);
  });

  it('prints the faith link for students only when the author chose so', () => {
    const { content } = sampleCanonical('worksheet');
    const faith = (onStudentSheet: boolean) =>
      libraryView('worksheet', {
        versions: [versionView(1, content)],
        faith: {
          content: true,
          connection: 'Prendre soin les uns des autres.',
          referenceId: null,
          referenceTitle: null,
          onStudentSheet,
          requiresReview: true,
          reviewed: false,
        },
      });
    const printed = (onStudentSheet: boolean) =>
      JSON.stringify(buildStudentPdfModel(studentSource(faith(onStudentSheet)), 1));
    expect(printed(false)).not.toContain('Prendre soin les uns des autres.');
    expect(printed(true)).toContain('Prendre soin les uns des autres.');
  });
});

describe('buildTeacherPdfModel', () => {
  it('prints the guide, then « Corrigé — version n » for each chosen version', () => {
    const { item, keys } = quizItem();
    const chosen = [item.versions[0]!, item.versions[2]!];
    const model = buildTeacherPdfModel(item, chosen, keys);
    expect(model.doc).toBe('teacher');
    expect(model.pages.map((p) => [p.key, p.doc.kind, p.doc.number, p.doc.title])).toEqual([
      [`${versionId(1)}:guide`, 'teacher', 1, 'Quiz : les nombres jusqu’à 1 000'],
      [`${versionId(1)}:key`, 'answerKey', 1, 'Corrigé — version 1'],
      [`${versionId(3)}:key`, 'answerKey', 3, 'Corrigé — version 3'],
    ]);
    const [guide, ...answerKeys] = model.pages;
    expect(JSON.stringify(guide)).toContain(TEACHER_SENTINEL);
    expect(JSON.stringify(guide)).not.toContain(KEY_SENTINEL);
    for (const page of answerKeys) expect(JSON.stringify(page)).toContain(KEY_SENTINEL);
    // The attentes are « à vérifier » on the teacher's copy (D-030); no level name anywhere.
    expect(JSON.stringify(guide)).toContain('(à vérifier)');
    for (const level of LEVEL_NAMES) expect(JSON.stringify(model)).not.toContain(level);
    expect(model.info.title).toBe('Quiz : les nombres jusqu’à 1 000 — Guide et corrigé');
    expect(model.fileName).toBe('quiz-les-nombres-jusqu-a-1-000-guide-corrige-v1-3.pdf');
  });

  it('numbers the answers like the questions of the student sheet', () => {
    const { item, keys } = quizItem();
    const questions = buildStudentPdfModel(studentSource(item), 5).pages.map((p) =>
      p.doc.blocks.flatMap((b) => (b.type === 'question' ? [b.number] : [])),
    );
    const answers = buildTeacherPdfModel(item, item.versions, keys)
      .pages.filter((p) => p.doc.kind === 'answerKey')
      .map((p) => p.doc.blocks.flatMap((b) => (b.type === 'answer' ? [b.number] : [])));
    expect(answers).toEqual(questions);
    expect(buildTeacherPdfModel(item, item.versions, keys).fileName).toBe(
      'quiz-les-nombres-jusqu-a-1-000-guide-corrige.pdf',
    );
  });

  it('prints only the guide of a resource that has no key', () => {
    const { content } = sampleCanonical('lesson_plan');
    const item = libraryView('lesson_plan', {
      title: 'Trouver l’idée principale',
      versions: [versionView(1, content)],
    });
    const model = buildTeacherPdfModel(item, item.versions, new Map());
    expect(model.pages.map((p) => p.doc.kind)).toEqual(['teacher']);
    expect(model.info.title).toBe('Trouver l’idée principale — Guide');
    expect(model.fileName).toBe('trouver-l-idee-principale-guide.pdf');
  });

  it('takes the guide from the first version that can be read', () => {
    const { item, keys } = quizItem();
    const unreadable = versionView(1, item.versions[0]!.content, 2);
    const model = buildTeacherPdfModel(item, [unreadable, item.versions[1]!], keys);
    expect(model.pages.map((p) => [p.doc.kind, p.doc.number])).toEqual([
      ['teacher', 2],
      ['answerKey', 2],
    ]);
    expect(model.partial).toBe(true);
  });
});

describe('the PDF route’s address', () => {
  const request = (query: string) =>
    libraryPdfRequest(new URL(`http://localhost/library/items/${ITEM}/pdf${query}`));

  it('reads the document and the versions, and refuses a document that does not exist', () => {
    expect(request('')).toEqual({ doc: 'student', versionIds: [] });
    expect(request('?doc=teacher')).toEqual({ doc: 'teacher', versionIds: [] });
    expect(request('?doc=answers')).toBeNull();
    expect(
      request(
        `?doc=student&v=${versionId(2)},nope,${versionId(3).toUpperCase()}&v=${versionId(2)}`,
      ),
    ).toEqual({ doc: 'student', versionIds: [versionId(2), versionId(3)] });
  });

  it('links to a document for some versions, dropping anything that is not an id', () => {
    expect(libraryPdfHref(ITEM, 'student')).toBe(`/library/items/${ITEM}/pdf?doc=student`);
    expect(libraryPdfHref(ITEM, 'teacher', [versionId(1), 'x', versionId(4)])).toBe(
      `/library/items/${ITEM}/pdf?doc=teacher&v=${versionId(1)},${versionId(4)}`,
    );
  });

  it('names files in lower-case ASCII, at most 60 characters before the document', () => {
    expect(pdfFileSlug('Le huard, oiseau des lacs')).toBe('le-huard-oiseau-des-lacs');
    expect(pdfFileSlug('Œuvres « du cœur » : Éponges & élastiques')).toBe(
      'oeuvres-du-coeur-eponges-elastiques',
    );
    expect(pdfFileSlug('« ? »')).toBe('ressource');
    const long = pdfFileSlug(
      'Défi de la semaine : le marché des fractions et des nombres décimaux',
    );
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(libraryPdfFileName('Chanson', 'eleves', null)).toBe('chanson-eleves.pdf');
    expect(libraryPdfFileName('Chanson', 'guide-corrige', [2])).toBe(
      'chanson-guide-corrige-v2.pdf',
    );
  });
});
