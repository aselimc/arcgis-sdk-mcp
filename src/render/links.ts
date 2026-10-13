/**
 * Makes the relative links of a Markdown document absolute, so that a link an agent reads in
 * a README is a ref it can pass straight back to `arcgis_docs_read`.
 */
import { stepFence, type OpenFence } from '../core/fences.js';
import { githubBlobToRaw, parseGithubUrl } from '../core/url.js';

const IMAGE = /\.(?:png|jpe?g|gif|svg|webp|bmp|ico)(?:[?#].*)?$/i;
/** Targets that are already absolute or are not paths: `https:`, `mailto:`, `//host`, `#id`. */
const NOT_RELATIVE = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;

/** Resolves one link target against the page URL; `undefined` when it must stay as written. */
function resolve(target: string, base: URL): string | undefined {
  if (target === '' || NOT_RELATIVE.test(target)) return undefined;
  const github = base.hostname === 'github.com' ? parseGithubUrl(base.href) : undefined;
  let resolved: URL;
  try {
    // A root-relative link in a repository file means the repository root, not the host root.
    resolved =
      target.startsWith('/') && github?.ref !== undefined
        ? new URL(`/${github.repo}/blob/${github.ref}${target}`, base)
        : new URL(target, base);
  } catch {
    return undefined;
  }
  // The blob URL of an image is an HTML page; the raw URL is the picture.
  if (github !== undefined && IMAGE.test(resolved.pathname)) {
    return githubBlobToRaw(resolved.href) ?? resolved.href;
  }
  return resolved.href;
}

function rewriteProse(text: string, base: URL): string {
  const swap = (target: string): string => resolve(target, base) ?? target;
  return (
    text
      // `[a](<path with spaces>)`: the target runs to the closing bracket.
      .replace(
        /(\]\(\s*<)([^>\n]+)(?=>)/g,
        (_whole, open: string, target: string) => `${open}${swap(target)}`,
      )
      .replace(
        /(\]\(\s*)([^)\s<]+)/g,
        (_whole, open: string, target: string) => `${open}${swap(target)}`,
      )
      .replace(
        /(\b(?:href|src)\s*=\s*)(["'])([^"']+)\2/gi,
        (_whole, attribute: string, quote: string, target: string) =>
          `${attribute}${quote}${swap(target)}${quote}`,
      )
  );
}

/**
 * Rewrites relative link and image targets to absolute URLs.
 *
 * Covered: inline links and images, reference definitions (`[id]: target`) and `href`/`src`
 * attributes of embedded HTML. Code fences and inline code spans are never touched. In a
 * GitHub file, links resolve to blob URLs and images to raw URLs. A base that is not an
 * http(s) URL (a brief) leaves the text unchanged.
 */
export function absolutizeLinks(markdown: string, baseUrl: string): string {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return markdown;
  }
  if (base.protocol !== 'http:' && base.protocol !== 'https:') return markdown;
  base.hash = '';

  let open: OpenFence;
  return markdown
    .split('\n')
    .map((line) => {
      const step = stepFence(line, open);
      open = step.open;
      if (step.fenced) return line;
      const definition = /^( {0,3}\[[^\]]+\]:\s*<?)([^\s>]+)(.*)$/.exec(line);
      if (definition !== null) {
        const [, head = '', target = '', tail = ''] = definition;
        return `${head}${resolve(target, base) ?? target}${tail}`;
      }
      // Odd-numbered pieces are inside backticks.
      return line
        .split(/(`+[^`]*`+)/)
        .map((piece, index) => (index % 2 === 1 ? piece : rewriteProse(piece, base)))
        .join('');
    })
    .join('\n');
}
