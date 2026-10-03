/**
 * Builds a content pack file (format v1, DECISIONS D-099) from a seed pack folder: every item of
 * the folder, keyed by its slug, with the hashes the seed recorded (`seed-pack-files.ts`). What
 * IP Lynx ships to an install hosted by a board, which imports it with `pnpm admin import-pack`.
 *
 *   pnpm library:pack --version 2026.2 --out dist/lynx-demo-2026.2.json
 *     [--licence "…"] [--no-derivatives] [--created-at 2026-11-01T12:00:00Z]
 *
 * (`library:pack` runs `tsx tools/build-pack.ts content/library/demo`; another folder can be given
 * first.) The file holds answer keys: it is confidential and never hosted publicly.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  packFromSeedDirectory,
  PACK_VERSION_PATTERN,
  validatePack,
} from '../packages/content/src/pack-format.ts';
import { readSeedPackFolder, seedPackOptions } from './seed-pack-files.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const usage =
  'Usage: tsx tools/build-pack.ts <pack folder> --version YYYY.N --out <file> ' +
  '[--licence "…"] [--no-derivatives] [--created-at <ISO date>]';

function fail(message: string): never {
  console.error(`${message}\n${usage}`);
  process.exit(1);
}

let parsed: ReturnType<typeof parse>;
function parse() {
  return parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    strict: true,
    options: {
      version: { type: 'string' },
      out: { type: 'string' },
      licence: { type: 'string' },
      'no-derivatives': { type: 'boolean' },
      'created-at': { type: 'string' },
    },
  });
}
try {
  parsed = parse();
} catch (err) {
  fail((err as Error).message);
}

const { values, positionals } = parsed;
const [dir, ...extra] = positionals;
if (!dir || extra.length) fail('Give one pack folder.');
if (!values.version || !PACK_VERSION_PATTERN.test(values.version)) {
  fail('--version must look like 2026.2 (a year, a dot and a number without a leading zero).');
}
if (!values.out) fail('--out is required.');
if (values.licence !== undefined && values.licence.length > 500) {
  fail('--licence has at most 500 characters.');
}

let text: string;
let itemCount: number;
try {
  const { pack: seed, items } = readSeedPackFolder(root, dir);
  const pack = packFromSeedDirectory(seed, items, {
    ...seedPackOptions(root),
    version: values.version,
    ...(values.licence !== undefined ? { licence: values.licence } : {}),
    ...(values['no-derivatives'] ? { noDerivatives: true } : {}),
    ...(values['created-at'] ? { createdAt: new Date(values['created-at']).toISOString() } : {}),
  });
  const { errors, warnings } = validatePack(pack);
  for (const w of warnings) console.warn(`warning: ${w.path || '(file)'}: ${w.message}`);
  if (errors.length) {
    for (const e of errors) console.error(`error: ${e.path || '(file)'}: ${e.message}`);
    process.exit(1);
  }
  text = `${JSON.stringify(pack, null, 2)}\n`;
  itemCount = pack.items.length;
} catch (err) {
  fail((err as Error).message);
}

// Relative to where the command was typed (pnpm runs scripts from the repository root).
const out = path.resolve(process.env.INIT_CWD ?? process.cwd(), values.out);
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, text);
const sha = createHash('sha256').update(text, 'utf8').digest('hex');
console.log(
  `Wrote ${values.out}: ${itemCount} items, ${Buffer.byteLength(text)} bytes, ` +
    `SHA-256 ${sha} (fingerprint ${sha.slice(0, 12)}).`,
);
console.log('The file holds answer keys: keep it confidential and never host it publicly.');
