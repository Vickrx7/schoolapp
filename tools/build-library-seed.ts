/**
 * Builds the SQL seeds of the demo database from their source files (DECISIONS D-030, D-071):
 *
 * - `content/curriculum/*.json` (the paraphrased curriculum sample, unverified) becomes
 *   `supabase/seeds/10_curriculum_demo.sql` (`curriculumToSql`);
 * - `content/library/demo` (pack.json plus items/<slug>.json) becomes
 *   `supabase/seeds/20_library_demo.sql`, one `DO` block that finds every reference by code and
 *   stops on anything missing (`packToSql`). Its items link to attentes of the curriculum sample,
 *   and record the hash a v1 pack of the folder gives them (`seed-pack-files.ts`, D-100).
 *
 * Both `supabase db reset` (config.toml `sql_paths`) and `tools/lite-stack/stack.sh reset` load
 * `supabase/seed.sql`, then `supabase/seeds/*.sql` in name order: the curriculum sample comes
 * before the library that links to it.
 *
 *   pnpm library:seed          regenerate both files after changing the curriculum or the pack
 *   pnpm library:seed:check    regenerate in memory and compare (CI fails on drift)
 *
 * Every JSON file of `content/curriculum` and of the pack's `items/` is read, listed in pack.json
 * or not, so a stray or missing file fails the build instead of silently staying out of the seed.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { curriculumToSql } from '../packages/content/src/curriculum-sql.ts';
import { packToSql } from '../packages/content/src/seed-sql.ts';
import { readSeedPackFolder, seedPackOptions } from './seed-pack-files.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The seeds of every development and CI database, in load order, with their generated file. The
 * file names keep them in that order after `supabase/seed.sql`.
 */
const SEEDS: { dir: string; out: string; build: (dir: string) => string }[] = [
  {
    dir: 'content/curriculum',
    out: 'supabase/seeds/10_curriculum_demo.sql',
    build: buildCurriculum,
  },
  { dir: 'content/library/demo', out: 'supabase/seeds/20_library_demo.sql', build: buildPack },
];

const check = process.argv.includes('--check');
const unknown = process.argv.slice(2).filter((arg) => arg !== '--check');
if (unknown.length) {
  console.error(`Unknown option ${unknown.join(' ')}. Usage: build-library-seed.ts [--check]`);
  process.exit(1);
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`${path.relative(root, file)}: ${(err as Error).message}`);
  }
}

/** The curriculum sample's SQL, from every file of the folder. */
function buildCurriculum(dir: string): string {
  const folder = path.join(root, dir);
  const files = readdirSync(folder)
    .filter((file) => file.endsWith('.json'))
    .sort();
  return curriculumToSql(files.map((name) => ({ name, json: readJson(path.join(folder, name)) })));
}

/** The pack's SQL, from pack.json and every item file of the pack. */
function buildPack(dir: string): string {
  const { pack, items } = readSeedPackFolder(root, dir);
  return packToSql(pack, items, seedPackOptions(root));
}

/** Where two texts first differ, for when `diff` is not available. */
function firstDifference(committed: string, generated: string): string {
  const a = committed.split('\n');
  const b = generated.split('\n');
  const line = a.findIndex((text, i) => text !== b[i]);
  const at = line === -1 ? a.length : line;
  return `first difference at line ${at + 1}`;
}

/** True when the committed file matches the pack; prints a diff otherwise. */
function matches(out: string, sql: string): boolean {
  const file = path.join(root, out);
  let committed: string;
  try {
    committed = readFileSync(file, 'utf8');
  } catch {
    console.error(`${out} is missing. Run \`pnpm library:seed\` and commit it.`);
    return false;
  }
  if (committed === sql) return true;

  const temp = mkdtempSync(path.join(tmpdir(), 'library-seed-'));
  try {
    const generated = path.join(temp, path.basename(out));
    writeFileSync(generated, sql);
    // The generated lines hold whole JSON documents, so keep the diff short.
    const diff = spawnSync('diff', ['-u', file, generated], { encoding: 'utf8' });
    const shown = diff.error
      ? firstDifference(committed, sql)
      : diff.stdout
          .split('\n')
          .slice(0, 40)
          .map((l) => (l.length > 200 ? `${l.slice(0, 200)}…` : l))
          .join('\n');
    console.error(`${out} does not match its source files:\n${shown}`);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
  console.error('Run `pnpm library:seed` and commit the result.');
  return false;
}

let ok = true;
for (const seed of SEEDS) {
  let sql: string;
  try {
    sql = seed.build(seed.dir);
  } catch (err) {
    console.error(`${seed.dir}: ${(err as Error).message}`);
    ok = false;
    continue;
  }
  if (check) {
    if (matches(seed.out, sql)) console.log(`${seed.out} is up to date.`);
    else ok = false;
  } else {
    writeFileSync(path.join(root, seed.out), sql);
    console.log(`Wrote ${seed.out} (${Buffer.byteLength(sql)} bytes).`);
  }
}
process.exit(ok ? 0 : 1);
