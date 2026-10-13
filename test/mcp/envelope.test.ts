import { describe, expect, it } from 'vitest';
import { attribution } from '../../src/core/attribution.js';
import { formatCall, truncationNext } from '../../src/core/budget.js';
import { TOOLS } from '../../src/core/names.js';
import { LICENSE_TIERS } from '../../src/core/types.js';
import { compact } from '../../src/mcp/compact.js';
import {
  bodyBudget,
  ENVELOPE_RESERVE_TOKENS,
  type Envelope,
  renderEnvelope,
  sourceLine,
  statusLine,
  structuredResult,
  textResult,
} from '../../src/mcp/envelope.js';

const URL = 'https://developers.arcgis.com/widgets/get-started/';
const PAGE_LINE = attribution('esri-website-terms', {
  url: URL,
  retrievedAt: '2026-10-13T12:00:00.000Z',
  cache: 'hit',
});

describe('statusLine', () => {
  it('joins the facts that are present', () => {
    expect(statusLine(['Get started', undefined, 'guide', ''])).toBe('Get started | guide');
  });

  it('states a lower rung last', () => {
    expect(statusLine(['Get started', 'guide'], 'generic-extractor, selector removed')).toBe(
      'Get started | guide | degraded: generic-extractor, selector removed',
    );
    expect(statusLine(['Get started'], '')).toBe('Get started');
  });
});

describe('renderEnvelope', () => {
  const envelope: Envelope = {
    status: 'Get started | guide',
    notes: ['Served from a stale copy.'],
    body: '\n# Get started\n\nText.\n\n',
    next: formatCall(TOOLS.read, { ref: URL, section: 'install' }),
    attribution: { kind: 'page', line: PAGE_LINE },
  };

  it('orders status, notes, body, Next and Source', () => {
    expect(renderEnvelope(envelope)).toBe(
      [
        'Get started | guide',
        'Note: Served from a stale copy.',
        '',
        '# Get started',
        '',
        'Text.',
        '',
        `Next: arcgis_docs_read({"ref":"${URL}","section":"install"})`,
        `Source: Esri, ${URL} (retrieved 2026-10-13, cached). Copyright (c) Esri. Use subject to Esri's terms: https://www.esri.com/en-us/legal/overview`,
      ].join('\n'),
    );
  });

  it('prints exactly one Next: prefix whether or not the caller supplied it', () => {
    const args = { ref: URL, cursor: 'abc' };
    const text = renderEnvelope({ ...envelope, next: truncationNext(TOOLS.read, args) });
    expect(text.match(/^Next: /gm)).toHaveLength(1);
    expect(text).toContain(`\nNext: ${formatCall(TOOLS.read, args)}\n`);
  });

  it('omits the lines that have nothing to say', () => {
    expect(
      renderEnvelope({ status: 'Products', body: '- a', attribution: { kind: 'project' } }),
    ).toBe('Products\n\n- a');
    expect(
      renderEnvelope({ status: 'No hits', body: '', next: '', attribution: { kind: 'project' } }),
    ).toBe('No hits');
  });
});

// Regression: a read with max_tokens 2000 answered with about 2,400 tokens, because the
// whole budget went to the body and the status, Next and Source lines came on top.
describe('bodyBudget', () => {
  it('leaves room for the envelope inside max_tokens', () => {
    expect(bodyBudget(6000)).toBe(6000 - ENVELOPE_RESERVE_TOKENS);
    expect(bodyBudget(500)).toBe(300);
  });

  it('never goes below what a declaration needs', () => {
    expect(bodyBudget(300)).toBe(150);
  });
});

describe('sourceLine', () => {
  it('passes the line of a page through unchanged for every licence tier', () => {
    for (const tier of LICENSE_TIERS) {
      const line = attribution(tier, { url: URL, retrievedAt: '2026-10-13', cache: 'miss' });
      expect(sourceLine({ kind: 'page', line })).toBe(line);
    }
  });

  it('attributes a list of refs to Esri unless all of it is project data', () => {
    const listing = sourceLine({
      kind: 'listing',
      licenses: ['project', 'apache-2.0'],
      retrievedOn: '2026-10-13T12:00:00.000Z',
    });
    expect(listing).toMatch(
      /^Source: Esri documentation at the refs above \(retrieved 2026-10-13\)\./,
    );
    expect(listing).toContain('https://www.esri.com/en-us/legal/overview');
    expect(sourceLine({ kind: 'listing', licenses: ['project'], retrievedOn: '2026-10-13' })).toBe(
      '',
    );
    expect(sourceLine({ kind: 'listing', licenses: [], retrievedOn: '2026-10-13' })).toBe('');
    expect(sourceLine({ kind: 'project' })).toBe('');
  });
});

describe('results', () => {
  const envelope: Envelope = { status: 'S', body: 'B', attribution: { kind: 'project' } };

  it('builds a text result, with _meta only when given', () => {
    expect(textResult(envelope)).toEqual({ content: [{ type: 'text', text: 'S\n\nB' }] });
    expect(textResult(envelope, { 'arcgis-docs/ref': URL })).toEqual({
      content: [{ type: 'text', text: 'S\n\nB' }],
      _meta: { 'arcgis-docs/ref': URL },
    });
  });

  it('builds a structured result with the same facts as text', () => {
    expect(structuredResult(envelope, { total: 0 })).toEqual({
      content: [{ type: 'text', text: 'S\n\nB' }],
      structuredContent: { total: 0 },
    });
  });
});

describe('compact', () => {
  it('drops undefined properties and keeps every other value', () => {
    const value = compact({ a: 1, b: undefined, c: null, d: false, e: '' });
    expect(value).toEqual({ a: 1, c: null, d: false, e: '' });
    expect(Object.keys(value)).toEqual(['a', 'c', 'd', 'e']);
  });
});
