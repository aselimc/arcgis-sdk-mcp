/**
 * Unit tests never touch the network. This setup file (wired in `vitest.config.ts` for the
 * `unit` project) replaces the global `fetch` with a guard, so a test that forgets to inject
 * `fetchImpl` or a `FakeHttp` fails immediately and by name instead of calling a real host.
 */

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** The URL of any `fetch` input form. */
function urlOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

/**
 * Wraps a `fetch` so that only loopback requests reach it (the end-to-end tests talk to a
 * server they start themselves on 127.0.0.1). Everything else rejects.
 */
export function guardFetch(original: typeof fetch): typeof fetch {
  return async (input, init) => {
    const url = urlOf(input);
    let host = '';
    try {
      host = new URL(url).hostname;
    } catch {
      // Not an absolute URL: fall through to the rejection below.
    }
    if (!LOOPBACK.has(host)) {
      throw new Error(
        `Network access is not allowed in unit tests: fetch(${url}). Inject fetchImpl or use FakeHttp from test/support.`,
      );
    }
    return original(input, init);
  };
}

globalThis.fetch = guardFetch(globalThis.fetch);
