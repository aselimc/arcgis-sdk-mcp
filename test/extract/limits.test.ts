import { load } from 'cheerio';
import { describe, expect, it } from 'vitest';
import { findIn, isElement, moveInto, WORK_ROOT, workRoot } from '../../src/extract/dom.js';
import {
  MAX_CHILDREN,
  MAX_DEPTH,
  MAX_OPEN_TAGS,
  openTagDepth,
  shapeProblem,
} from '../../src/extract/limits.js';
import { detectMetaRefresh } from '../../src/extract/meta-refresh.js';
import { chunkWideElements, WIDE } from '../../src/extract/pipeline.js';
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

  it('keeps the text of a very wide element complete and in order', () => {
    const body = Array.from({ length: 1500 }, (_, index) => `<p>p${index}</p>`).join('');
    const lines = pageMarkdown(extractHtml(page(body)))
      .split('\n')
      .filter((line) => /^p\d+$/.test(line));
    expect(lines).toEqual(Array.from({ length: 1500 }, (_, index) => `p${index}`));
  });
});

// The selector engine and the Markdown converter both do work quadratic in the number of
// children of one element. Timing that on a shared machine is unreliable; what is tested is
// the three things that keep the width out of their way.
describe('wide documents', () => {
  it('holds the working content in one element, so a query never starts from thousands of nodes', () => {
    const $ = load(`<${WORK_ROOT}></${WORK_ROOT}>`, null, false);
    const source = load(page('<p>a</p>'.repeat(40)));
    const holder = workRoot($).get(0);
    expect(isElement(holder)).toBe(true);
    if (isElement(holder)) moveInto(holder, source('main').contents().get());
    expect($.root().children()).toHaveLength(1);
    expect($('p')).toHaveLength(40);
    expect(source('main').contents()).toHaveLength(0);
    expect($('p').first().prev()).toHaveLength(0);
    expect($('p').eq(1).prev().get(0)).toBe($('p').get(0));
    expect($('p').last().next()).toHaveLength(0);
  });

  it('moves nodes out of several parents and keeps what stays behind linked', () => {
    const $ = load(
      '<div id="a"><i>1</i><i>2</i><i>3</i></div><div id="b"><b>4</b></div><p></p>',
      null,
      false,
    );
    const target = $('p').get(0);
    const moved = [...$('#a i').slice(0, 2).get(), ...$('#b b').get()];
    if (isElement(target)) moveInto(target, moved);
    expect($.html()).toBe(
      '<div id="a"><i>3</i></div><div id="b"></div><p><i>1</i><i>2</i><b>4</b></p>',
    );
    expect($('#a i').prev()).toHaveLength(0);
  });

  it('finds below an element what `find` finds, in document order', () => {
    const $ = load('<main><section><h2>a</h2><div><h2>b</h2></div></section></main><h2>out</h2>');
    expect(findIn($, $('section'), 'h2, h3').text()).toBe($('section').find('h2, h3').text());
    expect(findIn($, $('main'), 'h2')).toHaveLength(2);
    expect(findIn($, $('nav'), 'h2')).toHaveLength(0);
  });

  it('groups the children of a very wide element, and leaves lists and tables as they are', () => {
    const items = '<li>x</li>'.repeat(WIDE * 2);
    const $ = load(
      `<${WORK_ROOT}>${'<p>a</p>'.repeat(WIDE * 3 + 5)}<ul>${items}</ul></${WORK_ROOT}>`,
      null,
      false,
    );
    chunkWideElements($);
    const widths = $('*')
      .get()
      .flatMap((el) => (isElement(el) && el.tagName !== 'ul' ? [el.children.length] : []));
    const widest = Math.max(...widths);
    expect(widest).toBeLessThanOrEqual(WIDE);
    expect($('p')).toHaveLength(WIDE * 3 + 5);
    expect($('ul').children('li')).toHaveLength(WIDE * 2);
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
      detectMetaRefresh(
        `${stub}${noise}<p>${'word '.repeat(80)}</p>`,
        'https://docs.example.com/a/',
      ),
    ).toBeUndefined();
  });

  it('reads mixed-case element names', () => {
    const html = `${stub}<SCRIPT>${'x = 1;'.repeat(600)}</SCRIPT>`;
    expect(detectMetaRefresh(html, 'https://docs.example.com/a/')).toBe(
      'https://docs.example.com/x',
    );
  });
});
