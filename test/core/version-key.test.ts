import { describe, expect, it } from 'vitest';
import {
  compareVersions,
  isPrerelease,
  maxVersion,
  parseVersion,
} from '../../src/core/version-key.js';

describe('parseVersion', () => {
  it.each([
    ['300.1.0', [300, 1, 0]],
    ['v300.1.0', [300, 1, 0]],
    ['V200.8.0', [200, 8, 0]],
    ['300.1.0+5042', [300, 1, 0]],
    ['300-1', [300, 1]],
    ['300-1-0', [300, 1, 0]],
    ['2026.2', [2026, 2]],
    ['5.2.0-next.20261001', [5, 2, 0]],
    ['2.5.0rc1', [2, 5, 0]],
    ['200.8.0-4605', [200, 8, 0]],
    ['  3.7  ', [3, 7]],
    ['12', [12]],
    ['v200', [200]],
  ])('%s -> %j', (input, expected) => {
    expect(parseVersion(input)).toEqual(expected);
  });

  it.each(['', 'latest', 'next', 'version-5'])('gives [] for %j', (input) => {
    expect(parseVersion(input)).toEqual([]);
  });
});

describe('isPrerelease', () => {
  it.each([
    '5.2.0-next.20261001',
    '300.2.0-beta',
    '300.2.0-beta.3',
    '2.5.0rc1',
    '1.0.0b3',
    '1.0.0a1',
    '2.5.0.dev0',
    '1.0.0-alpha',
    '4.0.0-rc.1',
    '200.8.0-4605',
    '300-beta',
    '1.2.3-SNAPSHOT',
    '1.2.3-preview.1',
  ])('%s is a pre-release', (input) => {
    expect(isPrerelease(input)).toBe(true);
  });

  it.each([
    '5.1.0',
    'v300.1.0',
    '300.1.0+5042',
    '300-1',
    '2026.2',
    '1.0.post1',
    '3.7 (Pro)',
    '1.2.3-build',
    'latest',
    '',
  ])('%s is not a pre-release', (input) => {
    expect(isPrerelease(input)).toBe(false);
  });
});

describe('compareVersions', () => {
  it('orders numerically, not lexically', () => {
    expect(compareVersions('4.9', '4.10')).toBeLessThan(0);
    expect(compareVersions('300.1.0', '200.8.0')).toBeGreaterThan(0);
    expect(compareVersions('2026.2', '2026.10')).toBeLessThan(0);
  });

  it('treats missing components as zero and ignores decoration', () => {
    expect(compareVersions('5.1', '5.1.0')).toBe(0);
    expect(compareVersions('v300.1.0', '300.1.0+5042')).toBe(0);
    expect(compareVersions('300-1', '300.1')).toBe(0);
  });

  it('sorts a pre-release before its release', () => {
    expect(compareVersions('5.2.0-next.1', '5.2.0')).toBeLessThan(0);
    expect(compareVersions('5.2.0', '5.2.0-next.1')).toBeGreaterThan(0);
    expect(compareVersions('5.2.0-next.1', '5.1.9')).toBeGreaterThan(0);
    expect(compareVersions('5.2.0-beta', '5.2.0-rc')).toBe(0);
  });

  it('sorts unparseable strings first', () => {
    expect(compareVersions('latest', '1.0')).toBeLessThan(0);
    expect(compareVersions('1.0', 'latest')).toBeGreaterThan(0);
    expect(compareVersions('latest', 'next')).toBe(0);
  });

  it('is usable as an Array.sort comparator', () => {
    const sorted = ['4.33.1', '5.0.0', '4.9.0', '5.1.0-next.3', '5.1.0', '4.33'].sort(
      compareVersions,
    );
    expect(sorted).toEqual(['4.9.0', '4.33', '4.33.1', '5.0.0', '5.1.0-next.3', '5.1.0']);
  });
});

describe('maxVersion', () => {
  it('returns the highest parseable version as written', () => {
    expect(maxVersion(['4.33.0', 'v5.1.0', '5.0.2'])).toBe('v5.1.0');
    expect(maxVersion(['5.1.0-next.2', '5.1.0'])).toBe('5.1.0');
    // dist-tags `latest` and `lts-*`: max semver over the values.
    expect(maxVersion(['4.9.0', '4.12.3'])).toBe('4.12.3');
  });

  it('skips unparseable entries and gives undefined when nothing parses', () => {
    expect(maxVersion(['latest', '2.4.3', 'next'])).toBe('2.4.3');
    expect(maxVersion(['latest'])).toBeUndefined();
    expect(maxVersion([])).toBeUndefined();
  });

  it('keeps the first of equal versions', () => {
    expect(maxVersion(['5.1', '5.1.0'])).toBe('5.1');
  });
});
