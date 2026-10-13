import { load } from 'cheerio';
import { describe, expect, it } from 'vitest';
import {
  MAX_CHILDREN,
  MAX_DEPTH,
  MAX_OPEN_TAGS,
  openTagDepth,
  shapeProblem,
} from '../../src/extract/limits.js';
import { detectMetaRefresh } from '../../src/extract/meta-refresh.js';
import { extractHtml, pageMarkdown } from './support.js';

const page = (body: string): string =>
  `<html><head><title>Flood</title></head><body><main>${body}</main></body></html>`;

/** Milliseconds `run` takes. */
function timed(run: () => unknown): number {
  const started = performance.now();
  run();
  return performance.now() - started;
}

/**
 * Generous bound for inputs that used to take from tens of seconds to hours: an order of
 * magnitude above what they take now, so that a slow CI machine does not fail the test and
 * a return of the quadratic behaviour does.
 */
const BOUND_MS = 5000;

describe('shape limits', () => {
  it('accepts an ordinary document', () => {
    expect(shapeProblem(load(page('<h2>a</h2><p>b</p><ul><li>c</li></ul>')))).toBeUndefined();
  });

  it('names the limit a document passes', () => {
    expect(shapeProblem(load(page('<i>x</i>'.repeat(MAX_CHILDREN + 1))))).toContain('children');
    expect(
      shapeProblem(load(`${'<div>'.repeat(MAX_DEPTH + 10)}x${'</div>'.repeat(MAX_DEPTH + 10)}`)),
    ).toContain('nested');
  });

  it('estimates the nesting of markup without parsing it', () => {
    expect(openTagDepth('<div><p>a<p>b<br><img src="x"><span>c</span></div>')).toBe(2);
    expect(openTagDepth('<ul><li>a<li>b<li>c</ul>')).toBe(1);
    expect(openTagDepth('<b>'.repeat(50))).toBe(50);
    expect(openTagDepth('')).toBe(0);
  });
});

// Regression: conversion is synchronous, so nothing can interrupt it. A few hundred
// kilobytes of repeated markup took from a minute to hours, and deep nesting ended in a
// stack overflow that escaped `extract`.
describe('documents built to be expensive', () => {
  it('returns a link-only page for a document nested too deep, without parsing it', () => {
    const html = page('<div>'.repeat(20_000));
    let result = extractHtml('<p>x</p>');
    const ms = timed(() => {
      result = extractHtml(html);
    });
    expect(ms).toBeLessThan(BOUND_MS);
    expect(result.degraded?.level).toBe('link-only');
    expect(result.degraded?.reason).toContain(String(MAX_OPEN_TAGS));
    expect(result.title).toBe('Flood');
    expect(pageMarkdown(result)).toContain('https://docs.example.com/page/');
  });

  it('returns a link-only page for a document that is too wide', () => {
    const result = extractHtml(page('<h2>a</h2>'.repeat(26_000)));
    expect(result.degraded?.level).toBe('link-only');
    expect(result.sections).toHaveLength(1);
  });

  it.each([
    ['headings', '<h2>a</h2>'],
    ['links', '<a href="x">a</a> '],
    ['paragraphs', '<p>hello world</p>'],
    ['list items', '<li>x</li>'],
  ])('converts thousands of %s within the limits in bounded time', (_name, unit) => {
    const html = page(unit.repeat(8_000));
    let chars = 0;
    const ms = timed(() => {
      chars = pageMarkdown(extractHtml(html)).length;
    });
    expect(ms).toBeLessThan(BOUND_MS);
    expect(chars).toBeGreaterThan(8_000);
  });

  it('keeps the text of a very wide element complete and in order', () => {
    const body = Array.from({ length: 1500 }, (_, index) => `<p>p${index}</p>`).join('');
    const lines = pageMarkdown(extractHtml(page(body)))
      .split('\n')
      .filter((line) => /^p\d+$/.test(line));
    expect(lines).toEqual(Array.from({ length: 1500 }, (_, index) => `p${index}`));
  });
});

describe('detectMetaRefresh on hostile bodies', () => {
  const stub = '<html><meta http-equiv="refresh" content="0;url=/x">';

  // Regression: `<script[\s\S]*?</script>` rescanned the rest of the body from every
  // unclosed `<script`: 256 KB took 20 seconds, and the gateway runs this on every HTML body.
  it.each(['<script', '<style', '<!--', '<', '<a '])('scans %s repeated in linear time', (unit) => {
    const html = stub + unit.repeat(Math.ceil((2 * 1024 * 1024) / unit.length));
    const ms = timed(() => detectMetaRefresh(html, 'https://docs.example.com/a/'));
    expect(ms).toBeLessThan(BOUND_MS / 5);
  });

  it('does not count scripts, styles, comments or markup as text', () => {
    const noise =
      `<script>${'var a = 1;'.repeat(200)}</script><style>${'p{}'.repeat(300)}</style>` +
      `<!-- ${'note '.repeat(200)} --><div class="${'x'.repeat(600)}"></div>`;
    expect(detectMetaRefresh(`${stub}${noise}`, 'https://docs.example.com/a/')).toBe(
      'https://docs.example.com/x',
    );
    expect(
      detectMetaRefresh(`${stub}${noise}<p>${'word '.repeat(80)}</p>`, 'https://docs.example.com/a/'),
    ).toBeUndefined();
  });

  it('reads mixed-case element names', () => {
    const html = `${stub}<SCRIPT>${'x = 1;'.repeat(600)}</SCRIPT>`;
    expect(detectMetaRefresh(html, 'https://docs.example.com/a/')).toBe(
      'https://docs.example.com/x',
    );
  });
});
