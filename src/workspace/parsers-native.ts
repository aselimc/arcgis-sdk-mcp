/**
 * Manifest readers for the native ecosystems: MSBuild project files (NuGet), `pubspec.yaml`
 * and `pubspec.lock` (pub), Gradle build scripts and version catalogs (Maven), and
 * `Package.resolved` (Swift Package Manager).
 */
import { dependency, type Dependency } from './dependency.js';

const attribute = (attributes: string, name: string): string | undefined =>
  new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(attributes)?.[1];

/**
 * `*.csproj`, `Directory.Packages.props`, `Directory.Build.props`: `PackageReference` and
 * `PackageVersion` items, with the version as an attribute or a child element. A reference
 * without a version (central package management) is kept with an empty version; the
 * detector fills it from the props file.
 */
export function parseCsproj(text: string): Dependency[] {
  const found: Dependency[] = [];
  const items = /<(PackageReference|PackageVersion)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1\s*>)/gi;
  for (const item of text.matchAll(items)) {
    const attributes = item[2] ?? '';
    const name = attribute(attributes, 'Include') ?? attribute(attributes, 'Update');
    if (name === undefined) continue;
    const version =
      attribute(attributes, 'VersionOverride') ??
      attribute(attributes, 'Version') ??
      /<Version>\s*([^<]*?)\s*<\/Version>/i.exec(item[3] ?? '')?.[1];
    found.push(dependency('nuget', name, version));
  }
  return found;
}

const PUB_SECTIONS = /^(?:dependencies|dev_dependencies|dependency_overrides)\s*:/;

/** `pubspec.yaml`: the three dependency maps; `name: ^1.2.3` or a nested `version:` key. */
export function parsePubspec(text: string): Dependency[] {
  const found: Dependency[] = [];
  const lines = text.split(/\r?\n/);
  let inSection = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? '';
    if (/^\S/.test(line)) {
      inSection = PUB_SECTIONS.test(line);
      continue;
    }
    const entry = /^ {2}([A-Za-z_][\w]*)\s*:\s*(.*?)\s*(?:#.*)?$/.exec(line);
    if (!inSection || entry?.[1] === undefined) continue;
    let spec = (entry[2] ?? '').replace(/^["']|["']$/g, '');
    if (spec === '') {
      // Hosted, git and path dependencies spell their details on the following deeper lines.
      for (let next = index + 1; /^ {3,}\S/.test(lines[next] ?? ''); next++) {
        const nested = /^\s+version\s*:\s*["']?([^"'#]+?)["']?\s*(?:#.*)?$/.exec(lines[next] ?? '');
        if (nested?.[1] !== undefined) spec = nested[1];
      }
    }
    found.push(dependency('pub', entry[1], spec));
  }
  return found;
}

/** `pubspec.lock`: the resolved version of every package. */
export function parsePubspecLock(text: string): Dependency[] {
  const found: Dependency[] = [];
  let inPackages = false;
  let name: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    if (/^\S/.test(line)) {
      inPackages = /^packages\s*:/.test(line);
      continue;
    }
    if (!inPackages) continue;
    const entry = /^ {2}([A-Za-z_][\w]*)\s*:\s*$/.exec(line);
    if (entry?.[1] !== undefined) {
      name = entry[1];
      continue;
    }
    const version = /^ {4}version\s*:\s*["']?([^"'\s]+)["']?/.exec(line)?.[1];
    if (name !== undefined && version !== undefined) {
      found.push(dependency('pub', name, version, true));
      name = undefined;
    }
  }
  return found;
}

/** `group:artifact[:version]` inside a quoted string; the group must look like a Maven group id. */
const MAVEN_COORDINATE =
  /["']([A-Za-z][\w-]*(?:\.[\w-]+)+):([A-Za-z][\w.-]*)(?::([^"'@:]+))?(?:@\w+)?["']/g;

/** `build.gradle` / `build.gradle.kts`: dependency coordinates; a `$name` version is looked up in the same file. */
export function parseGradle(text: string): Dependency[] {
  const variable = (name: string): string | undefined =>
    new RegExp(`\\b${name}\\b["')\\]]*\\s*(?:=|,)\\s*["']([^"']+)["']`).exec(text)?.[1];
  const found: Dependency[] = [];
  for (const coordinate of text.matchAll(MAVEN_COORDINATE)) {
    const [, group, artifact, rawVersion] = coordinate;
    if (group === undefined || artifact === undefined) continue;
    const reference = /^\$\{?([A-Za-z_][\w.]*)\}?$/.exec(rawVersion ?? '')?.[1];
    const version =
      reference === undefined ? rawVersion : variable(reference.split('.').at(-1) ?? reference);
    found.push(dependency('maven', `${group}:${artifact}`, version));
  }
  return found;
}

/** `gradle/libs.versions.toml`: `[libraries]` entries in module, group/name or string form. */
export function parseVersionCatalog(text: string): Dependency[] {
  const versions = new Map<string, string>();
  const libraries: string[] = [];
  let table = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const header = /^\[([^\]]+)\]/.exec(line)?.[1];
    if (header !== undefined) {
      table = header.trim();
      continue;
    }
    const assignment = /^([\w.-]+)\s*=\s*(.+)$/.exec(line);
    if (assignment?.[1] === undefined || assignment[2] === undefined) continue;
    if (table === 'versions') {
      const value = /^["']([^"']*)["']/.exec(assignment[2])?.[1];
      if (value !== undefined) versions.set(assignment[1], value);
    } else if (table === 'libraries') {
      libraries.push(assignment[2]);
    }
  }

  const found: Dependency[] = [];
  const quoted = (source: string, key: string): string | undefined =>
    new RegExp(`\\b${key}\\s*=\\s*["']([^"']*)["']`).exec(source)?.[1];
  for (const value of libraries) {
    const short = /^["']([^"':]+):([^"':]+)(?::([^"']+))?["']/.exec(value);
    const module = quoted(value, 'module');
    const group = short?.[1] ?? module?.split(':')[0] ?? quoted(value, 'group');
    const artifact = short?.[2] ?? module?.split(':')[1] ?? quoted(value, 'name');
    if (group === undefined || artifact === undefined) continue;
    const reference = quoted(value, 'version\\.ref') ?? quoted(value, 'ref');
    const version =
      short?.[3] ?? (reference === undefined ? quoted(value, 'version') : versions.get(reference));
    found.push(dependency('maven', `${group}:${artifact}`, version));
  }
  return found;
}

/** `Package.resolved` (format 1, 2 and 3): the pinned version of every Swift package. */
export function parsePackageResolved(text: string): Dependency[] {
  let resolved: unknown;
  try {
    resolved = JSON.parse(text);
  } catch {
    return [];
  }
  const root = resolved as { pins?: unknown; object?: { pins?: unknown } } | null;
  const pins = root?.pins ?? root?.object?.pins;
  if (!Array.isArray(pins)) return [];
  const found: Dependency[] = [];
  for (const pin of pins as Array<Record<string, unknown> | null>) {
    const location = pin?.location ?? pin?.repositoryURL;
    const fromUrl =
      typeof location === 'string'
        ? location
            .replace(/\.git$/, '')
            .split('/')
            .at(-1)
        : undefined;
    const identity = typeof pin?.identity === 'string' ? pin.identity : fromUrl;
    if (identity === undefined || identity === '') continue;
    const state = pin?.state as { version?: unknown } | undefined;
    // A branch or revision pin has no version.
    const version = typeof state?.version === 'string' ? state.version : undefined;
    found.push(dependency('swiftpm', identity.toLowerCase(), version, version !== undefined));
  }
  return found;
}
