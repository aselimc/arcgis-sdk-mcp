/**
 * GitHub access through the gateway: metadata from `api.github.com`, content from
 * `raw.githubusercontent.com`. The unauthenticated API quota is 60 requests per hour, so
 * repository metadata is remembered for 7 days, a tree costs one request per day, and a spent
 * quota is reported as `RATE_LIMITED_GITHUB` with the reset time instead of a bare 403.
 */
import { McpDocError, isMcpDocError } from '../core/errors.js';
import type { CreateGithubClient } from '../core/factories.js';
import type { GithubCallOptions, GithubClient, HttpRequest, HttpResponse } from '../core/ports.js';
import type { LicenseTier } from '../core/types.js';
import { notFound } from './errors.js';
import { classifyLicenseText, classifySpdx } from './github-license.js';
import { rateLimitOf } from './rate-limit-info.js';

const API_HOST = 'api.github.com';
const API = `https://${API_HOST}`;
const RAW = 'https://raw.githubusercontent.com';
const API_VERSION = '2022-11-28';
const META_TTL_MS = 7 * 24 * 3_600_000;

/** `owner/name`, each part in GitHub's character set. Keeps input out of the URL structure. */
const REPO = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+$/;
const FULL_SHA = /^[0-9a-f]{40}$/;

/** What `createGithubClient` receives: the factory contract. */
export type GithubDeps = Readonly<Parameters<CreateGithubClient>[0]>;

type RepoMeta = Awaited<ReturnType<GithubClient['repoMeta']>>;

interface StoredMeta {
  meta: RepoMeta;
  storedAt: number;
}

interface RepoJson {
  default_branch?: unknown;
  archived?: unknown;
  license?: { spdx_id?: unknown } | null;
}

function encodePath(path: string): string {
  return path
    .split('/')
    .filter((segment) => segment !== '')
    .map(encodeURIComponent)
    .join('/');
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** Creates the GitHub client. Satisfies `CreateGithubClient`. */
export function createGithubClient(deps: GithubDeps): GithubClient {
  const { config, http, cache, logger, clock } = deps;
  const authenticated = config.githubToken !== undefined;
  const apiHeaders: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': API_VERSION,
    ...(authenticated ? { authorization: `Bearer ${config.githubToken}` } : {}),
  };

  function repoPath(repo: string): string {
    if (!REPO.test(repo) || repo.includes('..')) {
      throw notFound(`https://github.com/${repo}`, 'Not a GitHub repository name (owner/name)');
    }
    return repo;
  }

  /** The API quota as far as it is known and still current. */
  function knownQuota(): { remaining?: number; resetAt?: number; pausedUntil?: number } {
    const seen = rateLimitOf(http, API_HOST);
    const now = clock.now();
    if (seen === undefined) return {};
    const current = seen.resetAt === undefined || now < seen.resetAt;
    return {
      ...(current && seen.remaining !== undefined ? { remaining: seen.remaining } : {}),
      ...(current && seen.resetAt !== undefined ? { resetAt: seen.resetAt } : {}),
      ...(seen.retryAfterUntil !== undefined && now < seen.retryAfterUntil
        ? { pausedUntil: seen.retryAfterUntil }
        : {}),
    };
  }

  function rateLimited(url: string): McpDocError {
    const quota = knownQuota();
    const until = quota.remaining === 0 ? quota.resetAt : quota.pausedUntil;
    const when = until === undefined ? 'an unknown time' : new Date(until).toISOString();
    const limit = authenticated
      ? 'of this token'
      : 'for unauthenticated use (60 requests per hour)';
    return new McpDocError('RATE_LIMITED_GITHUB', 'The GitHub API quota is exhausted', {
      why: `The quota ${limit} is spent and resets at ${when}`,
      next: authenticated
        ? `Retry after ${when}`
        : `Set GITHUB_TOKEN to raise the limit, or retry after ${when}`,
      url,
      host: API_HOST,
      retryable: false,
    });
  }

  /**
   * Tells a spent quota from other refusals. GitHub answers 403 or 429 for both; the quota
   * headers the gateway saw decide. When nothing is known about the quota (the API sent no
   * such headers, or the HTTP client reports none) a refusal stays the refusal it is: telling
   * the agent to set a token for a failure that has nothing to do with quota would be a guess.
   */
  function translate(error: unknown, url: string): unknown {
    if (!isMcpDocError(error)) return error;
    const quota = knownQuota();
    const spent = quota.remaining === 0 || quota.pausedUntil !== undefined;
    // A refusal, an open breaker or spent retries while the quota is known to be gone: one cause.
    const byQuota = error.code === 'UPSTREAM_BLOCKED' || error.code === 'UPSTREAM_UNAVAILABLE';
    return byQuota && spent ? rateLimited(url) : error;
  }

  async function api<J>(
    path: string,
    ttl: NonNullable<HttpRequest['ttl']>,
    opts: GithubCallOptions | undefined,
  ): Promise<J> {
    const url = `${API}${path}`;
    try {
      const { data } = await http.getJson<J>({
        url,
        ttl,
        headers: apiHeaders,
        ...(opts?.budget === undefined ? {} : { budget: opts.budget }),
        ...(opts?.signal === undefined ? {} : { signal: opts.signal }),
      });
      return data;
    } catch (error) {
      throw translate(error, url);
    }
  }

  function rawFile(url: string, ttl: NonNullable<HttpRequest['ttl']>, opts?: GithubCallOptions) {
    return http.get({
      url,
      // The raw host serves every file as text/plain; only real pages are checked as markup.
      expect: /\.html?$/i.test(new URL(url).pathname) ? 'html' : 'text',
      ttl,
      ...(opts?.budget === undefined ? {} : { budget: opts.budget }),
      ...(opts?.signal === undefined ? {} : { signal: opts.signal }),
    });
  }

  /** Reads the licence file GitHub found but could not name. `undefined`: try again later. */
  async function licenseFromFile(
    repo: string,
    opts: GithubCallOptions | undefined,
  ): Promise<LicenseTier | undefined> {
    try {
      const file = await api<{ content?: unknown; encoding?: unknown }>(
        `/repos/${repo}/license`,
        'github-meta',
        opts,
      );
      const content = text(file.content);
      if (content === undefined) return 'unlicensed';
      const decoded =
        file.encoding === 'base64' ? Buffer.from(content, 'base64').toString('utf8') : content;
      return classifyLicenseText(decoded);
    } catch (error) {
      if (isMcpDocError(error) && error.code === 'DOC_NOT_FOUND') return 'unlicensed';
      logger.warn('licence file unreadable; treating the repository as unlicensed for now', {
        repo,
        error: String(error),
      });
      return undefined;
    }
  }

  return {
    async repoMeta(repo, opts) {
      const key = `github:${repoPath(repo).toLowerCase()}`;
      const stored = await cache.getDerived<StoredMeta>('license', key);
      if (stored !== undefined && clock.now() - stored.storedAt < META_TTL_MS) return stored.meta;

      const json = await api<RepoJson>(`/repos/${repo}`, 'github-meta', opts);
      // No licence object: no licence file. An object without a usable id: a file GitHub
      // could not name, which is then read and classified by its text.
      const spdx =
        json.license === null || json.license === undefined
          ? null
          : (text(json.license.spdx_id) ?? '');
      const byFile = classifySpdx(spdx) ?? (await licenseFromFile(repo, opts));
      const meta: RepoMeta = {
        defaultBranch: text(json.default_branch) ?? 'main',
        license: byFile ?? 'unlicensed',
        archived: json.archived === true,
      };
      // An answer that rests on a failed licence read is not remembered for a week.
      if (byFile !== undefined) {
        await cache.putDerived<StoredMeta>('license', key, { meta, storedAt: clock.now() });
      }
      return meta;
    },

    async tree(repo, ref, opts) {
      const json = await api<{ tree?: unknown; truncated?: unknown }>(
        `/repos/${repoPath(repo)}/git/trees/${encodePath(ref)}?recursive=1`,
        // A commit's tree never changes; a branch's is re-read once a day.
        FULL_SHA.test(ref) ? 'immutable' : 'index',
        opts,
      );
      if (json.truncated === true) {
        logger.warn('GitHub truncated the tree; some files are missing', { repo, ref });
      }
      const entries = Array.isArray(json.tree) ? (json.tree as unknown[]) : [];
      const files: Array<{ path: string; size?: number }> = [];
      for (const entry of entries) {
        const { path, type, size } = (entry ?? {}) as Record<string, unknown>;
        if (type !== 'blob' || typeof path !== 'string') continue;
        files.push(typeof size === 'number' ? { path, size } : { path });
      }
      return files;
    },

    // Async so that a bad repository name is a rejection, like every other failure.
    async raw(repo, ref, path, opts): Promise<HttpResponse> {
      const url = `${RAW}/${repoPath(repo)}/${encodePath(ref)}/${encodePath(path)}`;
      return rawFile(url, opts?.ttl ?? (FULL_SHA.test(ref) ? 'immutable' : 'volatile'), opts);
    },

    async wikiRaw(repo, page, opts): Promise<HttpResponse> {
      const name = page.replace(/\.md$/i, '');
      return rawFile(`${RAW}/wiki/${repoPath(repo)}/${encodePath(name)}.md`, 'volatile', opts);
    },

    async latestRelease(repo, opts) {
      const path = `/repos/${repoPath(repo)}/releases/latest`;
      let json: { tag_name?: unknown; published_at?: unknown };
      try {
        // GitHub's "latest" already excludes drafts and prereleases.
        json = await api(path, 'volatile', opts);
      } catch (error) {
        if (isMcpDocError(error) && error.code === 'DOC_NOT_FOUND') return undefined;
        throw error;
      }
      const tag = text(json.tag_name);
      return tag === undefined ? undefined : { tag, publishedAt: text(json.published_at) ?? '' };
    },

    quota() {
      const { remaining, resetAt } = knownQuota();
      return {
        authenticated,
        ...(remaining === undefined ? {} : { remaining }),
        ...(resetAt === undefined ? {} : { resetAt: new Date(resetAt).toISOString() }),
      };
    },
  };
}
