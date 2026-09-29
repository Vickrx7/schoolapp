import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sampleCanonical, sampleSafetyNotes } from './samples';
import { seedItemSchema } from './seed-pack';
import { packToSql, seedItemId, seedPackId, seedTagId, seedVersionId } from './seed-sql';
import { guillemets, NBSP } from './style';
import { LYNX_CONTENT_NAMESPACE, sha1, uuidv5 } from './uuid';

const pack = {
  slug: 'demo',
  version: '2026.1',
  title: 'Ressources de démonstration (à valider en classe)',
  publisher: 'IP Lynx',
  board: 'csc-demo',
  tags: [
    { slug: 'nombres', labelFr: 'Nombres' },
    { slug: 'creation', labelFr: 'Création' },
  ],
  items: ['quiz-nombres', 'prendre-soin-creation', 'eponges'],
};

function items() {
  const quiz = sampleCanonical('quiz');
  const reflection = sampleCanonical('catholic_reflection');
  const experiment = sampleCanonical('experiment');
  return [
    {
      slug: 'quiz-nombres',
      type: 'quiz',
      title: `Quiz${NBSP}: les nombres jusqu’à 1 000`,
      source: 'board_created',
      status: 'board_approved',
      shareScope: 'board',
      approvedBy: 'nathalie.roy@demo.lynx.test',
      gradeCodes: ['3'],
      subjectCode: 'mat',
      expectations: [{ grade: '3', code: 'B1.2' }],
      durationMinutes: 20,
      materials: 'Un crayon',
      tags: ['nombres'],
      formats: { printable: true, projectable: true, interactive: false },
      subFriendly: true,
      versions: [
        { level: null, content: quiz.content, answerKey: quiz.answerKey },
        { level: 'debutant', content: quiz.content, answerKey: quiz.answerKey },
      ],
    },
    {
      slug: 'prendre-soin-creation',
      type: 'catholic_reflection',
      title: 'Prendre soin de la création',
      summary: `Une réflexion sur ${guillemets('la création')}.`,
      source: 'teacher_created',
      author: 'isabelle.tremblay@demo.lynx.test',
      school: 'saint-exemple',
      status: 'teacher_reviewed',
      shareScope: 'school',
      gradeCodes: ['3', '4', '5'],
      subjectCode: 'ere',
      durationMinutes: 10,
      materials: 'Aucun matériel particulier',
      tags: ['creation'],
      formats: { printable: true, projectable: true, interactive: false },
      faithContent: true,
      faithOnStudentSheet: true,
      catholicConnection: 'Prendre soin de la nature, c’est dire merci pour la création.',
      catholicReference: 'Prendre soin de la création',
      versions: [{ level: null, content: reflection.content, answerKey: null }],
    },
    {
      slug: 'eponges',
      type: 'experiment',
      title: 'Éponges et élastiques',
      source: 'teacher_created',
      author: 'marc.gagnon@demo.lynx.test',
      status: 'teacher_reviewed',
      shareScope: 'private',
      reviewRequested: true,
      gradeCodes: ['5'],
      subjectCode: 'sci',
      expectations: [{ grade: '5', code: 'D2.1' }],
      durationMinutes: 45,
      materials: 'Éponges, élastiques sans latex',
      keywords: 'compression tension',
      formats: { printable: true, projectable: false, interactive: false },
      subFriendly: true,
      safetyNotes: sampleSafetyNotes(),
      versions: [{ level: null, content: experiment.content, answerKey: experiment.answerKey }],
    },
  ];
}

/** The same value with every object's keys in reverse order. */
function reversedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reversedKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([k, v]) => [k, reversedKeys(v)]),
    );
  }
  return value;
}

describe('uuid', () => {
  it('computes SHA-1 like node:crypto', () => {
    for (const text of ['', 'abc', 'demo/huard', 'Élève « é » 🦫', 'x'.repeat(1000)]) {
      const expected = createHash('sha1').update(text, 'utf8').digest('hex');
      const bytes = [...Buffer.from(text, 'utf8')];
      expect(Buffer.from(sha1(bytes)).toString('hex')).toBe(expected);
    }
  });

  it('computes RFC version 5 UUIDs', () => {
    // RFC 9562 appendix A.4.
    expect(uuidv5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(
      '2ed6657d-e927-568b-95e1-2665a8aea6a2',
    );
    expect(() => uuidv5('x', 'not-a-uuid')).toThrow();
  });
});

describe('seed-sql', () => {
  it('parses the fixture items', () => {
    for (const item of items()) {
      const parsed = seedItemSchema.safeParse(item);
      expect(parsed.error?.issues ?? [], item.slug).toEqual([]);
    }
  });

  it('56. packToSql is deterministic and uses stable UUIDv5 ids', () => {
    const sql = packToSql(pack, items());
    expect(packToSql(pack, items())).toBe(sql);
    // Key order in the files doesn't matter.
    expect(packToSql(reversedKeys(pack), items().map(reversedKeys))).toBe(sql);

    // Stable ids: these values must never change (seeds and links refer to them).
    expect(LYNX_CONTENT_NAMESPACE).toBe('27873b78-e429-4600-bbba-25cc5d75ab11');
    expect(seedItemId('demo', 'quiz-nombres')).toBe(uuidv5('demo/quiz-nombres'));
    expect(seedItemId('demo', 'ordonner-nombres-1000')).toBe(
      '191569be-69c6-5fc4-beeb-b9fd92bb45c8',
    );
    expect(seedVersionId('demo', 'quiz-nombres', null)).toBe(uuidv5('demo/quiz-nombres/base'));
    expect(seedVersionId('demo', 'quiz-nombres', 'debutant')).toBe(
      uuidv5('demo/quiz-nombres/debutant'),
    );
    for (const id of [
      seedItemId('demo', 'quiz-nombres'),
      seedItemId('demo', 'eponges'),
      seedVersionId('demo', 'quiz-nombres', 'debutant'),
      seedPackId('demo', '2026.1'),
      seedTagId('nombres'),
    ]) {
      expect(sql).toContain(`'${id}'`);
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });

  it('writes one DO block that resolves references by code and raises when one is missing', () => {
    const sql = packToSql(pack, items());
    expect(sql.split('\n')[0]).toMatch(/^-- Generated by `pnpm library:seed`/);
    expect(sql).toContain('do $lynxseed$');
    expect(sql.trimEnd().endsWith('end $lynxseed$;')).toBe(true);
    expect(sql.match(/\$lynxseed\$/g)).toHaveLength(2);
    expect(sql.match(/\$lynxpack\$/g)!.length % 2).toBe(0);
    expect(sql).toContain("select id into v_board from public.boards where slug = 'csc-demo';");
    for (const [kind, key] of [
      ['user', 'nathalie.roy@demo.lynx.test'],
      ['user', 'isabelle.tremblay@demo.lynx.test'],
      ['school', 'saint-exemple'],
      ['subject', 'ere'],
      ['expectation', 'sci 5 D2.1'],
      ['level', 'debutant'],
      ['reference', 'Prendre soin de la création'],
      ['tag', 'nombres'],
    ]) {
      expect(sql).toContain(`raise exception 'library seed: % not found: %', '${kind}', '${key}';`);
    }
    // Workflow state as the C1 constraints expect.
    expect(sql).toContain("'board_approved', 'board', 'board_created', null");
    expect(sql).toContain("'teacher_reviewed', 'school', 'teacher_created', r_user_2");
    expect(sql).toMatch(/now\(\), r_user_3,\n\s+null, null,\n\s+null, null\);/);
    expect(sql).toContain('insert into public.library_item_answer_keys');
    expect(sql).toContain(
      `perform app.library_refresh_search('${seedItemId('demo', 'eponges')}');`,
    );
    expect(sql).not.toContain('requires_faith_review');
  });

  it('refuses what the database would refuse, or a quote tag in the text', () => {
    const [quiz, reflection, experiment] = items();
    expect(() => packToSql(pack, [quiz, reflection])).toThrow(/missing eponges/);
    expect(() =>
      packToSql(pack, [quiz, reflection, experiment, { ...quiz, slug: 'autre' }]),
    ).toThrow(/extra autre/);
    expect(() => packToSql(pack, [{ ...quiz, tags: ['inconnu'] }, reflection, experiment])).toThrow(
      /unknown tag inconnu/,
    );
    expect(() =>
      packToSql(pack, [{ ...quiz, shareScope: 'school' }, reflection, experiment]),
    ).toThrow(/invalid item quiz-nombres/);
    expect(() =>
      packToSql(pack, [{ ...quiz, materials: 'Un $lynxpack$ piège' }, reflection, experiment]),
    ).toThrow(/quote tag/);
    // Faith content shared with the whole board needs its faith review.
    const board = {
      ...reflection,
      source: 'board_created',
      author: null,
      school: null,
      status: 'board_approved',
      shareScope: 'board',
      approvedBy: 'nathalie.roy@demo.lynx.test',
    };
    expect(seedItemSchema.safeParse(board).error!.issues.map((i) => i.message)).toEqual([
      'faithReviewRequired',
    ]);
    expect(seedItemSchema.safeParse({ ...board, faithReviewed: true }).success).toBe(true);
  });
});
