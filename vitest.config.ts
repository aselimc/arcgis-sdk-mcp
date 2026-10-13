import { defineConfig } from 'vitest/config';

/**
 * Two projects:
 * - `unit` (what `npm test` runs): everything under `test/` except `test/live`. No network.
 * - `live` (`npm run test:live`): talks to the real upstream hosts; manual and canary only.
 *
 * Coverage is opt-in (`npm run test:coverage`) and carries the thresholds of design section 10.
 */
export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['test/**/*.test.ts'],
          exclude: ['test/live/**', 'test/fixtures/**', 'node_modules/**', 'dist/**'],
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
    // Keeps `--project live` green before any live test exists.
    passWithNoTests: true,
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
