/**
 * Manifest readers for the JavaScript and Python ecosystems: `package.json`,
 * `requirements*.txt`, `pyproject.toml` and conda `environment.yml`. Each one is a small
 * line scanner for the dependency sections only, so no TOML or YAML parser is needed.
 */
import { dependency, type Dependency } from './dependency.js';

const NPM_SECTIONS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];

/** `package.json`: the four dependency maps. */
export function parsePackageJson(text: string): Dependency[] {
  let manifest: unknown;
  try {
    manifest = JSON.parse(text);
  } catch {
    return [];
  }
  if (typeof manifest !== 'object' || manifest === null) return [];
  const found: Dependency[] = [];
  for (const section of NPM_SECTIONS) {
    const entries = (manifest as Record<string, unknown>)[section];
    if (typeof entries !== 'object' || entries === null || Array.isArray(entries)) continue;
    for (const [name, spec] of Object.entries(entries)) {
      if (typeof spec === 'string') found.push(dependency('npm', name, spec));
    }
  }
  return found;
}

/**
 * `package-lock.json`: the version npm installed for each package. Lock file versions 2 and
 * 3 list them under `packages["node_modules/<name>"]`, version 1 under `dependencies`. Only
 * top-level installs count: a copy nested inside another package is that package's business.
 */
export function parsePackageLock(text: string): Dependency[] {
  let lock: unknown;
  try {
    lock = JSON.parse(text);
  } catch {
    return [];
  }
  if (typeof lock !== 'object' || lock === null) return [];
  const { packages, dependencies } = lock as Record<string, unknown>;
  const found: Dependency[] = [];
  const take = (name: string, entry: unknown): void => {
    const version = (entry as { version?: unknown } | null)?.version;
    if (typeof version === 'string') found.push(dependency('npm', name, version, true));
  };
  if (typeof packages === 'object' && packages !== null && !Array.isArray(packages)) {
    for (const [path, entry] of Object.entries(packages)) {
      const name = /^node_modules\/((?:@[^/]+\/)?[^/]+)$/.exec(path)?.[1];
      if (name !== undefined) take(name, entry);
    }
  } else if (
    typeof dependencies === 'object' &&
    dependencies !== null &&
    !Array.isArray(dependencies)
  ) {
    for (const [name, entry] of Object.entries(dependencies)) take(name, entry);
  }
  return found;
}

/** A PEP 508 or conda requirement: optional channel, name, optional extras, optional first version clause. */
const REQUIREMENT =
  /^(?:[\w.-]+::)?([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?\s*(?:(===|==|~=|>=|<=|!=|=|>|<)\s*([^\s;,#=]+))?/;

/** Reads one requirement string (`arcgis[notebook]>=2.4`, `esri::arcpy=3.7`); `undefined` for options and URLs. */
function requirement(spec: string): Dependency | undefined {
  const line = spec.replace(/\s+#.*$/, '').trim();
  if (line === '' || line.startsWith('-') || line.startsWith('#') || /^[\w+.-]+:\/\//.test(line)) {
    return undefined;
  }
  const match = REQUIREMENT.exec(line);
  if (match?.[1] === undefined) return undefined;
  const exact = match[2] === '==' || match[2] === '===' || match[2] === '=';
  return dependency(
    'pypi',
    match[1],
    // With its operator, so that a range is reported as the manifest writes it.
    match[3] === undefined ? undefined : `${match[2] ?? ''}${match[3]}`,
    match[3] !== undefined && exact && !match[3].includes('*'),
  );
}

/** `requirements*.txt`: one requirement per line; options (`-r`, `-e`, `--index-url`) are skipped. */
export function parseRequirements(text: string): Dependency[] {
  return text
    .split(/\r?\n/)
    .map(requirement)
    .filter((found): found is Dependency => found !== undefined);
}

/** Tables of `pyproject.toml` whose arrays hold requirement strings. */
const REQUIREMENT_ARRAY_TABLE =
  /^(?:project|project\.optional-dependencies|dependency-groups|build-system|tool\.uv|tool\.pdm\.dev-dependencies)$/;
/** In `[project]` and similar tables only these keys are dependency arrays. */
const REQUIREMENT_ARRAY_KEY = /^(?:dependencies|requires|dev-dependencies)$/;
/** Tables that map a package name to a version (Poetry). */
const NAME_VERSION_TABLE = /^tool\.poetry\.(?:group\.[\w-]+\.)?(?:dev-)?dependencies$/;

/** `pyproject.toml`: PEP 621 dependency arrays, dependency groups and Poetry tables. */
export function parsePyproject(text: string): Dependency[] {
  const found: Dependency[] = [];
  let table = '';
  let inArray = false;
  const takeStrings = (fragment: string): void => {
    for (const quoted of fragment.matchAll(/"([^"]*)"|'([^']*)'/g)) {
      const parsed = requirement(quoted[1] ?? quoted[2] ?? '');
      if (parsed !== undefined) found.push(parsed);
    }
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (inArray) {
      takeStrings(line);
      if (/\]\s*(?:#.*)?$/.test(line)) inArray = false;
      continue;
    }
    const header = /^\[{1,2}\s*([^\]]+?)\s*\]{1,2}\s*(?:#.*)?$/.exec(line);
    if (header?.[1] !== undefined) {
      table = header[1];
      continue;
    }
    const assignment = /^([A-Za-z0-9_."-]+)\s*=\s*(.*)$/.exec(line);
    if (assignment?.[1] === undefined || assignment[2] === undefined) continue;
    const key = assignment[1].replace(/"/g, '');
    const value = assignment[2];

    if (NAME_VERSION_TABLE.test(table)) {
      // `arcgis = "^2.4"` or `arcgis = { version = "^2.4", extras = [...] }`.
      const spec =
        /^["']([^"']*)["']/.exec(value)?.[1] ?? /version\s*=\s*["']([^"']*)["']/.exec(value)?.[1];
      if (key !== 'python') found.push(dependency('pypi', key, spec));
      continue;
    }
    const isList =
      REQUIREMENT_ARRAY_TABLE.test(table) &&
      (REQUIREMENT_ARRAY_KEY.test(key) || /optional-dependencies|dependency-groups/.test(table));
    if (!isList || !value.startsWith('[')) continue;
    takeStrings(value);
    inArray = !/\]\s*(?:#.*)?$/.test(value);
  }
  return found;
}

/** Conda `environment.yml`: every list item under `dependencies:`, including the nested `pip:` list. */
export function parseCondaEnvironment(text: string): Dependency[] {
  const found: Dependency[] = [];
  let inDependencies = false;
  for (const raw of text.split(/\r?\n/)) {
    if (/^\S/.test(raw)) {
      // A top-level key starts or ends the dependencies block.
      inDependencies = /^dependencies\s*:/.test(raw);
      continue;
    }
    const item = /^\s*-\s+(.+?)\s*$/.exec(raw)?.[1];
    if (!inDependencies || item === undefined || item.endsWith(':')) continue;
    const parsed = requirement(item.replace(/^["']|["']$/g, ''));
    if (parsed !== undefined) found.push(parsed);
  }
  return found;
}
