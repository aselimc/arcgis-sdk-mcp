import type { Cassette } from '../support/fake-http.js';

/**
 * Hand-written pages that replicate the structures the site oracles read: version banners,
 * sitemaps, a meta-refresh stub, version matrices and the Knowledge Base sitemap. The prose
 * is this project's own; only URL shapes and version numbers follow the real sites.
 */
const D = 'https://developers.arcgis.com';

const page = (body: string): string =>
  `<!doctype html><html><head><title>Test page</title>` +
  // A script that mentions a version must never be taken for the banner.
  `<script>window.cfg = "Current version: 9.9 (May 1999)";</script></head>` +
  `<body><!-- Current version: 8.8 (May 1998) --><main>${body}</main></body></html>`;

const urlset = (paths: string[]): string =>
  `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` +
  paths.map((path) => `<url><loc>${path}</loc></url>`).join('') +
  `</urlset>`;

/** The version matrix of an invented JavaScript SDK, as a real `<table>`. */
export const MATRIX_HTML = page(
  `<h1>Version matrix</h1><table><thead><tr><th>JS SDK</th><th>Released</th><th>Enterprise</th><th>Calcite</th></tr></thead>` +
    `<tbody><tr><td>5.2.*</td><td>October 2026</td><td>n/a</td><td>5.2.*</td></tr>` +
    `<tr><td>5.1.*</td><td>June 2026</td><td>12.2</td><td>5.1.*</td></tr>` +
    `<tr><td>5.0.*</td><td>February 2026</td><td>12.1</td><td>5.0.*</td></tr>` +
    `<tr><td>4.33</td><td>June 2025</td><td>12.0</td><td>3.2.1</td></tr></tbody></table>`,
);

/** The package list of a Python environment: a name / version table, not a matrix. */
export const LIBRARIES_HTML = page(
  `<h1>Available libraries</h1><table><tr><th>Package</th><th>Version</th><th>Notes</th></tr>` +
    `<tr><td>arcgis</td><td>2.4.3</td><td></td></tr><tr><td>numpy</td><td>2.3.5</td><td></td></tr>` +
    `<tr><td>python</td><td>3.13.13</td><td></td></tr><tr><td>requests</td><td>2.32.0</td><td></td></tr></table>`,
);

export const SITES: Cassette = {
  name: 'documentation sites',
  interactions: [
    {
      url: `${D}/javascript/latest/`,
      response: { body: page('<p class="banner">Current version: 5.1 (June 2026)</p>') },
    },
    {
      url: `${D}/net/`,
      response: {
        body: page(
          '<p>Current version: <b>300.1</b> &ndash; August 2026. <a href="x">Release notes</a>.</p>',
        ),
      },
    },
    {
      url: `${D}/net/v200/`,
      response: { body: page('<p>Current version: 200.8.3 - September 2026. Release notes.</p>') },
    },
    {
      url: `${D}/python/latest/`,
      response: {
        body: page('<p>Current version: 2.4.4 - September 22, 2026. Release notes.</p>'),
      },
    },
    {
      url: `${D}/experience-builder/`,
      response: { body: page('<span>Version 1.21 &middot; July 2026</span>') },
    },
    {
      url: `${D}/calcite-design-system/`,
      response: {
        body: page(
          '<p>Current version: <code>@esri/calcite-components</code> : 5.1 ( May 2026 )</p>',
        ),
      },
    },
    { url: `${D}/no-banner/`, response: { body: page('<p>Nothing about versions here.</p>') } },
    {
      url: `${D}/arcade/guide/release-notes/`,
      response: {
        body: page(
          '<h2 id="version-138">Version 1.38</h2><p>x</p><h2 id="version-137">Version 1.37</h2>',
        ),
      },
    },
    {
      url: `${D}/rest/whats-new/`,
      response: { body: page('<h1>What is new</h1><h2 class="t"> 12.1 </h2><h2>12.0</h2>') },
    },
    {
      url: 'https://api.example.arcgis.com/apidocs.json',
      response: { json: { info: { title: 'Invented API', version: '2.7.1' } } },
    },
    {
      url: `${D}/net/sitemap-0.xml`,
      response: {
        body: urlset([
          `${D}/net/`,
          `${D}/net/release-notes/`,
          `${D}/net/release-notes/release-notes-for-300-1/`,
          `${D}/net/release-notes/prior-releases/release-notes-for-300-0/`,
          `${D}/net/release-notes/prior-releases/release-notes-for-200-8/`,
          `${D}/net/system-requirements/system-requirements-for-300-1/`,
        ]),
      },
    },
    {
      url: `${D}/net/v200/sitemap-0.xml`,
      response: {
        body: urlset([
          `${D}/net/v200/release-notes/release-notes-for-200-8/`,
          `${D}/net/v200/release-notes/prior-releases/release-notes-for-200-7/`,
        ]),
      },
    },
    {
      url: `${D}/python/latest/sitemap-0.xml`,
      response: {
        body: urlset([
          `${D}/python/latest/guide/release-notes-100/`,
          `${D}/python/latest/guide/release-notes-243/`,
          `${D}/python/latest/guide/release-notes-244/`,
          `${D}/python/latest/guide/overview244/`,
        ]),
      },
    },
    {
      url: `${D}/arcgis-urban-api/sitemap-0.xml`,
      response: {
        body: urlset([
          `${D}/arcgis-urban-api/release-notes/2021-02-15/`,
          `${D}/arcgis-urban-api/release-notes/2026-07-21/`,
          `${D}/arcgis-urban-api/release-notes/release-schedule/`,
        ]),
      },
    },
    {
      // A sitemap index: the oracle follows it into its first child.
      url: `${D}/indexed/sitemap-0.xml`,
      response: {
        body: `<?xml version="1.0"?><sitemapindex><sitemap><loc>${D}/indexed/sitemap-pages.xml</loc></sitemap></sitemapindex>`,
      },
    },
    {
      url: `${D}/indexed/sitemap-pages.xml`,
      response: { body: urlset([`${D}/indexed/release-notes/release-notes-2-4-0/`]) },
    },
    {
      // The gateway followed the meta-refresh hop and reports where it landed.
      url: `${D}/net/release-notes/`,
      response: {
        body: page('<h1>Release notes for 300.1</h1>'),
        finalUrl: `${D}/net/release-notes/release-notes-for-300-1/`,
        aliasChain: [`${D}/net/release-notes/`],
      },
    },
    {
      // A client that did not follow the hop: the stub itself, as the server sends it.
      url: 'https://location.arcgis.com/help/release-notes/',
      response: {
        body: `<!DOCTYPE html><meta http-equiv="refresh" content="0; url=/help/release-notes/2026-07/">`,
      },
    },
    {
      url: 'https://doc.esri.com/arcgis-pro/sitemap.xml',
      response: {
        body:
          `<?xml version="1.0"?><sitemapindex>` +
          `<sitemap><loc>https://doc.esri.com/en/arcgis-pro/latest/sitemap.xml</loc></sitemap>` +
          `<sitemap><loc>https://doc.esri.com/en/arcgis-pro/3.6/sitemap.xml</loc></sitemap>` +
          `<sitemap><loc>https://doc.esri.com/en/arcgis-pro/3.7/sitemap.xml</loc></sitemap>` +
          `</sitemapindex>`,
      },
    },
    { url: `${D}/javascript/latest/version-matrix/`, response: { body: MATRIX_HTML } },
    {
      url: 'https://doc.esri.com/en/widgets/latest/libraries.html',
      response: { body: LIBRARIES_HTML },
    },
    {
      url: 'https://support.esri.com/en-us/knowledge-base/sitemap-articles.xml',
      response: {
        body: urlset(
          [
            'how-to-do-something-unrelated-000012345',
            'deprecation-arcgis-maps-sdk-for-java-000032164',
            'deprecation-widgets-in-arcgis-maps-sdk-for-javascript-000040437',
            'deprecation-notice-arcgis-runtime-sdk-for-android-and-a-000030115',
            'deprecation-arcgis-geoevent-server-000041462',
            'problem-deprecated-function-warning-000055555',
          ].map((slug) => `https://support.esri.com/en-us/knowledge-base/${slug}`),
        ),
      },
    },
  ],
};
