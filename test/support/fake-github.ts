import { consumeBudget } from '../../src/core/async.js';
import { McpDocError } from '../../src/core/errors.js';
import type { Clock, GithubCallOptions, GithubClient, HttpResponse } from '../../src/core/ports.js';
import type { LicenseTier } from '../../src/core/types.js';
import { FakeClock } from './fake-clock.js';

/** One repository known to {@link FakeGithub}. */
export interface FakeRepo {
  /** Default `main`. */
  defaultBranch?: string;
  /** Default `apache-2.0`. */
  license?: LicenseTier;
  archived?: boolean;
  /** File contents by path, per ref. The key `*` serves any ref that has no entry of its own. */
  files?: Record<string, Record<string, string>>;
  /** Wiki pages by name (without `.md`). */
  wiki?: Record<string, string>;
  release?: { tag: string; publishedAt: string };
}

/** One call seen by the fake. */
export interface GithubCall {
  method: 'repoMeta' | 'tree' | 'raw' | 'wikiRaw' | 'latestRelease';
  repo: string;
  ref?: string;
  path?: string;
}

/**
 * An in-memory {@link GithubClient}. Unknown repositories, refs and paths answer
 * `DOC_NOT_FOUND`; `exhaustQuota()` makes the API-backed methods (`repoMeta`, `tree`,
 * `latestRelease`) answer `RATE_LIMITED_GITHUB` while raw content keeps working, as on GitHub.
 * Every call takes one request from `opts.budget` (the fake has no cache) and answers
 * `UPSTREAM_UNAVAILABLE` once that budget is spent, like the HTTP client.
 */
export class FakeGithub implements GithubClient {
  readonly calls: GithubCall[] = [];

  private readonly repos = new Map<string, FakeRepo>();
  private readonly clock: Clock;
  private authenticated = false;
  private remaining: number | undefined = 60;
  private resetAt: string | undefined;
  private down = false;

  constructor(repos: Record<string, FakeRepo> = {}, clock: Clock = new FakeClock()) {
    this.clock = clock;
    for (const [name, repo] of Object.entries(repos)) this.repos.set(name, repo);
  }

  /** Adds or replaces a repository. */
  addRepo(name: string, repo: FakeRepo): this {
    this.repos.set(name, repo);
    return this;
  }

  /** Simulates an exhausted API quota that resets at `resetAt` (ISO). */
  exhaustQuota(resetAt: string): this {
    this.remaining = 0;
    this.resetAt = resetAt;
    return this;
  }

  /** Restores the quota, optionally as an authenticated client. */
  restoreQuota(options: { authenticated?: boolean; remaining?: number } = {}): this {
    this.authenticated = options.authenticated ?? this.authenticated;
    this.remaining = options.remaining ?? (this.authenticated ? 5000 : 60);
    this.resetAt = undefined;
    return this;
  }

  /** Makes every call reject with `UPSTREAM_UNAVAILABLE` (or work again), as when GitHub is down. */
  outage(down = true): this {
    this.down = down;
    return this;
  }

  /** Number of calls, optionally of one method. */
  count(method?: GithubCall['method']): number {
    return this.calls.filter((call) => method === undefined || call.method === method).length;
  }

  async repoMeta(
    repo: string,
    opts?: GithubCallOptions,
  ): Promise<{ defaultBranch: string; license: LicenseTier; archived: boolean }> {
    this.calls.push({ method: 'repoMeta', repo });
    this.spendBudget(opts);
    this.spendQuota(repo);
    const found = this.repo(repo);
    return {
      defaultBranch: found.defaultBranch ?? 'main',
      license: found.license ?? 'apache-2.0',
      archived: found.archived ?? false,
    };
  }

  async tree(
    repo: string,
    ref: string,
    opts?: GithubCallOptions,
  ): Promise<Array<{ path: string; size?: number }>> {
    this.calls.push({ method: 'tree', repo, ref });
    this.spendBudget(opts);
    this.spendQuota(repo);
    return Object.entries(this.filesAt(repo, ref)).map(([path, text]) => ({
      path,
      size: Buffer.byteLength(text, 'utf8'),
    }));
  }

  async raw(
    repo: string,
    ref: string,
    path: string,
    opts?: GithubCallOptions,
  ): Promise<HttpResponse> {
    this.calls.push({ method: 'raw', repo, ref, path });
    this.spendBudget(opts);
    const text = this.filesAt(repo, ref)[path];
    const url = `https://raw.githubusercontent.com/${repo}/${ref}/${path}`;
    if (text === undefined) throw notFound(url);
    return this.response(url, text);
  }

  async wikiRaw(repo: string, page: string, opts?: GithubCallOptions): Promise<HttpResponse> {
    this.calls.push({ method: 'wikiRaw', repo, path: page });
    this.spendBudget(opts);
    const text = this.repo(repo).wiki?.[page.replace(/\.md$/i, '')];
    const url = `https://raw.githubusercontent.com/wiki/${repo}/${page.replace(/\.md$/i, '')}.md`;
    if (text === undefined) throw notFound(url);
    return this.response(url, text);
  }

  async latestRelease(
    repo: string,
    opts?: GithubCallOptions,
  ): Promise<{ tag: string; publishedAt: string } | undefined> {
    this.calls.push({ method: 'latestRelease', repo });
    this.spendBudget(opts);
    this.spendQuota(repo);
    return this.repo(repo).release;
  }

  quota(): { authenticated: boolean; remaining?: number; resetAt?: string } {
    return {
      authenticated: this.authenticated,
      ...(this.remaining === undefined ? {} : { remaining: this.remaining }),
      ...(this.resetAt === undefined ? {} : { resetAt: this.resetAt }),
    };
  }

  private repo(name: string): FakeRepo {
    const found = this.repos.get(name);
    if (found === undefined) throw notFound(`https://github.com/${name}`);
    return found;
  }

  private filesAt(repo: string, ref: string): Record<string, string> {
    const files = this.repo(repo).files ?? {};
    const atRef = files[ref] ?? files['*'];
    if (atRef === undefined) throw notFound(`https://github.com/${repo}/tree/${ref}`);
    return atRef;
  }

  /** The gateway steps that come before any GitHub answer: request budget, then reachability. */
  private spendBudget(opts: GithubCallOptions | undefined): void {
    if (opts?.budget !== undefined && !consumeBudget(opts.budget, this.clock)) {
      throw new McpDocError(
        'UPSTREAM_UNAVAILABLE',
        'Request budget exhausted before GitHub could be contacted',
        { why: 'request budget', host: 'api.github.com', retryable: true },
      );
    }
    if (this.down) {
      throw new McpDocError('UPSTREAM_UNAVAILABLE', 'GitHub is not responding', {
        why: 'HTTP 503',
        host: 'api.github.com',
        retryable: true,
      });
    }
  }

  private spendQuota(repo: string): void {
    if (this.remaining === undefined) return;
    if (this.remaining <= 0) {
      throw new McpDocError('RATE_LIMITED_GITHUB', 'The GitHub API quota is exhausted', {
        why: `The quota resets at ${this.resetAt ?? 'an unknown time'}`,
        next: 'Set GITHUB_TOKEN to raise the limit, or retry after the reset time',
        url: `https://api.github.com/repos/${repo}`,
        host: 'api.github.com',
        retryable: false,
      });
    }
    this.remaining -= 1;
  }

  private response(url: string, text: string): HttpResponse {
    return {
      url,
      finalUrl: url,
      status: 200,
      contentType: 'text/plain; charset=utf-8',
      text,
      fetchedAt: this.clock.iso(),
      cache: 'miss',
      aliasChain: [],
    };
  }
}

function notFound(url: string): McpDocError {
  return new McpDocError('DOC_NOT_FOUND', `${url} does not exist`, {
    why: 'The repository, ref or path is unknown',
    url,
    host: new URL(url).host,
  });
}
