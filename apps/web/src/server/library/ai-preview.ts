/**
 * The « Vérifier avant d’envoyer » previews of the library's AI (DECISIONS D-038, D-072): the
 * exact text that would be sent, split so the names the redactor replaced (« Élève A ») stand
 * out. Pure, so it is unit-tested.
 */
import type { Segment } from '@lynx/ai/privacy';

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * `message` split around each placeholder of `replacements` (longest first, whole words only):
 * a placeholder's segment carries it, so the preview can highlight it.
 */
export function segmentMessage(
  message: string,
  replacements: readonly { placeholder: string }[],
): Segment[] {
  const placeholders = [...new Set(replacements.map((r) => r.placeholder))].sort(
    (a, b) => b.length - a.length,
  );
  if (!placeholders.length) return message ? [{ text: message }] : [];
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])(${placeholders.map(escapeRegExp).join('|')})(?![\\p{L}\\p{N}])`,
    'gu',
  );
  const segments: Segment[] = [];
  let last = 0;
  for (const m of message.matchAll(pattern)) {
    if (m.index > last) segments.push({ text: message.slice(last, m.index) });
    segments.push({ text: m[0], placeholder: m[0] });
    last = m.index + m[0].length;
  }
  if (last < message.length) segments.push({ text: message.slice(last) });
  return segments;
}
