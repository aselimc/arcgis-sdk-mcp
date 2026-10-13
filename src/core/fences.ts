/**
 * Code-fence tracking shared by everything that walks Markdown line by line. A heading, a
 * blank line or a table row inside a fence is code, not structure.
 */

/** Opening or closing fence line: up to three spaces, then three or more backticks or tildes. */
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/** The marker (for example three backticks) of the fence that is currently open. */
export type OpenFence = string | undefined;

/**
 * Advances fence tracking by one line.
 *
 * @param open the marker of the open fence before this line, or `undefined` outside a fence.
 * @returns `open` after the line, and `fenced`: whether the line is inside a fence or is one
 *   of its delimiter lines.
 */
export function stepFence(line: string, open: OpenFence): { open: OpenFence; fenced: boolean } {
  const match = FENCE_LINE.exec(line);
  const marker = match?.[1];
  if (open === undefined) {
    return marker === undefined
      ? { open: undefined, fenced: false }
      : { open: marker, fenced: true };
  }
  // CommonMark: a fence closes only on the same character, at least as long, with nothing after it.
  const closes =
    marker !== undefined &&
    marker.startsWith(open.charAt(0)) &&
    marker.length >= open.length &&
    (match?.[2] ?? '').trim() === '';
  return { open: closes ? undefined : open, fenced: true };
}
