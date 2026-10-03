/**
 * Keeping parts of a system prompt (D-080). No dependencies: features use it, and the web server
 * imports features (`@lynx/ai/features/*`) but never the package root.
 */
const SECTION = /<!--\s*section:\s*([^\s>]+)\s*-->([\s\S]*?)<!--\s*end section\s*-->/g;

/**
 * A prompt with only some of its sections (D-080): the text outside
 * `<!-- section: name -->…<!-- end section -->` blocks is kept, as are the blocks named in
 * `keep` (without their markers); the others are removed. A library resource's prompt keeps its
 * common part and the section of the requested type only.
 */
export function selectPromptSections(prompt: string, keep: readonly string[]): string {
  const wanted = new Set(keep);
  return prompt
    .replace(SECTION, (_block: string, name: string, body: string) =>
      wanted.has(name) ? body.trim() : '',
    )
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
