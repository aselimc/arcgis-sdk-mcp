import { describe, expect, it } from 'vitest';
import { CAPABILITIES } from '../../src/core/capabilities.js';
import { isMcpDocError, type McpDocError } from '../../src/core/errors.js';
import type { SourcePolicy } from '../../src/core/ports.js';
import { createPolicy } from '../../src/policy/index.js';
import { effectiveCapabilities, resolveSources } from '../../src/policy/presets.js';
import { makeConfig, makeHost } from '../support/builders.js';
import { HOSTS, SAMPLE_REQUESTS, SCENARIOS } from './hosts-table.js';

function refusal(policy: SourcePolicy, url: string, method?: 'GET' | 'POST'): McpDocError {
  try {
    policy.check(new URL(url), method);
  } catch (error) {
    if (isMcpDocError(error)) return error;
    throw error;
  }
  throw new Error(`${url} was allowed`);
}

const everything = createPolicy({
  config: makeConfig({ capabilities: new Set(CAPABILITIES) }),
  hosts: HOSTS,
});
const standard = createPolicy({ config: makeConfig(), hosts: HOSTS });

describe('capability gate, per host and configuration', () => {
  const matrix = SCENARIOS.flatMap((scenario) =>
    SAMPLE_REQUESTS.map((request) => ({
      scenario: scenario.name,
      config: scenario.config,
      ...request,
      allowed: effectiveCapabilities(scenario.config).has(request.capability),
    })),
  );

  it.each(matrix)('$scenario: $method $url allowed = $allowed', (cell) => {
    const policy = createPolicy({ config: cell.config, hosts: HOSTS });
    if (cell.allowed) {
      const result = policy.check(new URL(cell.url), cell.method);
      expect(result.capability).toBe(cell.capability);
      expect(result.host.host).toBe(new URL(cell.url).hostname);
      return;
    }
    const error = refusal(policy, cell.url, cell.method);
    expect(error.code).toBe('SOURCE_DISABLED');
    expect(error.details).toMatchObject({
      url: cell.url,
      host: new URL(cell.url).host,
      capability: cell.capability,
      retryable: false,
    });
    // The value named in the recovery really switches the capability on.
    const value = /ARCGIS_DOCS_SOURCES=(\S+)/.exec(error.details?.next ?? '')?.[1];
    expect(resolveSources(value, cell.config.mode).capabilities.has(cell.capability)).toBe(true);
  });

  it('names the exact variable value that keeps the current settings', () => {
    const strict = SCENARIOS.find((scenario) => scenario.name === 'strict,+package-cdn');
    const policy = createPolicy({ config: strict!.config, hosts: HOSTS });
    const error = refusal(policy, 'https://developers.arcgis.com/widgets/');
    expect(error.details?.next).toBe(
      'Set ARCGIS_DOCS_SOURCES=strict,+website,+package-cdn and restart the server',
    );
    expect(error.details?.why).toContain('preset strict');
  });

  it('contacts only GitHub and registry hosts under strict', () => {
    const policy = createPolicy({ config: SCENARIOS[0]!.config, hosts: HOSTS });
    const reachable = SAMPLE_REQUESTS.filter((request) => {
      try {
        policy.check(new URL(request.url), request.method);
        return true;
      } catch {
        return false;
      }
    }).map((request) => new URL(request.url).hostname);
    expect(reachable).toEqual([
      'raw.githubusercontent.com',
      'api.github.com',
      'registry.npmjs.org',
      'www.arcgis.com',
    ]);
  });

  it('keeps the opt-in hosts unreachable under standard', () => {
    expect(refusal(standard, 'https://esearchapi.esri.com/search', 'POST').code).toBe(
      'SOURCE_DISABLED',
    );
    expect(refusal(standard, 'https://plc-api.esri.com/api/PLC?category=x').code).toBe(
      'SOURCE_DISABLED',
    );
  });
});

describe('hosts that are never fetched', () => {
  const linkOnly = [
    'https://archive.developers.arcgis.com/javascript/4.20/api-reference/',
    'https://desktop.arcgis.com/en/arcmap/latest/analyze/main.htm',
  ];
  const unlisted = [
    'https://esri.jfrog.io/artifactory/arcgis/maven-metadata.xml',
    'https://aiservices-beta.arcgis.com/docs',
    'https://inspector.pypi.io/project/arcgis/',
    'https://example.com/',
    'https://github.com/Esri/widget-kit/blob/main/README.md',
    'https://www.esri.com/en-us/home',
  ];

  it.each(
    SCENARIOS.flatMap((s) => linkOnly.map((url) => ({ scenario: s.name, config: s.config, url }))),
  )('$scenario: $url is LINK_ONLY', ({ config, url }) => {
    const error = refusal(createPolicy({ config, hosts: HOSTS }), url);
    expect(error.code).toBe('LINK_ONLY');
    expect(error.details).toMatchObject({ url, host: new URL(url).host, retryable: false });
    expect(error.details?.next).toContain(url);
  });

  it.each(
    SCENARIOS.flatMap((s) => unlisted.map((url) => ({ scenario: s.name, config: s.config, url }))),
  )('$scenario: $url is HOST_NOT_ALLOWED', ({ config, url }) => {
    const error = refusal(createPolicy({ config, hosts: HOSTS }), url);
    expect(error.code).toBe('HOST_NOT_ALLOWED');
    expect(error.details).toMatchObject({ url: new URL(url).href, host: new URL(url).host });
  });

  it('refuses a POST to a link-only host as LINK_ONLY too', () => {
    expect(refusal(everything, 'https://desktop.arcgis.com/', 'POST').code).toBe('LINK_ONLY');
  });

  it('lists the documentation hosts and a search as the recovery', () => {
    const error = refusal(everything, 'https://example.com/guides/offline-maps.html');
    expect(error.details?.candidates).toEqual([
      'developers.arcgis.com',
      'doc.esri.com',
      'doc.arcgis.com',
      'support.esri.com',
      'esri.github.io',
      'hub.arcgis.com',
    ]);
    expect(error.details?.next).toBe('arcgis_docs_search({"query":"guides offline maps"})');
  });

  it('falls back to the host name when the path gives no search words', () => {
    const error = refusal(everything, 'https://example.com/');
    expect(error.details?.next).toBe('arcgis_docs_search({"query":"example.com"})');
  });

  it('omits candidates when the table has no documentation host', () => {
    const policy = createPolicy({ config: makeConfig(), hosts: [] });
    expect(refusal(policy, 'https://example.com/x').details?.candidates).toBeUndefined();
  });
});

describe('URL shapes that must not reach the network (SSRF)', () => {
  const cases: Array<[label: string, url: string]> = [
    ['plain http', 'http://developers.arcgis.com/widgets/'],
    ['another scheme', 'ftp://developers.arcgis.com/widgets/'],
    ['file URL', 'file:///etc/passwd'],
    ['explicit port', 'https://developers.arcgis.com:8443/widgets/'],
    ['user name', 'https://user@developers.arcgis.com/widgets/'],
    ['password', 'https://user:secret@developers.arcgis.com/widgets/'],
    ['allowed host as user name', 'https://developers.arcgis.com@evil.example/'],
    ['allowed host as subdomain label', 'https://developers.arcgis.com.evil.example/'],
    ['allowed host as suffix', 'https://evildevelopers.arcgis.com/'],
    ['unlisted subdomain', 'https://internal.developers.arcgis.com/'],
    ['allowed host in the path', 'https://evil.example/developers.arcgis.com/'],
    ['trailing dot', 'https://developers.arcgis.com./widgets/'],
    ['loopback name', 'https://localhost/'],
    ['loopback address', 'https://127.0.0.1/'],
    ['IPv6 loopback', 'https://[::1]/'],
    ['link-local metadata address', 'https://169.254.169.254/latest/meta-data/'],
    ['private address', 'https://10.0.0.1/'],
    ['decimal address', 'https://2130706433/'],
  ];

  it.each(cases)('%s: %s', (_label, url) => {
    for (const scenario of SCENARIOS) {
      const error = refusal(createPolicy({ config: scenario.config, hosts: HOSTS }), url);
      expect(error.code).toBe('HOST_NOT_ALLOWED');
      expect(error.details?.url).toBe(new URL(url).href);
    }
  });

  it('matches the host case-insensitively, as URLs do', () => {
    expect(everything.check(new URL('https://DEVELOPERS.ArcGIS.com/widgets/')).host.host).toBe(
      'developers.arcgis.com',
    );
  });

  it('accepts a host row written in upper case', () => {
    const policy = createPolicy({
      config: makeConfig(),
      hosts: [makeHost({ host: 'Docs.Example.org' })],
    });
    expect(policy.check(new URL('https://docs.example.org/')).capability).toBe('website');
  });

  it('accepts the default port written out', () => {
    expect(everything.check(new URL('https://developers.arcgis.com:443/widgets/')).capability).toBe(
      'website',
    );
  });
});

describe('path rules', () => {
  it.each([
    'https://support.esri.com/en-us/knowledge-base/000001',
    'https://hub.arcgis.com/api/v3/docs-json',
    'https://hub.arcgis.com/api/v3/definition/swagger-ui-init.js',
    'https://cdn.jsdelivr.net/npm/@esri/widget-request@4.0.0/dist/index.d.ts',
    'https://cdn.jsdelivr.net/npm/esri-leaflet@3.0.0/package.json',
    'https://www.arcgis.com/sharing/rest',
    'https://www.arcgis.com/sharing/rest/info?f=json',
  ])('allows %s', (url) => {
    expect(() => everything.check(new URL(url))).not.toThrow();
  });

  it.each([
    'https://support.esri.com/en-us/contact',
    'https://hub.arcgis.com/datasets/abc',
    'https://hub.arcgis.com/api/v3/docs-json/extra',
    'https://cdn.jsdelivr.net/npm/left-pad@1.3.0/index.js',
    'https://cdn.jsdelivr.net/gh/Esri/widget-kit/README.md',
    'https://www.arcgis.com/home/item.html?id=abc',
    'https://www.arcgis.com/sharing/restricted',
    // Dot segments are resolved by the URL parser before the patterns see the path.
    'https://cdn.jsdelivr.net/npm/@arcgis/../left-pad@1.3.0/index.js',
    'https://cdn.jsdelivr.net/npm/@arcgis/%2e%2e/left-pad@1.3.0/index.js',
  ])('refuses %s as HOST_NOT_ALLOWED', (url) => {
    const error = refusal(everything, url);
    expect(error.code).toBe('HOST_NOT_ALLOWED');
    expect(error.details?.why).toContain('Only selected paths');
  });

  it.each([
    'https://cdn.jsdelivr.net/npm/@arcgis/..%2F..%2Fleft-pad@1.3.0/index.js',
    'https://cdn.jsdelivr.net/npm/@arcgis/..%5c..%5cleft-pad/index.js',
    'https://raw.githubusercontent.com/Esri%2F..%2Fsomeone/repo/main/README.md',
  ])('refuses encoded path separators in %s', (url) => {
    const error = refusal(everything, url);
    expect(error.code).toBe('HOST_NOT_ALLOWED');
    expect(error.details?.why).toContain('Encoded path separators');
  });

  it('does not restrict encoded separators on hosts without path rules', () => {
    expect(() =>
      everything.check(new URL('https://developers.arcgis.com/widgets/a%2Fb/')),
    ).not.toThrow();
  });

  it('reports a path outside the allow-list even when the capability is off', () => {
    const strict = createPolicy({ config: SCENARIOS[0]!.config, hosts: HOSTS });
    expect(refusal(strict, 'https://support.esri.com/en-us/contact').code).toBe('HOST_NOT_ALLOWED');
  });

  it('fails at construction for an invalid path expression', () => {
    expect(() =>
      createPolicy({ config: makeConfig(), hosts: [makeHost({ allowPaths: ['^/(unclosed'] })] }),
    ).toThrow(SyntaxError);
  });
});

describe('GitHub owners', () => {
  it.each([
    'https://raw.githubusercontent.com/Esri/widget-kit/main/README.md',
    'https://raw.githubusercontent.com/esri/widget-kit/main/README.md',
    'https://raw.githubusercontent.com/R-ArcGIS/widgetr/main/DESCRIPTION',
    'https://raw.githubusercontent.com/wiki/Esri/widget-kit/Home.md',
    'https://api.github.com/repos/koopjs/koop',
    'https://api.github.com/repos/Esri/widget-kit/git/trees/main?recursive=1',
    'https://api.github.com/repos/Esri/widget-kit/releases/latest',
  ])('allows %s', (url) => {
    expect(everything.check(new URL(url)).capability).toBe('github');
  });

  it.each([
    'https://raw.githubusercontent.com/someone/widget-kit/main/README.md',
    'https://raw.githubusercontent.com/wiki/someone/widget-kit/Home.md',
    'https://raw.githubusercontent.com/Esri-labs/widget-kit/main/README.md',
    'https://api.github.com/repos/someone/widget-kit',
    'https://api.github.com/users/Esri',
    'https://api.github.com/search/code?q=org:Esri',
    'https://api.github.com/repos',
    'https://api.github.com/',
  ])('refuses %s', (url) => {
    const error = refusal(everything, url);
    expect(error.code).toBe('HOST_NOT_ALLOWED');
    expect(error.details?.why).toBe('Only repositories of Esri, R-ArcGIS, koopjs are read');
  });
});

describe('request methods', () => {
  it('refuses POST on every host but the search backend', () => {
    for (const request of SAMPLE_REQUESTS.filter((sample) => sample.method === 'GET')) {
      const error = refusal(everything, request.url, 'POST');
      expect(error.code).toBe('HOST_NOT_ALLOWED');
      expect(error.details?.why).toContain('GET requests only');
    }
  });

  it('refuses GET on the search backend', () => {
    const error = refusal(everything, 'https://esearchapi.esri.com/search');
    expect(error.code).toBe('HOST_NOT_ALLOWED');
    expect(error.details?.why).toContain('POST requests only');
  });

  it('refuses other paths of the search backend', () => {
    expect(refusal(everything, 'https://esearchapi.esri.com/suggest', 'POST').code).toBe(
      'HOST_NOT_ALLOWED',
    );
  });

  it('defaults to GET', () => {
    expect(() => everything.check(new URL('https://developers.arcgis.com/widgets/'))).not.toThrow();
  });
});

describe('static robots denials', () => {
  it.each([
    ['https://developers.arcgis.com/documentation/?q=cluster', '*?q='],
    ['https://developers.arcgis.com/search/?term=cluster', '/search/'],
    ['https://developers.arcgis.com/downloads/', '/downloads'],
    ['https://developers.arcgis.com/assets/js/config.js', '/assets/js/config.js'],
    ['https://doc.esri.com/search/', '/search/'],
    ['https://doc.esri.com/en/widget-server/config/settings.htm', '/*/config/'],
    ['https://doc.arcgis.com/en/asset/logo.svg', '/en/asset/'],
    ['https://doc.arcgis.com/en/test/page.htm', '/en/test/'],
    ['https://doc.arcgis.com/js/app.js', '/js/'],
  ])('%s is excluded by %s', (url, pattern) => {
    const error = refusal(everything, url);
    expect(error.code).toBe('LINK_ONLY');
    expect(error.details?.why).toBe(
      `robots rules of ${new URL(url).host} exclude this path (Disallow: ${pattern})`,
    );
    expect(error.details).toMatchObject({ url, host: new URL(url).host });
  });

  it.each([
    'https://developers.arcgis.com/widgets/search-widget/',
    'https://developers.arcgis.com/widgets/?tab=q',
    'https://doc.esri.com/en/widget-server/latest/configure.htm',
    'https://doc.arcgis.com/en/widget-app/latest/js-api.htm',
  ])('%s is not excluded', (url) => {
    expect(() => everything.check(new URL(url))).not.toThrow();
  });

  it('ignores the fragment', () => {
    expect(() =>
      everything.check(new URL('https://developers.arcgis.com/widgets/#/search/')),
    ).not.toThrow();
  });

  it('applies in every configuration, ahead of the capability gate', () => {
    for (const scenario of SCENARIOS) {
      const policy = createPolicy({ config: scenario.config, hosts: HOSTS });
      expect(refusal(policy, 'https://developers.arcgis.com/search/').code).toBe('LINK_ONLY');
    }
  });
});

describe('summary', () => {
  it('reports the preset, both capability lists in table order and offline mode', () => {
    expect(standard.summary()).toEqual({
      preset: 'standard',
      enabled: [
        'github',
        'registries',
        'local-packages',
        'workspace',
        'website',
        'site-index',
        'package-cdn',
      ],
      disabled: ['site-search', 'lifecycle-api'],
      offline: false,
    });
    const offline = createPolicy({ config: makeConfig({ offline: true }), hosts: HOSTS });
    expect(offline.summary().offline).toBe(true);
  });

  it('does not change when the configuration object is mutated afterwards', () => {
    const capabilities = new Set(makeConfig().capabilities);
    const policy = createPolicy({ config: makeConfig({ capabilities }), hosts: HOSTS });
    capabilities.delete('website');
    expect(policy.enabled('website')).toBe(true);
  });
});
