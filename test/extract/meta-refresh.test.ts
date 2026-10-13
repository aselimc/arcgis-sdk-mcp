import { describe, expect, it } from 'vitest';
import { detectMetaRefresh } from '../../src/extract/index.js';
import { FAMILY_CASES, fixtureHtml } from './support.js';

const BASE = 'https://docs.example.com/harbor/latest/api-reference/harbor-Chart.html';

/** The four stub shapes seen live, rebuilt with fictional paths. */
const STUBS: Array<[shape: string, html: string, target: string]> = [
  [
    'A: bare meta after the doctype',
    '<!DOCTYPE html><meta http-equiv="refresh" content="0; url=/harbor/latest/references/core/Chart/">',
    'https://docs.example.com/harbor/latest/references/core/Chart/',
  ],
  [
    'B: self-closing meta with a quoted URL',
    `<meta http-equiv="refresh" content="0; URL='/help/release-notes/2026-07/'" />`,
    'https://docs.example.com/help/release-notes/2026-07/',
  ],
  [
    'C: full document with an empty body',
    [
      '<html><head>',
      '<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">',
      '<META NAME="ROBOTS" CONTENT="NOINDEX, NOFOLLOW">',
      '<meta http-equiv="refresh" content="0;url=/en/harbor-online/get-started/what-is-harbor.htm" />',
      '</head><body></body></html>',
    ].join('\n'),
    'https://docs.example.com/en/harbor-online/get-started/what-is-harbor.htm',
  ],
  [
    'D: byte order mark, no body, trailing space in the value',
    '﻿<html><head><meta http-equiv="refresh" content="0;url=/en/harbor-desk/latest/sdk/api-reference/topic1.html "></head></html>',
    'https://docs.example.com/en/harbor-desk/latest/sdk/api-reference/topic1.html',
  ],
];

/** A page-sized body: more than 2 KB of markup and more than 200 characters of text. */
const realPage = (head: string): string =>
  `<!doctype html><html><head>${head}<title>Guide</title></head><body><main>${'<p>Charts draw layers of harbor data in the order they were added.</p>'.repeat(40)}</main></body></html>`;

describe('detectMetaRefresh', () => {
  it.each(STUBS)('follows stub shape %s', (_shape, html, target) => {
    expect(detectMetaRefresh(html, BASE)).toBe(target);
  });

  it.each([
    ['an unquoted attribute value', '<meta http-equiv=refresh content=0;url=/moved/>', 'https://docs.example.com/moved/'],
    ['upper-case attribute names', '<META HTTP-EQUIV="REFRESH" CONTENT="0; URL=/moved/">', 'https://docs.example.com/moved/'],
    ['entity-encoded quotes', '<meta http-equiv="refresh" content="0; url=&#x27;/moved/&#x27;">', 'https://docs.example.com/moved/'],
    ['double quotes inside single quotes', `<meta http-equiv='refresh' content='0; url="/moved/?a=1&amp;b=2"'>`, 'https://docs.example.com/moved/?a=1&b=2'],
    ['content before http-equiv', '<meta content="0; url=/moved/" http-equiv="refresh">', 'https://docs.example.com/moved/'],
    ['an absolute target', '<meta http-equiv="refresh" content="0; url=https://other.example.org/x">', 'https://other.example.org/x'],
    ['a delay and a comma', '<meta http-equiv="refresh" content="2.5, /moved/">', 'https://docs.example.com/moved/'],
    ['a relative target', '<meta http-equiv="refresh" content="0; url=../core/Chart/">', 'https://docs.example.com/harbor/latest/core/Chart/'],
  ])('resolves %s', (_case, html, target) => {
    expect(detectMetaRefresh(html, BASE)).toBe(target);
  });

  it('follows a refresh in a long document that has no visible text', () => {
    const padding = `<script>${'var a = 1;'.repeat(400)}</script>`;
    const html = `<html><head><meta http-equiv="refresh" content="0; url=/moved/">${padding}</head><body></body></html>`;
    expect(html.length).toBeGreaterThan(2048);
    expect(detectMetaRefresh(html, BASE)).toBe('https://docs.example.com/moved/');
  });

  it.each([
    ['a page without a refresh tag', realPage('')],
    ['an empty document', ''],
    ['a timed reload without a URL', '<meta http-equiv="refresh" content="30">'],
    ['a refresh tag without content', '<meta http-equiv="refresh">'],
    ['an empty content value', '<meta http-equiv="refresh" content="">'],
    ['a value that is not a delay', '<meta http-equiv="refresh" content="soon; url=/moved/">'],
    ['a quoted empty target', `<meta http-equiv="refresh" content="0; url=''">`],
    ['a real page that carries a refresh tag', realPage('<meta http-equiv="refresh" content="900; url=/session-expired/">')],
    ['a target that is not a URL', '<meta http-equiv="refresh" content="0; url=http://[bad">'],
  ])('returns undefined for %s', (_case, html) => {
    expect(detectMetaRefresh(html, BASE)).toBeUndefined();
  });

  it('ignores a refresh tag beyond the first 4 KB', () => {
    const html = `<html><head>${'<!-- padding -->'.repeat(300)}<meta http-equiv="refresh" content="0; url=/moved/"></head></html>`;
    expect(detectMetaRefresh(html, BASE)).toBeUndefined();
  });

  it('has no false positive on the page-shaped fixtures of every family', () => {
    for (const { family, url } of FAMILY_CASES) {
      expect(detectMetaRefresh(fixtureHtml(family), url), family).toBeUndefined();
    }
  });

  it('has no false positive on a not-found page body', () => {
    const notFound = `<!doctype html><html><head><meta charset="utf-8"><meta name="generator" content="Gatsby 5.14.1"><title>Page not found</title></head><body><div id="___gatsby"><main id="main"><h1>Page not found</h1><p>The page you asked for does not exist. It may have moved, or the address may be mistyped.</p>${'<p><a href="/">Back to the documentation home</a></p>'.repeat(30)}</main></div></body></html>`;
    expect(detectMetaRefresh(notFound, BASE)).toBeUndefined();
  });
});
