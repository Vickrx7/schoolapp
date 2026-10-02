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

/** Phase 6: pilot operations (DECISIONS D-105, D-106, D-107, D-112). */
const PHASE_6 = ['set-retention', 'status', 'delete-user', 'delete-board', 'log-operator-access'];

/** Phase 5 and 6 commands whose slice has landed (each tested in its own module). */
const AVAILABLE = new Set([
  'coverage',
  'bulk-plan',
  'bulk-start',
  'bulk-status',
  'bulk-cancel',
  'bulk-report',
  'export-pack',
  'import-pack',
  'list-packs',
  'log-operator-access',
  'delete-user',
  'delete-board',
  'set-retention',
  'status',
]);

describe('admin commands', () => {
  it('lists the Phase 1–4 commands and the Phase 5 and 6 ones', () => {
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
        ...PHASE_6,
      ]),
    );
  });

  it('never registers one name in two modules', () => {
    const names = COMMAND_GROUPS.flatMap((group) => Object.keys(group));
    expect(new Set(names).size).toBe(names.length);
    expect(Object.keys(commands)).toHaveLength(names.length);
  });

  it.each([...PHASE_5, ...PHASE_6].filter((name) => !AVAILABLE.has(name)))(
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

  it('parse the Phase 6 command lines of the plan', () => {
    expect(
      parseCli(['set-retention', '--board', 'csc-demo', '--audit-days', '1095']).values,
    ).toEqual({ board: 'csc-demo', 'audit-days': '1095' });
    expect(
      parseCli([
        'set-retention',
        '--board',
        'csc-demo',
        '--sub-plan-days',
        '400',
        '--class-days',
        '365',
        '--ai-usage-days',
        '730',
        '--feedback-days',
        '365',
      ]).values,
    ).toMatchObject({
      'sub-plan-days': '400',
      'class-days': '365',
      'ai-usage-days': '730',
      'feedback-days': '365',
    });
    expect(
      parseCli(['log-operator-access', '--board', 'csc-demo', '--reason', 'support']).values,
    ).toEqual({ board: 'csc-demo', reason: 'support' });
    expect(
      parseCli(['delete-user', '--email', 'prof@conseil.ca', '--all-boards', '--yes']).values,
    ).toEqual({ email: 'prof@conseil.ca', 'all-boards': true, yes: true });
    expect(
      parseCli(['delete-board', '--board', 'csc-x', '--confirm', 'csc-x', '--exported', '--yes'])
        .values,
    ).toEqual({ board: 'csc-x', confirm: 'csc-x', exported: true, yes: true });
  });

  it('refuses an unknown option before anything runs', () => {
    expect(() => parseCli(['bulk-plan', '--max-costs', '25'])).toThrow(/max-costs/);
    expect(() => parseCli(['bulk-plan', 'extra'])).toThrow();
  });
});
