import { describe, expect, it } from 'vitest';
import { isMcpDocError, type McpDocError } from '../../src/core/errors.js';
import {
  canonicalize,
  githubBlobToRaw,
  pageKey,
  parseGithubUrl,
  rawToGithubBlob,
  slugify,
  splitRef,
} from '../../src/core/url.js';

function thrown(fn: () => unknown): McpDocError {
  try {
    fn();
  } catch (error) {
    if (isMcpDocError(error)) return error;
    throw error;
  }
  throw new Error('expected the call to throw');
}

describe('canonicalize', () => {
  it.each([
    // https, credentials and ports
    ['http://developers.arcgis.com/widgets/', 'https://developers.arcgis.com/widgets/'],
    ['https://DEVELOPERS.ArcGIS.com/widgets/', 'https://developers.arcgis.com/widgets/'],
    [
      'https://user:pw@developers.arcgis.com:443/widgets/',
      'https://developers.arcgis.com/widgets/',
    ],
    ['http://developers.arcgis.com:8080/widgets/', 'https://developers.arcgis.com/widgets/'],
    ['developers.arcgis.com/widgets/', 'https://developers.arcgis.com/widgets/'],
    ['  https://developers.arcgis.com/widgets/  ', 'https://developers.arcgis.com/widgets/'],
    // tracking parameters and highlight
    [
      'https://developers.arcgis.com/widgets/?utm_source=x&utm_medium=y&gclid=1',
      'https://developers.arcgis.com/widgets/',
    ],
    [
      'https://developers.arcgis.com/widgets/?highlight=cluster#usage',
      'https://developers.arcgis.com/widgets/#usage',
    ],
    [
      'https://developers.arcgis.com/rest/thing/?f=json&rsource=nav',
      'https://developers.arcgis.com/rest/thing/?f=json',
    ],
    // index.html, live/, duplicate slashes
    ['https://developers.arcgis.com/widgets/index.html', 'https://developers.arcgis.com/widgets/'],
    [
      'https://developers.arcgis.com/javascript/latest/sample-code/intro/live/',
      'https://developers.arcgis.com/javascript/latest/sample-code/intro/',
    ],
    ['https://developers.arcgis.com//widgets///a/', 'https://developers.arcgis.com/widgets/a/'],
    // doc.esri.com numbered versions
    [
      'https://doc.esri.com/en/arcgis-pro/3.7/arcpy/main/reference.html',
      'https://doc.esri.com/en/arcgis-pro/latest/arcpy/main/reference.html',
    ],
    [
      'https://doc.esri.com/en/arcgis-enterprise/12/portal/',
      'https://doc.esri.com/en/arcgis-enterprise/latest/portal/',
    ],
    [
      'https://doc.esri.com/en/arcgis-pro/latest/arcpy/',
      'https://doc.esri.com/en/arcgis-pro/latest/arcpy/',
    ],
  ])('%s -> %s', (input, expected) => {
    expect(canonicalize(input)).toBe(expected);
  });

  it('leaves numbered path segments alone on other hosts', () => {
    const url = 'https://pro.arcgis.com/en/pro-app/3.6/arcpy/main.htm';
    expect(canonicalize(url)).toBe(url);
  });

  it('keeps the fragment and unrelated query parameters, and is idempotent', () => {
    const once = canonicalize('http://developers.arcgis.com/a/index.html?b=1&utm_x=2#Frag-1');
    expect(once).toBe('https://developers.arcgis.com/a/?b=1#Frag-1');
    expect(canonicalize(once)).toBe(once);
  });

  it('rejects other schemes with HOST_NOT_ALLOWED', () => {
    for (const url of [
      'file:///etc/passwd',
      'ftp://developers.arcgis.com/x',
      'javascript:alert(1)',
    ]) {
      expect(thrown(() => canonicalize(url)).code, url).toBe('HOST_NOT_ALLOWED');
    }
  });

  it('rejects text that is not a URL with DOC_NOT_FOUND and a search to try', () => {
    for (const text of ['FeatureLayer', 'cluster points', '', 'https://', 'a b.com/x']) {
      const error = thrown(() => canonicalize(text));
      expect(error.code, text).toBe('DOC_NOT_FOUND');
      expect(error.details?.next, text).toMatch(/^arcgis_docs_search\(\{"query":/);
    }
  });
});

describe('parseGithubUrl', () => {
  it('parses blob, raw and tree URLs', () => {
    expect(parseGithubUrl('https://github.com/Esri/example/blob/main/docs/a%20b.md')).toEqual({
      repo: 'Esri/example',
      ref: 'main',
      path: 'docs/a b.md',
    });
    expect(parseGithubUrl('https://github.com/Esri/example/raw/v1.2.0/README.md')).toEqual({
      repo: 'Esri/example',
      ref: 'v1.2.0',
      path: 'README.md',
    });
    expect(parseGithubUrl('https://github.com/Esri/example/tree/main')).toEqual({
      repo: 'Esri/example',
      ref: 'main',
    });
  });

  it('parses repository roots and wiki pages', () => {
    expect(parseGithubUrl('https://github.com/Esri/example')).toEqual({ repo: 'Esri/example' });
    expect(parseGithubUrl('https://github.com/Esri/example.git')).toEqual({ repo: 'Esri/example' });
    expect(parseGithubUrl('https://github.com/Esri/example/wiki')).toEqual({
      repo: 'Esri/example',
      wikiPage: 'Home',
    });
    expect(parseGithubUrl('https://github.com/Esri/example/wiki/ProGuide-Build')).toEqual({
      repo: 'Esri/example',
      wikiPage: 'ProGuide-Build',
    });
  });

  it('parses raw-host URLs, including refs/heads and wiki pages', () => {
    expect(parseGithubUrl('https://raw.githubusercontent.com/Esri/example/main/a/b.md')).toEqual({
      repo: 'Esri/example',
      ref: 'main',
      path: 'a/b.md',
    });
    expect(
      parseGithubUrl('https://raw.githubusercontent.com/Esri/example/refs/heads/main/a.md'),
    ).toEqual({ repo: 'Esri/example', ref: 'main', path: 'a.md' });
    expect(
      parseGithubUrl('https://raw.githubusercontent.com/Esri/example/refs/tags/v2/a.md'),
    ).toEqual({ repo: 'Esri/example', ref: 'v2', path: 'a.md' });
    expect(parseGithubUrl('https://raw.githubusercontent.com/wiki/Esri/example/Home.md')).toEqual({
      repo: 'Esri/example',
      wikiPage: 'Home',
    });
  });

  it('returns undefined for everything else', () => {
    for (const url of [
      'not a url',
      'https://developers.arcgis.com/widgets/',
      'https://github.com/Esri',
      'https://github.com/Esri/example/issues/3',
      'https://github.com/Esri/example/blob',
      'https://raw.githubusercontent.com/Esri',
      'https://raw.githubusercontent.com/Esri/example',
      'https://raw.githubusercontent.com/wiki/Esri/example',
    ]) {
      expect(parseGithubUrl(url), url).toBeUndefined();
    }
  });

  it('keeps a malformed percent escape as written', () => {
    expect(parseGithubUrl('https://github.com/Esri/example/blob/main/a%zz.md')?.path).toBe(
      'a%zz.md',
    );
  });
});

describe('githubBlobToRaw and rawToGithubBlob', () => {
  const pairs: Array<[blob: string, raw: string]> = [
    [
      'https://github.com/Esri/example/blob/main/docs/guide.md',
      'https://raw.githubusercontent.com/Esri/example/main/docs/guide.md',
    ],
    [
      'https://github.com/Esri/example/blob/v200.8.0/Shared/Samples/Add%20layer/README.md',
      'https://raw.githubusercontent.com/Esri/example/v200.8.0/Shared/Samples/Add%20layer/README.md',
    ],
    [
      'https://github.com/Esri/example/wiki/ProGuide-Build',
      'https://raw.githubusercontent.com/wiki/Esri/example/ProGuide-Build.md',
    ],
  ];

  it.each(pairs)('maps %s to raw and back', (blob, raw) => {
    expect(githubBlobToRaw(blob)).toBe(raw);
    expect(rawToGithubBlob(raw)).toBe(blob);
  });

  it('drops the fragment, which the raw host does not understand', () => {
    expect(githubBlobToRaw('https://github.com/Esri/example/blob/main/README.md#usage')).toBe(
      'https://raw.githubusercontent.com/Esri/example/main/README.md',
    );
  });

  it('returns undefined when the URL does not name a file or wiki page', () => {
    expect(githubBlobToRaw('https://github.com/Esri/example')).toBeUndefined();
    expect(githubBlobToRaw('https://github.com/Esri/example/tree/main')).toBeUndefined();
    expect(githubBlobToRaw('https://developers.arcgis.com/widgets/')).toBeUndefined();
    expect(rawToGithubBlob('https://developers.arcgis.com/widgets/')).toBeUndefined();
    expect(rawToGithubBlob('https://raw.githubusercontent.com/Esri/example/main')).toBeUndefined();
  });
});

describe('slugify', () => {
  it.each([
    ['Get started', 'get-started'],
    ["What's new in 5.1?", 'whats-new-in-51'],
    ['queryFeatures()', 'queryfeatures'],
    ['  Spaces   and --- dashes  ', 'spaces-and-dashes'],
    ['snake_case_name', 'snake-case-name'],
    ['Élan vital', 'elan-vital'],
    ['地図 を 作成', '地図-を-作成'],
    ['`code` and **bold**', 'code-and-bold'],
    ['???', 'section'],
    ['', 'section'],
  ])('%j -> %s', (heading, slug) => {
    expect(slugify(heading)).toBe(slug);
  });
});

describe('splitRef', () => {
  it('splits a URL into the canonical URL and its decoded fragment', () => {
    const { url, fragment, brief } = splitRef(
      'http://developers.arcgis.com/widgets/index.html?utm_source=x#query%20features',
    );
    expect(url?.href).toBe('https://developers.arcgis.com/widgets/#query%20features');
    expect(fragment).toBe('query features');
    expect(brief).toBeUndefined();
  });

  it('omits the fragment when there is none', () => {
    const result = splitRef('https://developers.arcgis.com/widgets/');
    expect(result.url?.href).toBe('https://developers.arcgis.com/widgets/');
    expect('fragment' in result).toBe(false);
    expect('fragment' in splitRef('https://developers.arcgis.com/widgets/#')).toBe(false);
  });

  it('keeps a fragment with a malformed escape as written', () => {
    expect(splitRef('https://developers.arcgis.com/widgets/#100%').fragment).toBe('100%');
  });

  it('parses brief refs', () => {
    expect(splitRef('brief:ai/overview')).toEqual({ brief: 'ai/overview' });
    expect(splitRef(' Brief:AI/Overview#Constraints ')).toEqual({
      brief: 'ai/overview',
      fragment: 'Constraints',
    });
    expect(splitRef('brief:/js/4x-to-5x/')).toEqual({ brief: 'js/4x-to-5x' });
  });

  it('rejects malformed brief slugs and non-URLs with DOC_NOT_FOUND', () => {
    for (const ref of [
      'brief:',
      'brief:../../etc/passwd',
      'brief:a b',
      'FeatureLayer.queryFeatures',
    ]) {
      expect(thrown(() => splitRef(ref)).code, ref).toBe('DOC_NOT_FOUND');
    }
  });

  it('rejects other schemes with HOST_NOT_ALLOWED', () => {
    expect(thrown(() => splitRef('file:///c:/secret.txt')).code).toBe('HOST_NOT_ALLOWED');
  });
});

describe('pageKey', () => {
  it('drops fragment, query and trailing slashes, so links and catalogue refs agree', () => {
    expect(pageKey('https://d.example/api/buoy/#sink')).toBe('https://d.example/api/buoy');
    expect(pageKey('https://d.example/api/buoy')).toBe('https://d.example/api/buoy');
    expect(pageKey('https://d.example/api/buoy.html?v=2#sink')).toBe(
      'https://d.example/api/buoy.html',
    );
    expect(pageKey('https://d.example/api/buoy/sink(depth:)/')).toBe(
      'https://d.example/api/buoy/sink(depth:)',
    );
  });
});
