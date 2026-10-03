/**
 * Copying a comment to paste it into the board's report card system (DECISIONS D-130): the
 * browser's clipboard, which is not a request; when the browser refuses it, the text is selected
 * so the teacher copies it herself.
 */
export async function copyText(text: string, fallback?: HTMLTextAreaElement | null) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    if (!fallback) return false;
    fallback.focus();
    fallback.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    }
  }
}
