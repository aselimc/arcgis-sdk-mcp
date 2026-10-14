/**
 * Oracle `plc`: Esri's product life cycle API, the backend of the life-cycle pages on
 * support.esri.com. It is an undocumented endpoint, so it runs only with the opt-in
 * capability `lifecycle-api`.
 *
 * Options: `category` (required: `Developer`, `Foundational`, `Apps`, ...), `productName`
 * (default the product's name), `platform` (as written in the life-cycle page markup, for
 * example `NA`).
 *
 * Rules from the research: always pass `category` (the unfiltered call has a reduced shape);
 * read only the whitelisted fields (records carry internal staff names and SharePoint URLs);
 * every patch is its own record, so records are grouped by major.minor; a general-availability
 * date in the future, or none, means the version is not released.
 */
import type { Clock } from '../../core/ports.js';
import type { VersionFact } from '../../core/types.js';
import { compareVersions, parseVersion } from '../../core/version-key.js';
import { parseDate, truncateVersion } from '../version-text.js';
import { asRecord, asText, defineOracle, option, requestOptions } from './kit.js';

/** The fields of a life-cycle record this server reads. Nothing else leaves this module. */
interface LifecycleRecord {
  productName: string;
  version: string;
  ga?: string;
  mature?: string;
  retirement?: string;
}

/** One major.minor release with the dates of its first record. */
interface LifecycleGroup {
  key: string;
  ga?: string;
  mature?: string;
  retirement?: string;
}

function toRecord(raw: unknown): LifecycleRecord | undefined {
  const fields = asRecord(raw);
  const productName = asText(fields?.productName);
  const version = asText(fields?.releaseVersion);
  if (fields === undefined || productName === undefined || version === undefined) return undefined;
  const ga = parseDate(asText(fields.generalAvailability));
  const mature = parseDate(asText(fields.mature));
  const retirement = parseDate(asText(fields.retirement));
  return {
    productName,
    version,
    ...(ga === undefined ? {} : { ga }),
    ...(mature === undefined ? {} : { mature }),
    ...(retirement === undefined ? {} : { retirement }),
  };
}

/** `3.7.2` and `3.7` share the key `3.7`; a name such as `2026.R02` is its own key. */
function groupKey(version: string): string {
  return parseVersion(version).length >= 2 ? truncateVersion(version, 2) : version;
}

/** Groups records by release; the earliest general-availability date is the release date. */
function groupRecords(records: readonly LifecycleRecord[]): LifecycleGroup[] {
  const groups = new Map<string, LifecycleGroup>();
  for (const record of records) {
    const key = groupKey(record.version);
    const group = groups.get(key) ?? { key };
    if (record.ga !== undefined && (group.ga === undefined || record.ga < group.ga)) {
      group.ga = record.ga;
    }
    if (group.mature === undefined && record.mature !== undefined) group.mature = record.mature;
    if (group.retirement === undefined && record.retirement !== undefined) {
      group.retirement = record.retirement;
    }
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** Released groups, newest first: by version when both parse, else by release date. */
function releasedNewestFirst(groups: readonly LifecycleGroup[], clock: Clock): LifecycleGroup[] {
  const today = clock.today();
  return groups
    .filter((group) => group.ga !== undefined && group.ga <= today)
    .sort((a, b) => {
      const numeric = parseVersion(a.key).length > 0 && parseVersion(b.key).length > 0;
      return numeric ? compareVersions(b.key, a.key) : (b.ga ?? '').localeCompare(a.ga ?? '');
    });
}

/** Reads the life-cycle records of one product and reports the dates of one release. */
export const plcOracle = defineOracle('plc', 'lifecycle-api', async (ctx, product, spec, run) => {
  const category = option(spec, 'category');
  if (category === undefined) return [];
  const productName = option(spec, 'productName') ?? product.name;
  const platform = option(spec, 'platform');
  const query = new URLSearchParams({ locale: 'en-us', category, productName });
  if (platform !== undefined) query.set('platform', platform);
  const url = `https://plc-api.esri.com/api/PLC?${query.toString()}`;

  const { data } = await ctx.http.getJson({ url, ttl: 'volatile', ...requestOptions(run) });
  if (!Array.isArray(data)) return [];
  const records = data
    .map(toRecord)
    .filter(
      (record): record is LifecycleRecord =>
        record?.productName.toLowerCase() === productName.toLowerCase(),
    );
  const released = releasedNewestFirst(groupRecords(records), ctx.clock);
  const group =
    run.version === undefined
      ? released[0]
      : released.find((candidate) => candidate.key === groupKey(run.version ?? ''));
  if (group === undefined) return [];

  const facts: VersionFact[] = [];
  for (const tag of ['ga', 'mature', 'retirement'] as const) {
    const value = group[tag];
    if (value !== undefined) {
      facts.push({ role: 'lifecycle', value, date: value, tag, oracle: 'plc', url });
    }
  }
  return facts;
});
