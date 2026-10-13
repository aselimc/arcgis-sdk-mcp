/**
 * URL ownership (`Registry.ownerOf`): which product, source and version line a URL belongs
 * to. What a single source owns is defined once, by `ownedPrefix` in `src/core`; this module
 * picks the winner over the whole registry.
 */
import { ownedPrefix } from '../core/adapter-helpers.js';
import { sourceBaseUrls } from '../core/source-urls.js';
import type { AnySourceDef, Product, VersionLine } from '../core/types.js';

/** The answer of an ownership lookup. */
export interface Owner {
  product: Product;
  source: AnySourceDef;
  line: VersionLine;
}

const GITHUB_HOSTS = ['github.com', 'raw.githubusercontent.com'];

interface Claim extends Owner {
  /** Hosts on which this source can own a URL; lets a lookup skip almost every claim. */
  hosts: ReadonlySet<string>;
  /** Curated link lists yield to a source that documents the same page. */
  curated: boolean;
}

function hostsOf(source: AnySourceDef, line: VersionLine): Set<string> {
  if (source.adapter === 'github-repo' || source.adapter === 'xmldoc') return new Set(GITHUB_HOSTS);
  const hosts = new Set<string>();
  for (const base of sourceBaseUrls(source, line)) {
    if (URL.canParse(base)) hosts.add(new URL(base).hostname);
  }
  return hosts;
}

/**
 * Builds the ownership lookup over a product list.
 *
 * The owner of a URL is the source with the longest `ownedPrefix` over every product, source
 * and version line the source exists for. On equal prefixes the earlier product and source
 * win, and the current line wins over the others.
 *
 * One exception to "longest prefix": a `static` source lists individual pages, so its
 * prefix is a whole URL and would always be the longest. Such a list is a set of pointers,
 * often into another product's documentation (a tombstone's migration guides), so it owns a
 * URL only when no other source does.
 */
export function createOwnership(products: readonly Product[]): (url: URL) => Owner | undefined {
  const claims: Claim[] = [];
  for (const product of products) {
    // The current line goes first, so that it wins when two lines share a prefix.
    const lines = [...product.lines].sort((a, b) => Number(b.current) - Number(a.current));
    for (const source of product.sources) {
      for (const line of lines) {
        if (source.lines !== undefined && !source.lines.includes(line.id)) continue;
        const hosts = hostsOf(source, line);
        if (hosts.size === 0) continue;
        claims.push({ product, source, line, hosts, curated: source.adapter === 'static' });
      }
    }
  }

  return (url) => {
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
    const target = new URL(url.href);
    target.protocol = 'https:';
    target.hash = '';

    let best: { claim: Claim; length: number } | undefined;
    for (const claim of claims) {
      if (!claim.hosts.has(target.hostname)) continue;
      const length = ownedPrefix(claim.source, claim.line, target)?.length;
      if (length === undefined) continue;
      const better =
        best === undefined ||
        (best.claim.curated && !claim.curated) ||
        (best.claim.curated === claim.curated && length > best.length);
      if (better) best = { claim, length };
    }
    return best === undefined
      ? undefined
      : { product: best.claim.product, source: best.claim.source, line: best.claim.line };
  };
}
