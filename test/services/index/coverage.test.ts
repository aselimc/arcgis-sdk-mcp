import { describe, expect, it } from 'vitest';
import { buildCatalogIndex, coverage } from '../../../src/services/index/minisearch-index.js';
import { queryTerms } from '../../../src/services/index/query-terms.js';
import { makeRecord } from '../../support/builders.js';

const BASE = 'https://developers.arcgis.com/widgets';

describe('coverage', () => {
  const terms = queryTerms('group gauges with labels', new Map([['labels', ['call outs']]]));

  it('is the squared share of query words a record matches', () => {
    expect(terms.map((term) => term.whole)).toEqual(['group', 'gauges', 'labels']);
    expect(coverage(terms, new Set(['group', 'gauges', 'labels']))).toBe(1);
    expect(coverage(terms, new Set(['group', 'labels']))).toBeCloseTo(4 / 9);
    expect(coverage(terms, new Set(['group']))).toBeCloseTo(1 / 9);
    expect(coverage(terms, new Set())).toBe(0);
    expect(coverage([], new Set(['group']))).toBe(1);
  });

  it('counts a word as matched through its parts or a synonym phrase', () => {
    expect(coverage(terms, new Set(['group', 'gauges', 'call', 'outs']))).toBe(1);
    expect(coverage(terms, new Set(['group', 'gauges', 'call']))).toBeCloseTo(4 / 9);
    const camel = queryTerms('tideLayer refresh');
    expect(coverage(camel, new Set(['tide', 'layer', 'refresh']))).toBe(1);
    expect(coverage(camel, new Set(['tide', 'refresh']))).toBeCloseTo(1 / 4);
  });
});

// Regression: "cluster points with popups" listed eight API members that match one word in
// their symbol name above the sample whose title and description match the whole question.
describe('ranking when not every word has to match', () => {
  const sample = makeRecord({
    ref: `${BASE}/sample-code/group-gauges-labels/`,
    kind: 'sample',
    title: 'Grouping - label gauge groups',
    description: 'Group nearby gauges and show a label for each group.',
  });
  const members = ['GroupingSupportedLayer', 'GroupView', 'groupUtils', 'GroupOptions'].map(
    (name) =>
      makeRecord({
        ref: `${BASE}/references/${name}/`,
        kind: 'api',
        title: name,
        symbol: name,
        qualified: `@widgets/core/${name}`,
        symbolKind: 'class',
      }),
  );
  const index = buildCatalogIndex([...members, sample]);
  const terms = queryTerms('group gauges with callouts');

  it('has no record that matches every word, so the search falls back to any word', () => {
    expect(index.search(terms, 'and')).toEqual([]);
    const found = index.search(terms, 'or').map((match) => match.record.title);
    expect(found).toHaveLength(4);
    // One word of three, met only as the prefix of a longer word in the name: an accident.
    expect(found).not.toContain('GroupingSupportedLayer');
  });

  it('reports the share of the words each record matches', () => {
    const [first, ...rest] = index.search(terms, 'or');
    expect(first?.covered).toBeCloseTo(2 / 3);
    expect(rest.every((match) => match.covered < 0.5)).toBe(true);
  });

  it('puts the record that covers the question above records that match one word in a name', () => {
    const [first, ...rest] = index.search(terms, 'or');
    expect(first?.record.ref).toBe(sample.ref);
    expect(rest.every((match) => match.record.kind === 'api')).toBe(true);
    const scores = [first, ...rest].map((match) => match?.score ?? 0);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });
});
