// @ts-check
/**
 * ESLint flat configuration.
 *
 * Besides the usual type-aware rules, this file encodes the architecture rules of the design
 * (section 5): which directory may import which. A violation is a lint error, so the layering
 * cannot erode silently.
 */
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Work packages and the `src/` directories each one owns. A package may import `src/core`
 * and its own directories, nothing else. Only the composition root crosses packages.
 */
const PACKAGES = {
  gateway: ['net', 'cache', 'policy'],
  registry: ['registry', 'versions', 'workspace'],
  extract: ['extract'],
  render: ['render'],
  siteAdapters: ['adapters/site'],
  referenceAdapters: ['adapters/reference'],
  services: ['services'],
  app: ['app', 'mcp', 'cli'],
};

/** Test directories of each package (under `test/`). */
const PACKAGE_TESTS = {
  gateway: ['net', 'cache', 'policy'],
  registry: ['registry', 'versions', 'workspace'],
  extract: ['extract'],
  render: ['render'],
  siteAdapters: ['adapters/site'],
  referenceAdapters: ['adapters/reference'],
  services: ['services'],
};

const ALL_DIRS = Object.values(PACKAGES).flat();

const NO_DEFAULT_EXPORT = {
  selector: 'ExportDefaultDeclaration',
  message: 'Use named exports only (design section 5, rule 5).',
};

/** Escapes a directory name for use inside a regular expression. */
const esc = (/** @type {string} */ dir) => dir.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&');

/**
 * `no-restricted-imports` patterns forbidding relative imports into other packages.
 * `adapters/site` and `adapters/reference` share a parent directory, so siblings are matched
 * by their last segment as well.
 *
 * @param {string[]} own directories of the importing package
 * @param {string} prefix `''` for files under `src/`, `'src/'` for files under `test/`
 */
function foreignPackagePatterns(own, prefix) {
  const foreign = ALL_DIRS.filter((dir) => !own.includes(dir));
  const names = new Set();
  for (const dir of foreign) {
    names.add(esc(dir));
    const [parent, child] = dir.split('/');
    // From inside src/adapters/site, the sibling is reached as "../reference/...".
    if (child !== undefined && own.some((ownDir) => ownDir.startsWith(`${parent}/`))) {
      names.add(esc(child));
    }
  }
  return [
    {
      regex: `^(?:\\.\\.?/)+${esc(prefix)}(?:${[...names].join('|')})(?:/|$)`,
      message:
        'A package imports only src/core and its own directories. Reach other packages through Ctx or the ports in src/core/ports.ts (design section 5, rule 2).',
    },
  ];
}

const NODE_IO_MODULES = [
  'fs',
  'fs/promises',
  'http',
  'https',
  'http2',
  'net',
  'tls',
  'dgram',
  'child_process',
  'worker_threads',
].flatMap((name) => [name, `node:${name}`]);

/** Rule 4: adapters, services, extraction and rendering do no I/O of their own. */
const NO_DIRECT_IO = {
  paths: NODE_IO_MODULES.map((name) => ({
    name,
    message:
      'Use ctx.http and ctx.cache; this layer does no I/O of its own (design section 5, rule 4).',
  })),
};

const NO_FETCH = [
  { name: 'fetch', message: 'Use ctx.http: every request goes through the policy gateway.' },
];

const NO_PROCESS_ENV = [
  {
    object: 'process',
    property: 'env',
    message: 'Read configuration from ctx.config; only src/cli passes process.env to loadConfig.',
  },
];

/** @param {string[]} dirs */
const srcGlobs = (dirs) => dirs.map((dir) => `src/${dir}/**/*.ts`);
/** @param {string[]} dirs */
const testGlobs = (dirs) => dirs.map((dir) => `test/${dir}/**/*.ts`);

const layering = Object.entries(PACKAGES).map(([name, dirs]) => ({
  name: `layering/src/${name}`,
  files: name === 'app' ? [...srcGlobs(dirs), 'src/index.ts'] : srcGlobs(dirs),
  rules: {
    'no-restricted-imports': [
      'error',
      {
        // I/O is the business of the gateway (net, cache), workspace detection and the CLI.
        ...(name === 'gateway' || name === 'app' ? {} : NO_DIRECT_IO),
        patterns: foreignPackagePatterns(dirs, ''),
      },
    ],
  },
}));

const testLayering = Object.entries(PACKAGE_TESTS).map(([name, dirs]) => ({
  name: `layering/test/${name}`,
  files: testGlobs(dirs),
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: foreignPackagePatterns(
          PACKAGES[/** @type {keyof typeof PACKAGES} */ (name)],
          'src/',
        ),
      },
    ],
  },
}));

export default tseslint.config(
  {
    name: 'ignores',
    ignores: ['dist/', 'coverage/', 'node_modules/', 'test/fixtures/', '**/*.generated.ts'],
  },

  js.configs.recommended,

  {
    name: 'typescript',
    files: ['**/*.ts'],
    extends: [tseslint.configs.recommendedTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: true },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // Interfaces and type aliases are both used on purpose (ports are interfaces, unions are types).
      '@typescript-eslint/consistent-type-definitions': 'off',
      // `T[]` for simple element types and `Array<...>` for object literals, as in the design's contracts.
      '@typescript-eslint/array-type': ['error', { default: 'array-simple' }],
      '@typescript-eslint/prefer-nullish-coalescing': [
        'error',
        { ignorePrimitives: { boolean: true } },
      ],
      eqeqeq: ['error', 'always'],
      'no-restricted-syntax': ['error', NO_DEFAULT_EXPORT],
    },
  },

  {
    name: 'source',
    files: ['src/**/*.ts'],
    rules: {
      // stdout carries JSON-RPC in stdio mode; diagnostics go through the Logger (stderr).
      'no-console': 'error',
    },
  },

  {
    name: 'layering/src/core',
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              // Anything that is not a sibling file or zod.
              regex: '^(?!\\./|zod(?:/|$))',
              message:
                'src/core imports only its own files and zod (design section 5, rule 1). node:crypto is allowed in hash.ts only.',
            },
          ],
        },
      ],
      'no-restricted-globals': ['error', ...NO_FETCH],
      'no-restricted-properties': ['error', ...NO_PROCESS_ENV],
    },
  },
  {
    name: 'layering/src/core/hash',
    files: ['src/core/hash.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(?!\\./|zod(?:/|$)|node:crypto$)',
              message: 'hash.ts may import node:crypto and nothing else outside src/core.',
            },
          ],
        },
      ],
    },
  },

  ...layering,
  ...testLayering,

  {
    name: 'layering/no-direct-io',
    files: srcGlobs([
      'adapters/site',
      'adapters/reference',
      'services',
      'extract',
      'render',
      'registry',
      'versions',
    ]),
    rules: {
      'no-restricted-globals': ['error', ...NO_FETCH],
      'no-restricted-properties': ['error', ...NO_PROCESS_ENV],
    },
  },
  {
    // Workspace detection reads package manifests in the project directory.
    name: 'layering/workspace-exception',
    files: ['src/workspace/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: foreignPackagePatterns(PACKAGES.registry, '') },
      ],
    },
  },
  {
    // The one adapter file that reads the user's node_modules (capability `local-packages`).
    name: 'layering/local-packages-exception',
    files: ['src/adapters/reference/npm/local-packages.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: foreignPackagePatterns(PACKAGES.referenceAdapters, '') },
      ],
    },
  },
  {
    // Rule 3: only the composition root imports the other packages' factories.
    name: 'layering/composition-root',
    files: ['src/app/composition-root.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },

  {
    name: 'tests',
    files: ['test/**/*.ts'],
    rules: {
      // Test doubles implement async ports without awaiting, and assertions index freely.
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
  {
    name: 'tooling',
    files: ['vitest.config.ts', '*.config.mjs', '*.config.js'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    name: 'plain-javascript',
    files: ['**/*.mjs', '**/*.js', '**/*.cjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', URL: 'readonly' },
    },
  },
);
