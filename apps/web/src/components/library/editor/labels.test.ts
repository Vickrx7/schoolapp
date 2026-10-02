import {
  BUCKET_LABELS_FR,
  EDITOR_SPEC,
  LIBRARY_BUCKETS,
  LIBRARY_ITEM_TYPES,
  TYPE_INFO,
  solutionLabelKey,
  type FieldSpec,
  type KeyIssueCode,
  type ReadinessBlockingCode,
  type ReadinessWarningCode,
} from '@lynx/content';
import { describe, expect, it } from 'vitest';
import en from '../../../../messages/en-CA.json';
import fr from '../../../../messages/fr-CA.json';
import { SAVE_ERROR_KEYS } from '../../../server/library/save-payload';
import { listLimits, limitsOf } from './field-limits';

type Tree = { [key: string]: string | Tree };

function at(tree: Tree, path: string): string | Tree | undefined {
  let node: string | Tree | undefined = tree;
  for (const part of path.split('.')) {
    if (typeof node !== 'object') return undefined;
    node = node[part];
  }
  return node;
}

const LIST_KINDS: readonly FieldSpec['kind'][] = ['stringList', 'objectList'];

/** Every field spec of every type, with its type. */
function allSpecs(): { type: string; spec: FieldSpec }[] {
  const out: { type: string; spec: FieldSpec }[] = [];
  const walk = (type: string, specs: readonly FieldSpec[]) => {
    for (const spec of specs) {
      out.push({ type, spec });
      if (spec.fields) walk(type, spec.fields);
    }
  };
  for (const type of LIBRARY_ITEM_TYPES) walk(type, EDITOR_SPEC[type]);
  return out;
}

// Every code the editor can show, kept complete by the types.
const KEY_ISSUES: Record<KeyIssueCode, true> = {
  duplicateQuestionId: true,
  duplicateOptionId: true,
  missingAnswer: true,
  unknownQuestion: true,
  duplicateAnswer: true,
  wrongKind: true,
  noCorrectChoice: true,
  unknownChoice: true,
  duplicateChoice: true,
  tooManyCorrect: true,
  unknownLeft: true,
  unknownRight: true,
  duplicateLeft: true,
  duplicateRight: true,
  unpairedLeft: true,
  notPermutation: true,
  orderGivesAnswer: true,
};
const BLOCKING: Record<ReadinessBlockingCode, true> = {
  grades: true,
  subject: true,
  duration: true,
  materials: true,
  tags: true,
  base: true,
  expectations: true,
  key: true,
  safety: true,
  content: true,
  levels: true,
};
const WARNINGS: Record<ReadinessWarningCode, true> = {
  sampleAnswer: true,
  subNotes: true,
  baseOnly: true,
};

describe('library labels', () => {
  it('names the types and categories as the catalogue does', () => {
    for (const type of LIBRARY_ITEM_TYPES) {
      expect(fr.libraryCommon.types[type], type).toBe(TYPE_INFO[type].labelFr);
      expect(en.libraryCommon.typeHints[type], type).toBeTruthy();
    }
    for (const bucket of LIBRARY_BUCKETS) {
      expect(fr.libraryCommon.buckets[bucket]).toBe(BUCKET_LABELS_FR[bucket]);
    }
  });

  it('labels every field of every type’s editor, in both languages', () => {
    for (const messages of [fr, en]) {
      const edit = messages.libraryEdit as unknown as Tree;
      for (const { type, spec } of allSpecs()) {
        const node = at(edit, spec.labelKey);
        const label = typeof node === 'object' ? node._label : node;
        expect(typeof label, `${type} ${spec.labelKey}`).toBe('string');
        // A list or a group has its fields' labels under the same key.
        if (spec.fields?.length || LIST_KINDS.includes(spec.kind)) {
          expect(typeof node, `${type} ${spec.labelKey} (object)`).toBe('object');
        }
        if (LIST_KINDS.includes(spec.kind)) {
          expect(typeof at(edit, `${spec.labelKey}._item`), `${spec.labelKey}._item`).toBe(
            'string',
          );
          expect(typeof at(edit, `${spec.labelKey}._add`), `${spec.labelKey}._add`).toBe('string');
        }
        if (spec.kind === 'select' && spec.optionsKey !== 'categories') {
          for (const option of spec.options ?? []) {
            const key = `options.${spec.optionsKey}.${option}`;
            expect(typeof at(edit, key), `${type} ${key}`).toBe('string');
          }
        }
      }
      for (const type of LIBRARY_ITEM_TYPES) {
        const key = solutionLabelKey(type);
        if (key) expect(typeof at(edit, key), `${type} ${key}`).toBe('string');
      }
      for (const set of ['mat', 'default']) {
        for (const phase of ['opening', 'development', 'closing']) {
          expect(typeof at(edit, `phases.${set}.${phase}`)).toBe('string');
        }
      }
    }
  });

  it('explains every error a save or a check can give', () => {
    for (const messages of [fr, en]) {
      const errors = messages.libraryEdit.errors as Record<string, string>;
      for (const key of [...SAVE_ERROR_KEYS, ...Object.keys(KEY_ISSUES)]) {
        expect(errors[key], key).toBeTruthy();
      }
      const readiness = messages.libraryEdit.readiness;
      for (const code of Object.keys(BLOCKING)) {
        expect((readiness.checks as Record<string, string>)[code], code).toBeTruthy();
        expect((messages.errors.readiness as Record<string, string>)[code], code).toBeTruthy();
      }
      for (const code of Object.keys(WARNINGS)) {
        expect((readiness.warnings as Record<string, string>)[code], code).toBeTruthy();
      }
    }
  });

  it('keeps French typography in the editor’s messages', () => {
    const strings: string[] = [];
    const collect = (node: string | Tree) => {
      if (typeof node === 'string') strings.push(node);
      else Object.values(node).forEach(collect);
    };
    collect({ ...fr.libraryEdit, ...fr.libraryReview, ...fr.libraryPlanning } as unknown as Tree);
    for (const text of strings) {
      expect(text, text).not.toMatch(/'/);
      // A no-break space inside « » (tools/i18n/typography.mjs).
      expect(text, text).not.toMatch(/«(?!\u00a0)|(?<!\u00a0)»/);
    }
  });
});

describe('list sizes in the editor', () => {
  it('reads each list’s bounds from the schemas', () => {
    expect(limitsOf('quiz', 'questions')).toMatchObject({ min: 1, max: 30 });
    expect(limitsOf('exit_ticket', 'questions')).toMatchObject({ min: 1, max: 3 });
    expect(limitsOf('unit_test', 'sections.questions')).toMatchObject({ min: 1, max: 30 });
    expect(limitsOf('rubric', 'criteria')).toMatchObject({ min: 4, max: 16 });
    expect(limitsOf('lesson_plan', 'opening')).toMatchObject({ min: 1, max: 8 });
    expect(limitsOf('parent_guide', 'fr.learning')).toMatchObject({ min: 1, max: 6 });
    expect(limitsOf('lesson_plan', 'successCriteria')).toMatchObject({
      min: 0,
      max: 8,
      itemMaxLength: 300,
    });
    // Every list field of every type has bounds.
    for (const type of LIBRARY_ITEM_TYPES) {
      const limits = listLimits(type);
      const walk = (specs: readonly FieldSpec[], prefix: string) => {
        for (const spec of specs) {
          const key = prefix ? `${prefix}.${spec.path}` : spec.path;
          if (['stringList', 'objectList', 'questions', 'rubric'].includes(spec.kind)) {
            expect(limits.get(key), `${type} ${key}`).toBeDefined();
          }
          if (spec.fields) walk(spec.fields, key);
        }
      };
      walk(EDITOR_SPEC[type], '');
    }
  });
});
