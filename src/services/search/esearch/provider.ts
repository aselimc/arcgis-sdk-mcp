/**
 * The opt-in site-search provider (capability `site-search`, design section 6.4). It posts
 * to Esri's own search backend, one request at a time and at least a second apart, and
 * turns the answer into hits. It never throws: any failure means "no remote hits" and the
 * local indexes answer alone.
 */
import { humanizeSlug } from '../../../core/adapter-helpers.js';
import { budgetExhausted } from '../../../core/async.js';
import { isMcpDocError } from '../../../core/errors.js';
import type { CallOptions, Ctx, SearchProvider } from '../../../core/ports.js';
import type { DocKind, Product, SearchHit, VersionLine } from '../../../core/types.js';
import { canonicalize } from '../../../core/url.js';
import { stripHighlight } from '../excerpt.js';
import {
  ESEARCH_URL,
  MIN_RETRY_NUM,
  bodyJson,
  neverSearched,
  planRequest,
  sourceCovered,
  type EsearchPlan,
} from './request.js';

/** Minimum spacing between two requests. */
export const MIN_INTERVAL_MS = 1000;

/** Client timeout: the backend answers its own 10 s timeout as JSON after about 10.2 s. */
export const TIMEOUT_MS = 12_000;

/** Pause before the single retry. */
export const RETRY_DELAY_MS = 1500;

/** Consecutive failures after which the remote is skipped. */
const BREAKER_FAILURES = 3;

/** How long the remote is skipped once the breaker opens. */
const BREAKER_OPEN_MS = 5 * 60 * 1000;

/**
 * Error texts of deterministic request mistakes. Repeating such a request cannot succeed,
 * so it is never retried.
 */
const SYNTAX_SIGNATURES =
  /is not a function|No mapping found|Result window|index_not_found|Invalid json/i;

interface RawHit {
  score?: number;
  doc?: { url?: unknown; title?: unknown; description?: unknown };
  highlight?: { content?: unknown };
}

interface RawResponse {
  search?: { hits?: unknown };
  error?: { message?: string; detail?: string };
}

/** Options of {@link createEsearchProvider}. */
export interface EsearchProviderOptions {
  /** Waits `ms`; replaced in tests so that no real time passes. */
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Content type of a result, read from its URL: the meta fields are unreliable (research 4.1). */
export function kindFromUrl(url: string, fallback: DocKind): DocKind {
  const path = url.replace(/^https?:\/\/[^/]+/, '');
  if (/\/(?:release-notes|whats-new)\//.test(path)) return 'release-notes';
  if (/\/(?:sample-code|samples)\//.test(path)) return 'sample';
  if (path.includes('/tutorials/')) return 'tutorial';
  if (/\/(?:api-reference|references)\//.test(path)) return 'api';
  return fallback;
}

/** Canonical page URL of a result: no query string, no fragment. */
function pageUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  try {
    const url = new URL(canonicalize(raw));
    url.search = '';
    url.hash = '';
    return url.href;
  } catch {
    return undefined;
  }
}

/** Creates the provider. It is safe to create when the capability is off: it then returns no hits. */
export function createEsearchProvider(
  ctx: Ctx,
  options: EsearchProviderOptions = {},
): SearchProvider {
  const sleep = options.sleep ?? realSleep;
  let queue: Promise<unknown> = Promise.resolve();
  let lastRequestAt = Number.NEGATIVE_INFINITY;
  let failures = 0;
  let openUntil = 0;

  /** Runs `task` after every earlier one, at least {@link MIN_INTERVAL_MS} after the last request. */
  const serial = <V>(task: () => Promise<V>): Promise<V> => {
    const run = queue.then(async () => {
      const wait = lastRequestAt + MIN_INTERVAL_MS - ctx.clock.now();
      if (wait > 0) await sleep(wait);
      try {
        return await task();
      } finally {
        lastRequestAt = ctx.clock.now();
      }
    });
    queue = run.catch(() => undefined);
    return run;
  };

  const post = async (plan: EsearchPlan, call: CallOptions): Promise<RawHit[]> => {
    const { data } = await ctx.http.getJson<RawResponse>({
      url: ESEARCH_URL,
      method: 'POST',
      body: bodyJson(plan.body),
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      ttl: 'remote-search',
      timeoutMs: TIMEOUT_MS,
      budget: call.budget,
      ...(call.signal === undefined ? {} : { signal: call.signal }),
    });
    // HTTP 200 with an error object was seen in the past: success needs hits and no error.
    const hits = data.search?.hits;
    if (data.error !== undefined || !Array.isArray(hits)) {
      throw new Error(data.error?.detail ?? data.error?.message ?? 'response without search.hits');
    }
    return hits as RawHit[];
  };

  /** One request, retried once with half the page size when the failure looks transient. */
  const fetchHits = async (plan: EsearchPlan, call: CallOptions): Promise<RawHit[]> => {
    try {
      return await serial(() => post(plan, call));
    } catch (error) {
      const text = isMcpDocError(error)
        ? `${error.message} ${error.details?.why ?? ''}`
        : String(error);
      const transient = isMcpDocError(error)
        ? error.code === 'UPSTREAM_UNAVAILABLE' && error.details?.retryable !== false
        : false;
      if (!transient || SYNTAX_SIGNATURES.test(text) || budgetExhausted(call.budget, ctx.clock)) {
        throw error;
      }
      await sleep(RETRY_DELAY_MS);
      const num = Math.max(MIN_RETRY_NUM, Math.floor(plan.body.num / 2));
      return serial(() => post({ ...plan, body: { ...plan.body, num } }, call));
    }
  };

  const toHit = (raw: RawHit, product: Product, plan: EsearchPlan): SearchHit | undefined => {
    const url = pageUrl(raw.doc?.url);
    if (url === undefined) return undefined;
    if (plan.keep?.test(url) === false || plan.drop?.test(url) === true) return undefined;
    // An outer tree was searched: results from an excluded tree inside it are not usable.
    if (neverSearched(url)) return undefined;
    // The URL-prefix filter is a token phrase and over-matches; the registry decides ownership.
    const owner = ctx.registry.ownerOf(new URL(url));
    if (owner?.product.id !== product.id) return undefined;
    const snippets: unknown = raw.highlight?.content;
    const highlight: unknown = Array.isArray(snippets) ? snippets[0] : undefined;
    const description = raw.doc?.description;
    const excerpt =
      typeof highlight === 'string' && highlight.trim() !== ''
        ? stripHighlight(highlight)
        : typeof description === 'string' && description.trim() !== ''
          ? description.trim()
          : undefined;
    const title = raw.doc?.title;
    return {
      ref: url,
      title: typeof title === 'string' && title.trim() !== '' ? title.trim() : humanizeSlug(url),
      product: product.id,
      source: owner.source.id,
      line: owner.line.id,
      kind: kindFromUrl(url, owner.source.kinds[0] ?? 'guide'),
      ...(excerpt === undefined ? {} : { excerpt }),
      match: 'site',
      score: typeof raw.score === 'number' ? raw.score : 0,
      license: owner.source.license ?? product.licenseTier,
    };
  };

  const searchProduct = async (
    text: string,
    product: Product,
    line: VersionLine,
    limit: number,
    call: CallOptions,
  ): Promise<SearchHit[]> => {
    const plan = planRequest(product, line, text, limit);
    if ('skip' in plan) {
      ctx.logger.debug('site search skipped', { product: product.id, reason: plan.skip });
      return [];
    }
    if (ctx.clock.now() < openUntil) return [];
    try {
      const raw = await fetchHits(plan, call);
      failures = 0;
      const seen = new Set<string>();
      const hits: SearchHit[] = [];
      for (const entry of raw) {
        const hit = toHit(entry, product, plan);
        if (hit === undefined || seen.has(hit.ref)) continue;
        seen.add(hit.ref);
        hits.push(hit);
      }
      return hits;
    } catch (error) {
      failures += 1;
      if (failures >= BREAKER_FAILURES) openUntil = ctx.clock.now() + BREAKER_OPEN_MS;
      ctx.logger.warn('site search failed; local indexes answer alone', {
        product: product.id,
        error,
      });
      return [];
    }
  };

  return {
    id: 'site-search',
    async search(q, call) {
      if (!ctx.policy.enabled('site-search')) return [];
      const hits: SearchHit[] = [];
      for (const product of q.products) {
        let line: VersionLine;
        try {
          line = ctx.registry.line(product, q.line);
        } catch {
          line = ctx.registry.line(product);
        }
        hits.push(...(await searchProduct(q.text, product, line, q.limit, call)));
      }
      return hits.sort((a, b) => b.score - a.score);
    },
  };
}

/**
 * True when the provider is worth asking for this product: the capability is on, a request
 * can be built, and (for a search narrowed to some sources) at least one of them is covered.
 * Decides the reported search mode.
 */
export function coveredBySiteSearch(
  ctx: Ctx,
  product: Product,
  line: VersionLine,
  sources?: readonly string[],
): boolean {
  if (!ctx.policy.enabled('site-search')) return false;
  if ('skip' in planRequest(product, line, 'probe')) return false;
  return (
    sources === undefined ||
    product.sources.some(
      (source) => sources.includes(source.id) && sourceCovered(product, source, line),
    )
  );
}
