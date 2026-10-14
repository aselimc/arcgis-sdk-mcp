/**
 * Shared by the examples: shortens a tool result for a transcript that is printed or
 * committed. Esri's documentation prose is elided, so a committed transcript does not
 * reproduce Esri's text; what remains is structure, identifiers, URLs and attribution.
 */

/**
 * Shortens a tool result for the transcript and removes documentation prose, so the
 * transcript can be committed without reproducing Esri's text: the status line, notes,
 * headings, numbered hits, short list items, URLs, code (at most four lines per block) and
 * the `Next:` and `Source:` lines are kept; any other line becomes `[...]`. Long lines are
 * cut at 160 characters, and at most `maxLines` lines of the body are kept.
 */
export function trim(text: string, maxLines = 14): string {
  const out: string[] = [];
  let inFence = false;
  let fenceLines = 0;
  const elide = (): void => {
    if (out.at(-1)?.trim() !== '[...]') out.push('[...]');
  };
  const lines = text.split('\n');
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      inFence = !inFence;
      fenceLines = 0;
      out.push(line);
      continue;
    }
    if (inFence) {
      if (fenceLines++ < 4) out.push(line.length > 110 ? `${line.slice(0, 107)}...` : line);
      else if (fenceLines === 6) out.push('  [...]');
      continue;
    }
    const keep =
      index === 0 ||
      trimmed === '' ||
      /^(Note|Next|Source|Other matches|Outline|Installable|Install|Pre-release|Compatibility|Release notes|Documentation describes|Documentation lines)\b/.test(
        trimmed,
      ) ||
      /^#{1,4} /.test(trimmed) ||
      /^\d+\. /.test(trimmed) ||
      // Short list items (versions, packages, candidates) or items that carry a URL.
      (/^- /.test(trimmed) && (trimmed.length <= 100 || trimmed.includes('http'))) ||
      // Product list entries (`- js-maps-sdk: ...`): the summaries are this project's wording.
      /^- [a-z0-9][a-z0-9-]*: /.test(trimmed) ||
      /^(https?:\/\/|File:|In:|APIs:|_Web component_)/.test(trimmed);
    if (keep) out.push(line.length > 160 ? `${line.slice(0, 157)}...` : line);
    else elide();
  }
  // Keep the head of the body and always the closing Next/Source lines.
  const tail = out.filter((line) => /^(Next|Source):/.test(line));
  const body = out.filter((line) => !/^(Next|Source):/.test(line));
  while (body.length > 0 && body.at(-1)?.trim() === '') body.pop();
  const head = body.length > maxLines ? [...body.slice(0, maxLines), '[...]'] : body;
  return [...head, '', ...tail].join('\n');
}
