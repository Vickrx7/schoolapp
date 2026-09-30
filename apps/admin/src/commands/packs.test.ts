import { packItemFromSeed, seedItemSchema, type ContentPackItem } from '@lynx/content';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCli } from '../args';
import { CliError, createContext } from '../context';
import {
  exportText,
  findPeople,
  foldName,
  importReportSchema,
  importText,
  listText,
  packCommands,
  packError,
  parseAllowNames,
  parseCodes,
  parseLevelMap,
  warningText,
  type ImportReport,
} from './packs';

const itemsDir = new URL('../../../../content/library/demo/items/', import.meta.url);
function demoItem(slug: string): ContentPackItem {
  const seed = seedItemSchema.parse(
    JSON.parse(readFileSync(new URL(`${slug}.json`, itemsDir), 'utf8')),
  );
  return packItemFromSeed(seed, {
    curriculumVersions: { fra: 'fra-2023', mat: 'mat-2020', sci: 'sci-2022' },
    referenceTypes: { 'Prendre soin de la création': 'reflection' },
  });
}

describe('pack options', () => {
  it('--level-map pairs the pack’s level codes with the board’s', () => {
    expect(parseLevelMap(undefined)).toEqual({});
    expect(parseLevelMap('')).toEqual({});
    expect(parseLevelMap('debutant=niveau_1, avance = niveau_3,')).toEqual({
      debutant: 'niveau_1',
      avance: 'niveau_3',
    });
    for (const bad of ['debutant', 'debutant=', '=niveau_1', 'a=b=c', 'Débutant=debutant', 'x=y']) {
      expect(() => parseLevelMap(bad), bad).toThrow(CliError);
    }
    expect(() => parseLevelMap('debutant=a1,debutant=a2')).toThrow(/mapped twice/);
  });

  it('--allow-names lists words that are not people, each once', () => {
    expect(parseAllowNames(undefined)).toEqual([]);
    expect(parseAllowNames('Marie, Joseph,,Pierre , marie,  Jean   Baptiste')).toEqual([
      'Marie',
      'Joseph',
      'Pierre',
      'Jean Baptiste',
    ]);
    expect(parseAllowNames('Thérèse,therese')).toEqual(['Thérèse']);
    expect(() => parseAllowNames('x'.repeat(81))).toThrow(CliError);
    expect(foldName('  Thérèse  d’Avila ')).toBe('therese d’avila');
  });

  it('--grade and --subject take one code or a list', () => {
    expect(parseCodes('3', 'grade', /^(K1|K2|[1-8])$/)).toEqual(['3']);
    expect(parseCodes('3, 5,3', 'grade', /^(K1|K2|[1-8])$/)).toEqual(['3', '5']);
    expect(parseCodes(undefined, 'grade', /^(K1|K2|[1-8])$/)).toEqual([]);
    expect(() => parseCodes('9', 'grade', /^(K1|K2|[1-8])$/)).toThrow(/--grade: « 9 »/);
  });

  it('check every option before reaching the database', async () => {
    const run = (argv: string[]) => {
      const { command, values } = parseCli(argv);
      return packCommands[command!]!(createContext(values));
    };
    // No environment is needed: each fails before the settings or the database are read.
    await expect(run(['export-pack', '--board', 'csc-demo'])).rejects.toThrow(/--slug/);
    await expect(
      run(['export-pack', '--board', 'b', '--slug', 'Mon Paquet', '--version', '2026.1']),
    ).rejects.toThrow(/--slug/);
    await expect(
      run(['export-pack', '--board', 'b', '--slug', 'p', '--version', '2026.01']),
    ).rejects.toThrow(/--version/);
    await expect(
      run([
        'export-pack',
        ...['--board', 'b', '--slug', 'p', '--version', '2026.1', '--title', 'T'],
        ...['--publisher', 'IP Lynx', '--out', 'x.json', '--grade', '9'],
      ]),
    ).rejects.toThrow(/--grade/);
    await expect(
      run(['import-pack', '--board', 'b', '--file', 'x.json', '--level-map', 'a']),
    ).rejects.toThrow(/--level-map/);
    await expect(
      run(['import-pack', '--board', 'b', '--file', 'x.json', '--approve']),
    ).rejects.toThrow(/--approver/);
    await expect(
      run(['import-pack', '--board', 'b', '--file', 'x.json', '--approver', 'a@b.c']),
    ).rejects.toThrow(/goes with --approve/);
    await expect(run(['list-packs'])).rejects.toThrow(/--board/);
  });
});

describe('the export’s name check (D-099)', () => {
  const people = [
    { name: 'Léa', kind: 'student' as const },
    { name: 'Joseph', kind: 'student' as const },
    { name: 'Isabelle Tremblay', kind: 'staff' as const },
  ];

  it('finds a student’s first name or a staff member’s name in any text, content and key included', () => {
    const quiz = demoItem('quiz-nombres-1000');
    const version = quiz.versions[0]!;
    const content = version.content as { questions: { prompt: string }[] };
    const named: ContentPackItem = {
      ...quiz,
      summary: 'Préparé avec Mme Tremblay.',
      versions: [
        {
          ...version,
          content: {
            ...content,
            questions: content.questions.map((q, i) =>
              i === 1 ? { ...q, prompt: `Léa a 407 billes. ${q.prompt}` } : q,
            ),
          },
        },
      ],
    };
    const findings = findPeople([quiz, named], people, []);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ key: quiz.key, details: [] });
    expect(findings[0]!.names).toEqual(expect.arrayContaining(['Mme Tremblay', 'Léa']));
  });

  it('reports personal details, and skips the names the operator allowed', () => {
    const song = demoItem('chanson-des-centaines');
    const withPhone = { ...song, materials: 'Appelez Joseph au 613-555-1234.' };
    expect(findPeople([withPhone], people, [])).toEqual([
      { key: song.key, title: song.title, names: ['Joseph'], details: ['phone'] },
    ]);
    expect(findPeople([withPhone], people, ['joseph'])).toEqual([
      { key: song.key, title: song.title, names: [], details: ['phone'] },
    ]);
    expect(findPeople([{ ...song, materials: 'Saint Joseph' }], people, ['Joseph'])).toEqual([]);
  });
});

const REPORT: ImportReport = importReportSchema.parse({
  dryRun: true,
  pack: { slug: 'demo', version: '2026.2', title: 'Ressources', publisher: 'IP Lynx' },
  fileSha256: 'a'.repeat(64),
  approverOk: null,
  counts: {
    created: 1,
    updated: 1,
    unchanged: 1,
    changedNotApplied: 1,
    skippedModifiedLocally: 1,
    skippedUnresolved: 1,
    queued: 1,
    approved: 0,
    drafts: 1,
    notInPack: 2,
  },
  items: [
    {
      key: 'quiz-pret',
      type: 'quiz',
      title: 'Quiz prêt',
      outcome: 'create',
      status: 'teacher_reviewed',
      queued: true,
      approved: false,
      warnings: [],
    },
    {
      key: 'fiche',
      type: 'worksheet',
      title: 'Fiche',
      outcome: 'update',
      status: 'draft',
      queued: false,
      approved: false,
      warnings: ['levelSkipped:niveau_a', 'notReady:levels'],
    },
    {
      key: 'huard',
      type: 'reading_passage',
      title: 'Le huard',
      outcome: 'changed_not_applied',
      status: 'board_approved',
      queued: false,
      approved: false,
      warnings: [],
    },
    {
      key: 'eponges',
      type: 'experiment',
      title: 'Éponges',
      outcome: 'skipped_modified_locally',
      status: 'teacher_reviewed',
      queued: false,
      approved: false,
      warnings: [],
    },
    {
      key: 'inconnue',
      type: 'song',
      title: 'Inconnue',
      outcome: 'skipped_unresolved',
      status: null,
      queued: false,
      approved: false,
      warnings: ['subjectUnknown:zzz'],
    },
    {
      key: 'pareil',
      type: 'song',
      title: 'Pareil',
      outcome: 'unchanged',
      status: 'board_approved',
      queued: false,
      approved: false,
      warnings: [],
    },
  ],
  notInPack: ['ancienne-1', 'ancienne-2'],
  newTags: ['nouvelle'],
  droppedTags: [],
});

describe('pack reports', () => {
  it('the dry run says what --apply would do, item by item, without the unchanged ones', () => {
    const text = importText(REPORT, 'pack.json');
    expect(text).toMatch(/^Dry run: nothing was written/);
    expect(text).toContain('fingerprint aaaaaaaaaaaa');
    expect(text).toContain(
      '6 resources: 1 new, 1 updated, 1 unchanged, 1 changed but not applied, 1 modified here and kept, 1 skipped.',
    );
    expect(text).toMatch(/quiz-pret\s+new, waiting for approval\s+« Quiz prêt »/);
    expect(text).toMatch(/fiche\s+updated, draft/);
    expect(text).toContain('- version for level niveau_a skipped: the board has no such level');
    expect(text).toContain('- stays a draft: not ready for approval (levels)');
    expect(text).toMatch(/huard\s+changed, not applied/);
    expect(text).toMatch(/eponges\s+modified here, kept/);
    expect(text).toContain('- unknown subject zzz');
    expect(text).not.toContain('pareil');
    expect(text).toContain('Not in this version (kept as they are');
    expect(text).toContain('ancienne-1, ancienne-2');
    expect(text).toContain('« Changed, not applied »');
    expect(text).toContain('« Modified here, kept »');
    expect(text.trimEnd().endsWith('Run the same command with --apply to import it.')).toBe(true);

    const applied = importText({ ...REPORT, dryRun: false, approverOk: false }, 'pack.json');
    expect(applied).toMatch(/^Imported pack\.json:/);
    expect(applied).toContain('nothing would be approved');
    expect(applied).not.toContain('--apply');
  });

  it('an item deleted here is reported, never re-created, and older reports still parse', () => {
    const report = importReportSchema.parse({
      ...REPORT,
      counts: { ...REPORT.counts, created: 0, skippedDeletedLocally: 1 },
      items: [
        {
          key: 'jetee',
          type: 'worksheet',
          title: 'Fiche jetée',
          outcome: 'skipped_deleted_locally',
          status: null,
          queued: false,
          approved: false,
          warnings: [],
        },
      ],
    });
    const text = importText(report, 'pack.json');
    expect(text).toContain('1 deleted here and not re-created, ');
    expect(text).toMatch(/jetee\s+deleted here, not re-created\s+« Fiche jetée »/);
    expect(text).toContain('« Deleted here, not re-created »');
    // A report without the count (written before it existed) reads as none.
    expect(REPORT.counts.skippedDeletedLocally).toBe(0);
    expect(importText(REPORT, 'pack.json')).not.toContain('deleted here');
  });

  it('every warning of the database reads as a sentence', () => {
    for (const code of [
      'levelSkipped:x',
      'notReady:key',
      'expectationUnknown:mat-2020 3 B1.9',
      'referenceUnknown',
      'referenceAmbiguous',
      'tagDropped:x',
      'gradeUnknown:9',
      'subjectUnknown:x',
      'typeUnknown',
      'typeChanged',
      'baseMissing',
      'invalid',
      'approvalFaithReview',
      'approvalByReviewer',
    ]) {
      expect(warningText(code), code).not.toBe(code);
    }
    expect(warningText('autre')).toBe('autre');
  });

  it('the export says what was left out and why, and that the file is confidential', () => {
    const item = demoItem('chanson-des-centaines');
    const text = exportText({
      board: 'Conseil démo',
      out: 'pack.json',
      pack: {
        format: 'lynx-content-pack',
        formatVersion: 1,
        pack: {
          slug: 'demo',
          version: '2026.2',
          title: 'Ressources',
          publisher: 'IP Lynx',
          licence: '',
          noDerivatives: false,
          createdAt: '2026-11-01T12:00:00.000Z',
          contentSchemaVersion: 1,
        },
        levels: [],
        tags: [],
        catholicReferences: [],
        items: [item],
        checksum: 'b'.repeat(64),
      },
      bytes: 1234,
      sha256: 'c'.repeat(64),
      people: [{ key: 'k1', title: 'Titre', names: ['Léa'], details: ['phone'] }],
      invalid: [
        { key: 'k2', title: 'Autre', problems: [{ path: 'durationMinutes', message: 'tooLarge' }] },
      ],
      teacherItems: true,
    });
    expect(text).toMatch(/^Exported 1 resource of Conseil démo to pack\.json/);
    expect(text).toContain('fingerprint cccccccccccc');
    expect(text).toContain('k1  « Titre »: Léa, (phone)');
    expect(text).toContain('--allow-names');
    expect(text).toContain('k2  « Autre »: durationMinutes tooLarge');
    expect(text).toContain('--include-teacher-items adds resources written by teachers');
    expect(text).toContain('keep it confidential and never host it publicly');
  });

  it('list-packs prints each pack with its fingerprint and counts', () => {
    const text = listText('Conseil démo', [
      {
        slug: 'demo',
        version: '2026.1',
        title: 'Ressources de démonstration',
        publisher: 'IP Lynx',
        importedAt: '2026-09-29T10:00:00+00:00',
        itemCount: 78,
        items: 78,
        fileSha256: null,
        approvedBy: null,
        report: null,
      },
      {
        slug: 'demo',
        version: '2026.2',
        title: 'Ressources de démonstration',
        publisher: 'IP Lynx',
        importedAt: '2026-11-03T10:00:00+00:00',
        itemCount: 78,
        items: 1,
        fileSha256: 'd'.repeat(64),
        approvedBy: 'nathalie.roy@demo.lynx.test',
        report: { counts: { created: 0, updated: 1, unchanged: 76 }, changedNotApplied: ['huard'] },
      },
    ]);
    expect(text).toContain('Conseil démo: 2 content packs');
    expect(text).toMatch(/demo 2026\.1 .*imported 2026-09-29 {2}\(seed\)/);
    expect(text).toContain('fingerprint dddddddddddd');
    expect(text).toContain('0 new, 1 updated, 76 unchanged');
    expect(text).toContain('approved by nathalie.roy@demo.lynx.test');
    expect(text).toContain('changed, not applied: huard');
    expect(listText('Conseil vide', [])).toBe('Conseil vide: no content pack.');
  });

  it('the LXP errors of the database say what to do', () => {
    expect(packError({ code: 'LXP01', message: 'x' }, 'staging').message).toContain(
      'already applied',
    );
    expect(packError({ code: 'LXP02', message: 'x' }, 'staging').message).toContain(
      'later version',
    );
    expect(packError({ code: 'LXP04', message: 'x' }, 'import').message).toContain(
      'list-library-reviewers',
    );
    expect(packError({ code: 'LXP05', message: 'x' }, 'import').message).toContain('LXP05');
    expect(packError({ code: '42501', message: 'permission denied' }, 'import').message).toBe(
      'import: permission denied',
    );
  });
});
