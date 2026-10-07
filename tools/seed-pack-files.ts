/**
 * Reads a seed pack folder (`content/library/<pack>`: pack.json and items/<slug>.json) and the
 * facts a v1 pack needs that the seed format does not say (DECISIONS D-071, D-099):
 *
 * - the curriculum version of each subject, from the curriculum sample (`content/curriculum`),
 *   whose attentes the seed's items link to;
 * - the type of each Catholic reference, from `supabase/seed.sql`, which creates the references
 *   the seed's items name.
 *
 * Shared by `build-library-seed.ts` (the seed SQL records each item's pack hash) and
 * `build-pack.ts` (`pnpm library:pack`), so both compute the same hashes: importing the pack
 * later finds the seeded items unchanged.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type {
  CatholicReferenceType,
  SeedPackOptions,
} from '../packages/content/src/pack-format.ts';
import { CATHOLIC_REFERENCE_TYPES } from '../packages/content/src/pack-format.ts';
import { SEED_ITEMS_DIR } from '../packages/content/src/seed-pack.ts';

export function readJson(root: string, file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`${path.relative(root, file)}: ${(err as Error).message}`);
  }
}

/** pack.json and every item file of the folder (listed in pack.json or not). */
export function readSeedPackFolder(root: string, dir: string): { pack: unknown; items: unknown[] } {
  const packDir = path.resolve(root, dir);
  const itemsDir = path.join(packDir, SEED_ITEMS_DIR);
  const itemFiles = readdirSync(itemsDir)
    .filter((file) => file.endsWith('.json'))
    .sort();
  return {
    pack: readJson(root, path.join(packDir, 'pack.json')),
    items: itemFiles.map((file) => readJson(root, path.join(itemsDir, file))),
  };
}

/** Each subject's curriculum version, from the curriculum sample's files. */
export function curriculumVersions(root: string): Record<string, string> {
  const dir = path.join(root, 'content/curriculum');
  const versions: Record<string, string> = {};
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()) {
    const json = readJson(root, path.join(dir, file)) as {
      subjectCode?: unknown;
      curriculumVersion?: unknown;
    };
    if (typeof json.subjectCode !== 'string' || typeof json.curriculumVersion !== 'string') {
      throw new Error(`content/curriculum/${file}: no subjectCode or curriculumVersion`);
    }
    const known = versions[json.subjectCode];
    if (known && known !== json.curriculumVersion) {
      throw new Error(
        `content/curriculum: two curriculum versions for ${json.subjectCode} (${known}, ${json.curriculumVersion})`,
      );
    }
    versions[json.subjectCode] = json.curriculumVersion;
  }
  return versions;
}

/**
 * The type of each Catholic reference `supabase/seed.sql` creates, by title (rows of
 * `insert into public.catholic_references (board_id, type, title, …)`).
 */
export function referenceTypes(root: string): Record<string, CatholicReferenceType> {
  const sql = readFileSync(path.join(root, 'supabase/seed.sql'), 'utf8');
  const types = CATHOLIC_REFERENCE_TYPES.join('|');
  const row = new RegExp(`\\('[0-9a-f-]{36}', '(${types})', '((?:[^']|'')*)'`, 'g');
  const result: Record<string, CatholicReferenceType> = {};
  for (const m of sql.matchAll(row)) {
    result[m[2]!.replace(/''/g, "'")] = m[1] as CatholicReferenceType;
  }
  return result;
}

/** What `packItemFromSeed` and `packToSql` need for the demo seed's hashes. */
export function seedPackOptions(
  root: string,
): Pick<SeedPackOptions, 'curriculumVersions' | 'referenceTypes'> {
  return { curriculumVersions: curriculumVersions(root), referenceTypes: referenceTypes(root) };
}
