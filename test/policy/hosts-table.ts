import { CAPABILITIES, type Preset } from '../../src/core/capabilities.js';
import type { Config } from '../../src/core/config.js';
import type { Capability, HostPolicy } from '../../src/core/types.js';
import { presetCapabilities } from '../../src/policy/presets.js';
import { makeConfig, makeHost } from '../support/builders.js';

/**
 * A host table with the shape of design section 4.7, written for these tests (the real one
 * belongs to the registry package): every capability that has hosts, path-restricted hosts,
 * owner-restricted GitHub hosts, robots denials and the two link-only hosts.
 */
export const HOSTS: HostPolicy[] = [
  makeHost({
    host: 'developers.arcgis.com',
    capability: 'website',
    robotsDisallow: ['*?q=', '/search/', '/downloads', '/assets/js/config.js'],
  }),
  makeHost({
    host: 'doc.esri.com',
    capability: 'website',
    robotsDisallow: ['/search/', '/*/config/'],
    revalidate: 'last-modified',
  }),
  makeHost({
    host: 'doc.arcgis.com',
    capability: 'website',
    robotsDisallow: ['/en/asset/', '/en/test/', '/js/'],
    revalidate: 'both',
  }),
  makeHost({
    host: 'support.esri.com',
    capability: 'website',
    allowPaths: ['^/en-us/knowledge-base/'],
  }),
  makeHost({ host: 'esri.github.io', capability: 'website' }),
  makeHost({
    host: 'hub.arcgis.com',
    capability: 'website',
    allowPaths: ['^/api/[^/]+/docs-json$', '^/api/[^/]+/definition/swagger-ui-init\\.js$'],
    revalidate: 'none',
  }),
  makeHost({
    host: 'raw.githubusercontent.com',
    capability: 'github',
    githubOwners: ['Esri', 'R-ArcGIS', 'koopjs'],
  }),
  makeHost({
    host: 'api.github.com',
    capability: 'github',
    githubOwners: ['Esri', 'R-ArcGIS', 'koopjs'],
  }),
  makeHost({
    host: 'cdn.jsdelivr.net',
    capability: 'package-cdn',
    allowPaths: ['^/npm/@arcgis/', '^/npm/@esri/', '^/npm/esri-leaflet'],
    revalidate: 'none',
  }),
  makeHost({
    host: 'registry.npmjs.org',
    capability: 'registries',
    revalidate: 'none',
  }),
  makeHost({
    host: 'www.arcgis.com',
    capability: 'registries',
    allowPaths: ['^/sharing/rest(?:/|$)'],
    revalidate: 'none',
  }),
  makeHost({
    host: 'esearchapi.esri.com',
    capability: 'site-search',
    allowPaths: ['^/search
    revalidate: 'none',
  }),
  makeHost({
    host: 'plc-api.esri.com',
    capability: 'lifecycle-api',
    allowPaths: ['^/api/PLC$'],
    revalidate: 'none',
  }),
  makeHost({ host: 'archive.developers.arcgis.com', capability: null, robotsDisallow: ['/'] }),
  makeHost({ host: 'desktop.arcgis.com', capability: null, robotsDisallow: ['/'] }),
];

/** One URL per fetchable host that the table allows, with the method it is requested with. */
export const SAMPLE_REQUESTS: Array<{
  url: string;
  method: 'GET' | 'POST';
  capability: Capability;
}> = [
  {
    url: 'https://developers.arcgis.com/widgets/get-started/',
    method: 'GET',
    capability: 'website',
  },
  { url: 'https://doc.esri.com/en/widget-server/latest/', method: 'GET', capability: 'website' },
  {
    url: 'https://doc.arcgis.com/en/widget-app/latest/intro.htm',
    method: 'GET',
    capability: 'website',
  },
  {
    url: 'https://support.esri.com/en-us/knowledge-base/000001',
    method: 'GET',
    capability: 'website',
  },
  { url: 'https://esri.github.io/widget-kit/api/', method: 'GET', capability: 'website' },
  { url: 'https://hub.arcgis.com/api/v3/docs-json', method: 'GET', capability: 'website' },
  {
    url: 'https://raw.githubusercontent.com/Esri/widget-kit/main/README.md',
    method: 'GET',
    capability: 'github',
  },
  { url: 'https://api.github.com/repos/Esri/widget-kit', method: 'GET', capability: 'github' },
  {
    url: 'https://cdn.jsdelivr.net/npm/@arcgis/widget-kit@1.2.3/index.d.ts',
    method: 'GET',
    capability: 'package-cdn',
  },
  { url: 'https://registry.npmjs.org/@arcgis/widget-kit', method: 'GET', capability: 'registries' },
  { url: 'https://www.arcgis.com/sharing/rest?f=json', method: 'GET', capability: 'registries' },
  { url: 'https://esearchapi.esri.com/search', method: 'POST', capability: 'site-search' },
  {
    url: 'https://plc-api.esri.com/api/PLC?category=widgets',
    method: 'GET',
    capability: 'lifecycle-api',
  },
];

/** A named configuration of the policy test matrix. */
export interface Scenario {
  name: string;
  config: Config;
}

function scenario(name: string, preset: Preset, mode: Config['mode'], extra: Capability[] = []) {
  const capabilities = presetCapabilities(preset, mode);
  for (const capability of extra) capabilities.add(capability);
  return { name, config: makeConfig({ preset, mode, capabilities }) };
}

/** Both presets, both modes, each opt-in on its own, offline, everything on and nothing on. */
export const SCENARIOS: Scenario[] = [
  scenario('strict', 'strict', 'stdio'),
  scenario('standard', 'standard', 'stdio'),
  scenario('strict over http', 'strict', 'http'),
  scenario('standard over http', 'standard', 'http'),
  scenario('standard,+site-search', 'standard', 'stdio', ['site-search']),
  scenario('standard,+lifecycle-api', 'standard', 'stdio', ['lifecycle-api']),
  scenario('strict,+website', 'strict', 'stdio', ['website']),
  scenario('strict,+package-cdn', 'strict', 'stdio', ['package-cdn']),
  {
    name: 'standard, offline',
    config: makeConfig({ offline: true }),
  },
  {
    name: 'every capability on',
    config: makeConfig({ capabilities: new Set(CAPABILITIES) }),
  },
  {
    name: 'every capability off',
    config: makeConfig({ preset: 'strict', capabilities: new Set() }),
  },
];
],
    method: 'POST',
    revalidate: 'none',
  }),
  makeHost({
    host: 'plc-api.esri.com',
    capability: 'lifecycle-api',
    allowPaths: ['^/api/PLC$'],
    revalidate: 'none',
  }),
  makeHost({ host: 'archive.developers.arcgis.com', capability: null, robotsDisallow: ['/'] }),
  makeHost({ host: 'desktop.arcgis.com', capability: null, robotsDisallow: ['/'] }),
];

/** One URL per fetchable host that the table allows, with the method it is requested with. */
export const SAMPLE_REQUESTS: Array<{
  url: string;
  method: 'GET' | 'POST';
  capability: Capability;
}> = [
  {
    url: 'https://developers.arcgis.com/widgets/get-started/',
    method: 'GET',
    capability: 'website',
  },
  { url: 'https://doc.esri.com/en/widget-server/latest/', method: 'GET', capability: 'website' },
  {
    url: 'https://doc.arcgis.com/en/widget-app/latest/intro.htm',
    method: 'GET',
    capability: 'website',
  },
  {
    url: 'https://support.esri.com/en-us/knowledge-base/000001',
    method: 'GET',
    capability: 'website',
  },
  { url: 'https://esri.github.io/widget-kit/api/', method: 'GET', capability: 'website' },
  { url: 'https://hub.arcgis.com/api/v3/docs-json', method: 'GET', capability: 'website' },
  {
    url: 'https://raw.githubusercontent.com/Esri/widget-kit/main/README.md',
    method: 'GET',
    capability: 'github',
  },
  { url: 'https://api.github.com/repos/Esri/widget-kit', method: 'GET', capability: 'github' },
  {
    url: 'https://cdn.jsdelivr.net/npm/@arcgis/widget-kit@1.2.3/index.d.ts',
    method: 'GET',
    capability: 'package-cdn',
  },
  { url: 'https://registry.npmjs.org/@arcgis/widget-kit', method: 'GET', capability: 'registries' },
  { url: 'https://www.arcgis.com/sharing/rest?f=json', method: 'GET', capability: 'registries' },
  { url: 'https://esearchapi.esri.com/search', method: 'POST', capability: 'site-search' },
  {
    url: 'https://plc-api.esri.com/api/PLC?category=widgets',
    method: 'GET',
    capability: 'lifecycle-api',
  },
];

/** A named configuration of the policy test matrix. */
export interface Scenario {
  name: string;
  config: Config;
}

function scenario(name: string, preset: Preset, mode: Config['mode'], extra: Capability[] = []) {
  const capabilities = presetCapabilities(preset, mode);
  for (const capability of extra) capabilities.add(capability);
  return { name, config: makeConfig({ preset, mode, capabilities }) };
}

/** Both presets, both modes, each opt-in on its own, offline, everything on and nothing on. */
export const SCENARIOS: Scenario[] = [
  scenario('strict', 'strict', 'stdio'),
  scenario('standard', 'standard', 'stdio'),
  scenario('strict over http', 'strict', 'http'),
  scenario('standard over http', 'standard', 'http'),
  scenario('standard,+site-search', 'standard', 'stdio', ['site-search']),
  scenario('standard,+lifecycle-api', 'standard', 'stdio', ['lifecycle-api']),
  scenario('strict,+website', 'strict', 'stdio', ['website']),
  scenario('strict,+package-cdn', 'strict', 'stdio', ['package-cdn']),
  {
    name: 'standard, offline',
    config: makeConfig({ offline: true }),
  },
  {
    name: 'every capability on',
    config: makeConfig({ capabilities: new Set(CAPABILITIES) }),
  },
  {
    name: 'every capability off',
    config: makeConfig({ preset: 'strict', capabilities: new Set() }),
  },
];
