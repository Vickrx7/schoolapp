import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import en from '../../../messages/en-CA.json';
import fr from '../../../messages/fr-CA.json';
import { AUDIT_CATEGORIES, BOARD_CATEGORIES, DIRECTION_CATEGORIES } from './filters';

/**
 * The audit catalogue (DECISIONS D-103) against every migration: each action a migration writes
 * has a catalogue row (an action without one is shown to nobody), and each action someone may
 * read has its sentence in « Journal d'audit », in French and in English.
 *
 * Actions are collected inside every `app.log_audit(` … `)` call: every `'word.word'` literal
 * (which catches CASE-built actions), and every literal prefix joined to a variable
 * (`'library_bulk_run.' || p_status`), expanded with the values the same function allows for
 * that variable (`p_status not in ('completed', 'cancelled', 'failed')`). A prefix whose values
 * cannot be found fails the test, so a new dynamic action is never missed.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const migrationsDir = path.join(root, 'supabase/migrations');
const migrations = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((file) => ({
    file,
    sql: stripComments(readFileSync(path.join(migrationsDir, file), 'utf8')),
  }));

/** SQL without `--` comments (outside single-quoted strings). */
function stripComments(sql: string): string {
  let out = '';
  let quoted = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i]!;
    if (quoted) {
      out += c;
      if (c === "'") quoted = false; // '' (an escaped quote) closes and reopens: same result
      continue;
    }
    if (c === "'") {
      quoted = true;
      out += c;
      continue;
    }
    if (c === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    out += c;
  }
  return out;
}

/** The text of every `app.log_audit(…)` call, with where it starts. */
function logAuditCalls(sql: string): { start: number; text: string }[] {
  const calls: { start: number; text: string }[] = [];
  const marker = 'app.log_audit(';
  for (let i = sql.indexOf(marker); i !== -1; i = sql.indexOf(marker, i + 1)) {
    // Not the function's own definition.
    if (/create\s+(or\s+replace\s+)?function\s+$/i.test(sql.slice(Math.max(0, i - 40), i)))
      continue;
    let depth = 0;
    let j = i + marker.length - 1;
    for (; j < sql.length; j++) {
      if (sql[j] === '(') depth++;
      else if (sql[j] === ')' && --depth === 0) break;
    }
    calls.push({ start: i, text: sql.slice(i, j + 1) });
  }
  return calls;
}

/** The function (or DO block) around a position: from its `create … function` to its end. */
function enclosingBody(sql: string, at: number): string {
  const before = sql.slice(0, at);
  const starts = [...before.matchAll(/create\s+(?:or\s+replace\s+)?function\b|\bdo\s+\$/gi)];
  const start = starts.at(-1)?.index ?? 0;
  const end = sql.indexOf('$$;', at);
  return sql.slice(start, end === -1 ? sql.length : end);
}

const ACTION = /'([a-z_]+(?:\.[a-z_]+)+)'/g;
const DYNAMIC = /'([a-z_]+(?:\.[a-z_]+)*\.)'\s*\|\|\s*([a-z_][a-z0-9_]*)/g;

interface Found {
  actions: Map<string, Set<string>>;
  dynamic: { file: string; prefix: string; variable: string; values: string[] }[];
}

function writtenActions(): Found {
  const actions = new Map<string, Set<string>>();
  const dynamic: Found['dynamic'] = [];
  const add = (action: string, file: string) => {
    if (!actions.has(action)) actions.set(action, new Set());
    actions.get(action)!.add(file);
  };
  for (const { file, sql } of migrations) {
    for (const call of logAuditCalls(sql)) {
      for (const m of call.text.matchAll(ACTION)) add(m[1]!, file);
      for (const m of call.text.matchAll(DYNAMIC)) {
        const [, prefix, variable] = m as unknown as [string, string, string];
        const body = enclosingBody(sql, call.start);
        const list = new RegExp(`\\b${variable}\\s+(?:not\\s+)?in\\s*\\(([^)]*)\\)`, 'i').exec(
          body,
        );
        const values = list ? [...list[1]!.matchAll(/'([a-z_]+)'/g)].map((v) => v[1]!) : [];
        dynamic.push({ file, prefix, variable, values });
        for (const value of values) add(`${prefix}${value}`, file);
      }
    }
  }
  return { actions, dynamic };
}

type Row = { action: string; category: string; audience: string };

function catalogueRows(): Row[] {
  const rows: Row[] = [];
  for (const { sql } of migrations) {
    const insert = /insert\s+into\s+public\.audit_action_catalog\s*\([^)]*\)\s*values([\s\S]*?);/gi;
    for (const m of sql.matchAll(insert)) {
      for (const t of m[1]!.matchAll(/\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*\)/g)) {
        rows.push({ action: t[1]!, category: t[2]!, audience: t[3]! });
      }
    }
  }
  return rows;
}

type Tree = { [key: string]: string | Tree };

function message(catalog: Tree, key: string): string | undefined {
  let node: string | Tree | undefined = catalog;
  for (const part of key.split('.')) {
    node = typeof node === 'object' ? node[part] : undefined;
  }
  return typeof node === 'string' ? node : undefined;
}

function leafKeys(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([k, v]) =>
    typeof v === 'string' ? [`${prefix}${k}`] : leafKeys(v, `${prefix}${k}.`),
  );
}

const found = writtenActions();
const rows = catalogueRows();
const catalogue = new Map(rows.map((r) => [r.action, r]));
const readable = rows.filter((r) => r.audience !== 'operator');

describe('the audit catalogue (D-103)', () => {
  it('reads the migrations', () => {
    expect(migrations.length).toBeGreaterThan(30);
    expect(found.actions.size).toBeGreaterThan(50);
    expect(rows.length).toBeGreaterThan(50);
    expect(new Set(rows.map((r) => r.action)).size).toBe(rows.length);
  });

  it('expands the actions built from a status (library bulk runs)', () => {
    const bulk = found.dynamic.filter((d) => d.prefix === 'library_bulk_run.');
    expect(bulk.length).toBeGreaterThan(0);
    for (const d of bulk) {
      expect(d.variable).toBe('p_status');
      expect([...d.values].sort()).toEqual(['cancelled', 'completed', 'failed']);
    }
    for (const status of ['completed', 'cancelled', 'failed']) {
      expect(found.actions.has(`library_bulk_run.${status}`)).toBe(true);
    }
  });

  it('knows the values of every action built at run time', () => {
    for (const d of found.dynamic) {
      expect(d.values, `${d.file}: '${d.prefix}' || ${d.variable}`).not.toEqual([]);
    }
  });

  it('has a row for every action a migration writes', () => {
    const missing = [...found.actions.keys()].filter((a) => !catalogue.has(a));
    expect(missing).toEqual([]);
  });

  it('gives each action a known category and audience', () => {
    for (const row of rows) {
      expect(AUDIT_CATEGORIES, row.action).toContain(row.category);
      expect(['direction', 'direction_board', 'board', 'operator'], row.action).toContain(
        row.audience,
      );
    }
  });

  it('offers the direction and the board the categories they can read', () => {
    const categories = (audiences: string[]) =>
      [
        ...new Set(rows.filter((r) => audiences.includes(r.audience)).map((r) => r.category)),
      ].sort();
    expect([...DIRECTION_CATEGORIES].sort()).toEqual(categories(['direction', 'direction_board']));
    expect([...BOARD_CATEGORIES].sort()).toEqual(categories(['direction_board', 'board']));
  });

  it('has a sentence for every action someone may read, in French and in English', () => {
    for (const { action } of readable) {
      expect(message(fr as Tree, `audit.actions.${action}`), `fr ${action}`).toBeTruthy();
      expect(message(en as Tree, `audit.actions.${action}`), `en ${action}`).toBeTruthy();
    }
  });

  it('has no sentence for an action nobody may read, or that does not exist', () => {
    const readableActions = new Set(readable.map((r) => r.action));
    const keys = leafKeys((fr as unknown as { audit: { actions: Tree } }).audit.actions);
    expect(keys.filter((k) => !readableActions.has(k))).toEqual([]);
  });

  it('names every category in both languages', () => {
    for (const category of AUDIT_CATEGORIES) {
      expect(message(fr as Tree, `audit.categories.${category}`)).toBeTruthy();
      expect(message(en as Tree, `audit.categories.${category}`)).toBeTruthy();
    }
  });
});
