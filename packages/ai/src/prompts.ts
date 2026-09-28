import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/** Versioned system prompts live in the repo: prompts/<feature>/<version>.md. */
export function defaultPromptsDir(): string {
  return process.env.PROMPTS_DIR ?? fileURLToPath(new URL('../../../prompts/', import.meta.url));
}

const cache = new Map<string, string>();

export async function loadPrompt(
  feature: string,
  version: string,
  dir = defaultPromptsDir(),
): Promise<string> {
  if (!/^[a-z_]+$/.test(feature) || !/^v\d+$/.test(version)) {
    throw new Error(`invalid prompt reference ${feature}/${version}`);
  }
  const file = path.join(dir, feature, `${version}.md`);
  const cached = cache.get(file);
  if (cached !== undefined) return cached;
  const text = (await readFile(file, 'utf8')).trim();
  cache.set(file, text);
  return text;
}
