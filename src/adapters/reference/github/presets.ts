/**
 * The presets of the `github-repo` adapter: what each one reads from a repository tree and
 * how a path is classified. A preset is a way of reading a repository, not a list of
 * repositories; the registry picks one per source and narrows it with `include` / `exclude`.
 *
 * | Preset | Catalogue | A document is |
 * |---|---|---|
 * | `samples-metadata` | one record per directory with a `README.metadata.json` | README + metadata + the source files the metadata lists |
 * | `samples-readme` | one record per innermost directory with a README | README + the directory's main source files |
 * | `markdown-docs` | one record per Markdown or `.proto` file | the file |
 * | `notebooks` | one record per `.ipynb` file | the notebook |
 * | `snippets-region` | one record per source file and per `#region` in it | the regions as titled code blocks |
 * | `wiki` | one record per page linked from the wiki sidebar | the wiki page |
 */
import { matchesAnyGlob } from '../../../core/glob.js';
import type { AdapterConfigMap, DocKind } from '../../../core/types.js';
import { baseOf, extensionOf } from './shared.js';

/** Configuration of a `github-repo` source. */
export type GithubConfig = AdapterConfigMap['github-repo'];

/** Name of a preset. */
export type Preset = GithubConfig['preset'];

/** One entry of a repository tree, as the GitHub client lists it. */
export interface TreeFile {
  path: string;
  size?: number;
}

/** What a preset reads when the registry gives no `include` / `exclude` of its own. */
interface PresetSpec {
  /** Kind of its records when the source declares none. */
  kind: DocKind;
  /** Globs of the files that make up its catalogue. */
  include: readonly string[];
}

const PRESETS: Record<Preset, PresetSpec> = {
  'samples-metadata': { kind: 'sample', include: ['**'] },
  'samples-readme': { kind: 'sample', include: ['**'] },
  'markdown-docs': { kind: 'guide', include: ['**/*.md', '**/*.markdown', '**/*.proto'] },
  notebooks: { kind: 'sample', include: ['**/*.ipynb'] },
  'snippets-region': { kind: 'sample', include: ['**/*.cs'] },
  wiki: { kind: 'guide', include: [] },
};

/**
 * Paths no preset reads, whatever the registry includes: dependency and build output,
 * editor and CI configuration, notebook checkpoints and repository housekeeping files.
 */
const NOISE = [
  '**/node_modules/**',
  '**/bin/**',
  '**/obj/**',
  '**/.github/**',
  '**/.vscode/**',
  '**/.ipynb_checkpoints/**',
  '**/CONTRIBUTING.md',
  '**/CODE_OF_CONDUCT.md',
  '**/SECURITY.md',
  '**/LICENSE.md',
];

/** Extensions that are never text worth returning to an agent. */
const BINARY = new Set([
  ...['png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'webp', 'tif', 'tiff', 'svgz', 'psd'],
  ...['zip', 'gz', 'tgz', 'tar', '7z', 'rar', 'jar', 'aar', 'nupkg', 'whl'],
  ...['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'],
  ...['dll', 'exe', 'so', 'dylib', 'lib', 'pdb', 'class', 'pyc', 'wasm'],
  ...['mp3', 'mp4', 'mov', 'avi', 'wav', 'ttf', 'otf', 'woff', 'woff2', 'eot'],
  ...['uasset', 'umap', 'unity', 'prefab', 'asset', 'mat', 'fbx', 'glb', 'slpk', 'tpkx', 'vtpk'],
  ...['geodatabase', 'mmpk', 'mspk', 'gdb', 'shp', 'dbf', 'shx', 'lyrx', 'aprx', 'stylx'],
]);

/** Source files a sample is made of (the readable part of a sample directory). */
const CODE = new Set([
  ...['swift', 'kt', 'kts', 'java', 'cs', 'xaml', 'daml', 'cpp', 'h', 'hpp', 'qml', 'dart'],
  ...['js', 'mjs', 'ts', 'tsx', 'jsx', 'html', 'css', 'py', 'r', 'sql', 'proto', 'sh', 'ps1'],
]);

/** The kind of a preset's records: the first kind the source declares, else the preset's own. */
export function presetKind(preset: Preset, declared: readonly DocKind[]): DocKind {
  return declared[0] ?? PRESETS[preset].kind;
}

/**
 * True when a repository path belongs to a source: it matches the registry's `include`
 * (default: the preset's own globs), no `exclude` glob and none of the noise globs. Globs
 * follow `glob.ts`: `*` stays inside one segment, `**` crosses segments.
 */
export function inScope(path: string, config: GithubConfig): boolean {
  const include = config.include ?? PRESETS[config.preset].include;
  if (!matchesAnyGlob(path, include)) return false;
  return !matchesAnyGlob(path, [...NOISE, ...(config.exclude ?? [])]);
}

/** The files of a tree that belong to a source, in path order. */
export function filesInScope(tree: readonly TreeFile[], config: GithubConfig): TreeFile[] {
  return tree
    .filter((file) => inScope(file.path, config))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** `README.md` in any letter case (`readme.md`, `ReadMe.md`). */
export function isReadme(path: string): boolean {
  return /^readme\.(?:md|markdown)$/i.test(baseOf(path));
}

/** `README.metadata.json` in any letter case. */
export function isSampleMetadata(path: string): boolean {
  return /^readme\.metadata\.json$/i.test(baseOf(path));
}

/** A Markdown file. */
export function isMarkdown(path: string): boolean {
  return ['md', 'markdown', 'mdx'].includes(extensionOf(path));
}

/** A Jupyter notebook. */
export function isNotebook(path: string): boolean {
  return extensionOf(path) === 'ipynb';
}

/** A file that cannot be returned as text (images, archives, binaries, data sets). */
export function isBinary(path: string): boolean {
  return BINARY.has(extensionOf(path));
}

/** A source-code file of a sample. */
export function isCode(path: string): boolean {
  return CODE.has(extensionOf(path));
}

/** The kind of one Markdown file: change logs are release notes, everything else `fallback`. */
export function kindOfFile(path: string, fallback: DocKind): DocKind {
  return /^(?:changelog|release[-_ ]?notes|whats[-_ ]?new)\b/i.test(baseOf(path))
    ? 'release-notes'
    : fallback;
}

/**
 * The platform a path belongs to in a multi-platform samples repository (`src/MAUI/...`,
 * `src/WPF/...`, `src/WinUI/...`), lower-case; `undefined` elsewhere.
 */
export function platformOf(path: string): string | undefined {
  return path
    .split('/')
    .find((segment) => /^(?:maui|wpf|winui)$/i.test(segment))
    ?.toLowerCase();
}
