/**
 * Builds the SQL seed of the demo library from its content pack (DECISIONS D-071):
 * `content/library/demo` (pack.json plus items/<slug>.json) becomes
 * `supabase/seeds/20_library_demo.sql`, one `DO` block that finds every reference by code and
 * stops on anything missing. Both `supabase db reset` (config.toml `sql_paths`) and
 * `tools/lite-stack/stack.sh reset` load it after `supabase/seed.sql`.
 *
 *   pnpm library:seed          regenerate the SQL after changing the pack
 *   pnpm library:seed:check    regenerate into a temporary file and compare (CI fails on drift)
 *
 * Every JSON file in `items/` is read, listed in pack.json or not, so a stray or missing item
 * fails the build instead of silently staying out of the seed.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEED_ITEMS_DIR } from '../packages/content/src/seed-pack.ts';
import { packToSql } from '../packages/content/src/seed-sql.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The packs seeded into every development and CI database, with their generated file. */
const PACKS = [{ dir: 'content/library/demo', out: 'supabase/seeds/20_library_demo.sql' }];

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

/** The pack's SQL, from pack.json and every item file of the pack. */
function buildPack(dir: string): string {
  const packDir = path.join(root, dir);
  const itemsDir = path.join(packDir, SEED_ITEMS_DIR);
  const itemFiles = readdirSync(itemsDir)
    .filter((file) => file.endsWith('.json'))
    .sort();
  return packToSql(
    readJson(path.join(packDir, 'pack.json')),
    itemFiles.map((file) => readJson(path.join(itemsDir, file))),
  );
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
    console.error(`${out} does not match the content pack:\n${shown}`);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
  console.error('Run `pnpm library:seed` and commit the result.');
  return false;
}

let ok = true;
for (const pack of PACKS) {
  let sql: string;
  try {
    sql = buildPack(pack.dir);
  } catch (err) {
    console.error(`${pack.dir}: ${(err as Error).message}`);
    ok = false;
    continue;
  }
  if (check) {
    if (matches(pack.out, sql)) console.log(`${pack.out} is up to date.`);
    else ok = false;
  } else {
    writeFileSync(path.join(root, pack.out), sql);
    console.log(`Wrote ${pack.out} (${Buffer.byteLength(sql)} bytes).`);
  }
}
process.exit(ok ? 0 : 1);
