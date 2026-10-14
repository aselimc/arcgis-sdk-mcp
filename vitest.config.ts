import { defineConfig } from 'vitest/config';

/**
 * Three projects:
 * - `unit` (what `npm test` runs): everything under `test/` except `test/e2e` and
 *   `test/live`. No network.
 * - `e2e` (`npm run test:e2e`, after a build): packs the tarball and drives the packed binary.
 * - `live` (`npm run test:live`): invariants on live-recorded upstream responses; manual and
 *   canary only.
 *
 * Coverage is opt-in (`npm run test:coverage`) and enforces the thresholds below.
 */
export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['test/**/*.test.ts'],
          exclude: [
            'test/live/**',
            'test/e2e/**',
            'test/fixtures/**',
            'node_modules/**',
            'dist/**',
          ],
          // Replaces the global fetch with a guard that rejects every non-loopback request.
          setupFiles: ['test/support/no-network.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'e2e',
          include: ['test/e2e/**/*.test.ts'],
          // Each test spawns the packed binary; `npm pack` runs once in the setup hook.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'live',
          include: ['test/live/**/*.test.ts'],
          // One upstream request at a time, and generous timeouts for cold index files.
          fileParallelism: false,
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
    ],
    environment: 'node',
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.ts'],
      exclude: [
        // Declarations only: nothing to execute.
        'src/core/ports.ts',
        'src/core/factories.ts',
        'src/**/*.d.ts',
        'src/**/*.generated.ts',
      ],
      thresholds: {
        lines: 90,
        branches: 85,
        'src/core/**': { lines: 100 },
        'src/policy/**': { lines: 100 },
        'src/extract/meta-refresh.ts': { lines: 100 },
        'src/services/search/esearch/filters.ts': { lines: 100 },
      },
    },
  },
});
