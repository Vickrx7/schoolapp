/** A private-use character no message holds: it stands in for the value, to find it again. */
const MARK = '\u{E000}';

/**
 * The words of a translated message before and after one of its values, so the value can carry
 * its own language (`lang`) while the words around it stay in the interface's language (DECISIONS
 * D-090): « Explication : » then an English explanation, « Monter « » and « » » around an item
 * of an Anglais quiz. `format` formats the message with the stand-in it gets as the value. Without
 * the value in the message, everything is `before`.
 */
export function aroundValue(format: (value: string) => string): { before: string; after: string } {
  const message = format(MARK);
  const at = message.indexOf(MARK);
  if (at < 0) return { before: message, after: '' };
  return { before: message.slice(0, at), after: message.slice(at + MARK.length) };
}

/**
 * `aria-labelledby` for a control named by a message around a value: the ids of the parts that
 * hold words (the value's own element always).
 */
export function labelledByIds(
  parts: { before: string; after: string },
  ids: { before: string; value: string; after: string },
): string {
  return [parts.before.trim() ? ids.before : null, ids.value, parts.after.trim() ? ids.after : null]
    .filter(Boolean)
    .join(' ');
}
