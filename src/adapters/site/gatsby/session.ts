/**
 * The requests of one adapter call. A session counts what it asks the gateway for, so that
 * an enumeration stays inside `maxEnumerateRequests` however many optional index files a
 * site turns out to have, and it remembers a refusal so a blocked host is not asked again.
 */
import { McpDocError, isMcpDocError } from '../../../core/errors.js';
import type { BoundSource, Ctx, HttpRequest, HttpResponse } from '../../../core/ports.js';
import type { TtlClass } from '../../../core/types.js';
import { budgetOf, continueWithout } from '../static.js';

/** Per-request options of a {@link GatsbySession}. */
export interface SessionRequest {
  ttl?: TtlClass;
  /**
   * Ask the gateway to revalidate instead of answering from its cache. Used once after a
   * hashed file has gone, when the cached page-data may still point at the old build.
   */
  fresh?: boolean;
}

/** Sent with a `fresh` request; a gateway that honours it revalidates the cached entry. */
const REVALIDATE = { 'Cache-Control': 'no-cache' } as const;

/** Counts and issues the upstream requests of one `enumerate`, `read` or `probe` call. */
export class GatsbySession {
  private used = 0;
  private refusal: McpDocError | undefined;

  constructor(
    readonly ctx: Ctx,
    readonly src: BoundSource<'gatsby'>,
    private readonly maxRequests: number,
  ) {}

  /** Requests this session may still issue. */
  remaining(): number {
    return Math.max(0, this.maxRequests - this.used);
  }

  /** True while site-published index files may be requested (design section 6.3). */
  indexFilesAllowed(): boolean {
    return this.ctx.policy.enabled('site-index');
  }

  /** A JSON file, parsed. */
  async json(
    url: string,
    options: SessionRequest = {},
  ): Promise<{ data: unknown; res: HttpResponse }> {
    this.spend(url);
    return this.guard(this.ctx.http.getJson({ ...this.request(url, options) }));
  }

  /** A sitemap or other XML file. */
  async xml(url: string, options: SessionRequest = {}): Promise<HttpResponse> {
    this.spend(url);
    return this.guard(this.ctx.http.get({ ...this.request(url, options), expect: 'xml' }));
  }

  /**
   * Runs work whose failure leaves a lower rung to answer from. Upstream failures are logged
   * and become `undefined`; a spent call budget and unexpected exceptions are rethrown, as
   * decided by `continueWithout`.
   */
  async optional<V>(what: string, work: () => Promise<V>): Promise<V | undefined> {
    try {
      return await work();
    } catch (error) {
      continueWithout(this.ctx, this.src, error, what);
      return undefined;
    }
  }

  private request(url: string, options: SessionRequest): Omit<HttpRequest, 'expect'> {
    return {
      url,
      ttl: options.ttl ?? 'index',
      ...(options.fresh === true ? { headers: { ...REVALIDATE } } : {}),
      ...budgetOf(this.src),
    };
  }

  /** Takes one request from the allowance, or fails the way a spent budget does. */
  private spend(url: string): void {
    const host = new URL(url).host;
    if (this.refusal !== undefined) throw this.refusal;
    if (this.used >= this.maxRequests) {
      throw new McpDocError('UPSTREAM_UNAVAILABLE', `Request allowance spent before ${url}`, {
        why: `One call may issue at most ${this.maxRequests} requests to a Gatsby site`,
        url,
        host,
        retryable: true,
      });
    }
    this.used += 1;
  }

  /** Remembers a 403 or 429: the host said no, so the rest of the call does not ask again. */
  private async guard<V>(pending: Promise<V>): Promise<V> {
    try {
      return await pending;
    } catch (error) {
      if (isMcpDocError(error) && error.code === 'UPSTREAM_BLOCKED') this.refusal = error;
      throw error;
    }
  }
}
