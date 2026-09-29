import { describe, expect, it } from 'vitest';
import { CLI_OPTIONS, parseCli } from '../args';
import { CliError, createContext } from '../context';
import { COMMAND_GROUPS, commands } from './index';

const PHASE_5 = [
  'coverage',
  'bulk-plan',
  'bulk-start',
  'bulk-status',
  'bulk-cancel',
  'bulk-report',
  'export-pack',
  'import-pack',
  'list-packs',
];

/** Phase 5 commands whose slice has landed (each tested in its own module). */
const AVAILABLE = new Set(['coverage']);

describe('admin commands', () => {
  it('lists the Phase 1–4 commands and the Phase 5 ones', () => {
    expect(Object.keys(commands)).toEqual(
      expect.arrayContaining([
        'create-board',
        'create-school',
        'create-year',
        'invite',
        'deactivate',
        'set-module',
        'set-ai-budget',
        'set-ai-board',
        'ai-usage',
        'set-library-reviewer',
        'list-library-reviewers',
        'import-curriculum',
        ...PHASE_5,
      ]),
    );
  });

  it('never registers one name in two modules', () => {
    const names = COMMAND_GROUPS.flatMap((group) => Object.keys(group));
    expect(new Set(names).size).toBe(names.length);
    expect(Object.keys(commands)).toHaveLength(names.length);
  });

  it.each(PHASE_5.filter((name) => !AVAILABLE.has(name)))(
    '%s says it is not available yet, without reading the settings or the database',
    async (name) => {
      // No environment is needed: the context reads it only when a command uses it.
      const ctx = createContext(parseCli([name]).values);
      await expect(commands[name]!(ctx)).rejects.toThrow(CliError);
      await expect(commands[name]!(ctx)).rejects.toThrow(/pas encore disponible/);
    },
  );
});

describe('admin options', () => {
  it('parse the Phase 5 command lines of the plan', () => {
    expect(
      parseCli([
        'bulk-plan',
        '--board',
        'csc-demo',
        '--grade',
        '3',
        '--subject',
        'mat',
        '--types',
        'worksheet,quiz',
        '--max-cost',
        '25',
        '--strand',
        'B',
        '--from-coverage',
        '2',
        '--levels',
        'all',
        '--per-expectation',
        '1',
        '--sub-friendly',
        '--note',
        'Automne',
      ]),
    ).toEqual({
      command: 'bulk-plan',
      values: {
        board: 'csc-demo',
        grade: '3',
        subject: 'mat',
        types: 'worksheet,quiz',
        'max-cost': '25',
        strand: 'B',
        'from-coverage': '2',
        levels: 'all',
        'per-expectation': '1',
        'sub-friendly': true,
        note: 'Automne',
      },
    });
    expect(
      parseCli([
        'export-pack',
        '--board',
        'csc-demo',
        '--slug',
        'lynx-fra-3e',
        '--version',
        '2026.2',
        '--title',
        'Ressources',
        '--publisher',
        'IP Lynx',
        '--licence',
        'Tous droits réservés',
        '--no-derivatives',
        '--include-teacher-items',
        '--include-pack-items',
        '--allow-names',
        'Marie,Joseph',
        '--out',
        'pack.json',
      ]).values,
    ).toMatchObject({
      version: '2026.2',
      'no-derivatives': true,
      'include-teacher-items': true,
      'include-pack-items': true,
      'allow-names': 'Marie,Joseph',
      out: 'pack.json',
    });
    expect(
      parseCli([
        'import-pack',
        '--board',
        'csc-demo',
        '--file',
        'pack.json',
        '--level-map',
        'debutant=debutant',
        '--apply',
        '--approve',
        '--approver',
        'nathalie.roy@demo.lynx.test',
      ]).values,
    ).toMatchObject({ 'level-map': 'debutant=debutant', apply: true, approve: true });
    expect(parseCli(['coverage', '--min', '2', '--csv', '--run', 'x']).values).toMatchObject({
      min: '2',
      csv: true,
      run: 'x',
    });
    expect(Object.keys(CLI_OPTIONS)).toEqual(expect.arrayContaining(['expectations']));
  });

  it('refuses an unknown option before anything runs', () => {
    expect(() => parseCli(['bulk-plan', '--max-costs', '25'])).toThrow(/max-costs/);
    expect(() => parseCli(['bulk-plan', 'extra'])).toThrow();
  });
});
