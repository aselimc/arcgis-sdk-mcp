import { describe, expect, it } from 'vitest';
import {
  belongsToLine,
  compareAtSharedPrecision,
  dateOfVersion,
  lineNumbers,
  normalizeVersion,
  parseDate,
  truncateVersion,
  versionFromSlugText,
  versionFromUrl,
} from '../../src/versions/version-text.js';
import { makeLine } from '../support/builders.js';

describe('normalizeVersion', () => {
  it.each([
    ['v2.4.4', '2.4.4'],
    ['300.1.0', '300.1.0'],
    ['300.1.0+5042', '300.1.0'],
    ['300.1.0.5042', '300.1.0'],
    ['3.7.0.1901', '3.7.0'],
    ['@esri/arcgis-rest-request@4.11.1', '4.11.1'],
    ['release-2.0', '2.0'],
    ['5.2.0-next.145', '5.2.0-next.145'],
    ['nightly', 'nightly'],
  ])('reads %s as %s', (raw, expected) => {
    expect(normalizeVersion(raw)).toBe(expected);
  });
});

describe('compareAtSharedPrecision', () => {
  it('lets a banner and a registry agree on the components both state', () => {
    expect(compareAtSharedPrecision('5.1', '5.1.27')).toBe(0);
    expect(compareAtSharedPrecision('300.1', '300.1.0+5042')).toBe(0);
  });

  it('orders versions that differ', () => {
    expect(compareAtSharedPrecision('2.4.4', '2.4.3')).toBe(1);
    expect(compareAtSharedPrecision('4.33', '5.1.27')).toBe(-1);
  });

  it('has no answer for text that is not a version', () => {
    expect(compareAtSharedPrecision('June 2026', '5.1')).toBeUndefined();
  });
});

describe('truncateVersion', () => {
  it('keeps the leading components', () => {
    expect(truncateVersion('5.1.27', 2)).toBe('5.1');
    expect(truncateVersion('v300.1.0', 2)).toBe('300.1');
    expect(truncateVersion('unknown', 2)).toBe('unknown');
  });
});

describe('version lines', () => {
  const v200 = makeLine({ id: 'v200', label: '200.x LTS', current: false });
  const latest = makeLine({ id: 'latest', label: '300.x' });
  const frozen = makeLine({ id: '2.3', label: 'Python 2.3', current: false });
  const unnumbered = makeLine({ id: 'latest', label: 'Current' });

  it('reads the numbers of a line from its id, then its label', () => {
    expect(lineNumbers(v200)).toEqual([200]);
    expect(lineNumbers(latest)).toEqual([300]);
    expect(lineNumbers(frozen)).toEqual([2, 3]);
    expect(lineNumbers(unnumbered)).toEqual([]);
  });

  it('assigns versions to lines by their leading numbers', () => {
    expect(belongsToLine('200.8.3', v200)).toBe(true);
    expect(belongsToLine('300.1.0', v200)).toBe(false);
    expect(belongsToLine('2.3.1', frozen)).toBe(true);
    expect(belongsToLine('2.4.4', frozen)).toBe(false);
    expect(belongsToLine('5.1', unnumbered)).toBe(false);
  });
});

describe('versionFromUrl', () => {
  it.each([
    ['https://developers.arcgis.com/net/release-notes/release-notes-for-300-1/', '300.1'],
    ['https://developers.arcgis.com/unity/release-notes/release-notes-2-4-0/', '2.4.0'],
    ['https://developers.arcgis.com/experience-builder/guide/1.20/whats-new/', '1.20'],
    ['https://developers.arcgis.com/javascript/latest/release-notes/4.10/', '4.10'],
    ['https://developers.arcgis.com/enterprise-sdk/guide/net/whats-new-12-1-net/', '12.1'],
    ['https://developers.arcgis.com/arcgis-urban-api/release-notes/2026-07-21/', '2026-07-21'],
    ['https://location.arcgis.com/help/release-notes/2026-07/', '2026-07'],
    ['/web-appbuilder/guide/whats-new-in-version-2-10.htm', '2.10'],
  ])('reads %s as %s', (url, expected) => {
    expect(versionFromUrl(url)).toBe(expected);
  });

  it('finds no version where the URL names none', () => {
    expect(versionFromUrl('https://developers.arcgis.com/javascript/latest/release-notes/')).toBe(
      undefined,
    );
    expect(
      versionFromUrl('https://developers.arcgis.com/arcgis-rest-js/release-notes/upgrade-v2-v3/'),
    ).toBe(undefined);
  });

  it('reads run-together digits only when asked to', () => {
    const url = 'https://developers.arcgis.com/python/latest/guide/release-notes-244/';
    expect(versionFromUrl(url)).toBeUndefined();
    expect(versionFromUrl(url, 'compact')).toBe('2.4.4');
    expect(versionFromUrl(url.replace('244', '100'), 'compact')).toBe('1.0.0');
  });
});

describe('versionFromSlugText', () => {
  it('turns a captured slug into a dotted version', () => {
    expect(versionFromSlugText('300-1')).toBe('300.1');
    expect(versionFromSlugText('244')).toBe('2.4.4');
    expect(versionFromSlugText('2.13.0')).toBe('2.13.0');
    expect(versionFromSlugText('2026-07-21')).toBe('2026-07-21');
    expect(versionFromSlugText('12')).toBe('12');
  });

  it('knows which versions are dates', () => {
    expect(dateOfVersion('2026-07-21')).toBe('2026-07-21');
    expect(dateOfVersion('2026-07')).toBe('2026-07');
    expect(dateOfVersion('300.1')).toBeUndefined();
  });
});

describe('parseDate', () => {
  it.each([
    ['June 2026', '2026-06'],
    ['August, 2026', '2026-08'],
    ['September 22, 2026', '2026-09-22'],
    ['May 21, 2026.', '2026-05-21'],
    ['Sept. 4, 2026', '2026-09-04'],
    ['8/5/2026', '2026-08-05'],
    ['2026-05-14T07:00:00Z', '2026-05-14'],
    ['2026-07', '2026-07'],
  ])('reads %s as %s', (text, expected) => {
    expect(parseDate(text)).toBe(expected);
  });

  it('rejects text without a date', () => {
    expect(parseDate('LAST RELEASE')).toBeUndefined();
    expect(parseDate('Release notes')).toBeUndefined();
    expect(parseDate(undefined)).toBeUndefined();
    expect(parseDate('')).toBeUndefined();
  });
});
