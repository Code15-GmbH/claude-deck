import { defineConfig } from 'vitest/config';

// Unit tests (npm test) and coverage (npm run test:coverage). Separate from vite.config.js,
// whose root is web/.
export default defineConfig({
  test: {
    include: ['test/**/*.test.mjs'],
    environment: 'node',
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    coverage: {
      provider: 'v8',
      include: ['server/**/*.mjs', 'hook/**/*.mjs', 'scripts/**/*.mjs', 'plugin/src/**/*.js', 'plugin/scripts/**/*.mjs', 'web/src/**/*.{js,jsx}'],
      exclude: [
        // entry points that only wire modules together
        'hook/claude-deck-hook.mjs',
        'plugin/src/plugin.js',
        'web/src/main.jsx',
        // React view (DOM, EventSource, AudioContext); its logic lives in web/src/lib.js
        'web/src/App.jsx',
        // dev tool that plays fake sessions against a running server
        'scripts/simulate.mjs',
      ],
      reporter: [['text', { skipFull: false }], 'lcov', 'json-summary'],
      reportsDirectory: 'coverage',
      // keep the bar close to the current numbers so coverage cannot silently drop
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 90 },
    },
  },
});
