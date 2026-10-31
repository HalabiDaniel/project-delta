import { defineConfig } from 'vitest/config';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  // Relative asset paths so the built game also runs from a sub-folder or a static file host.
  base: './',
  // The version shown in the menu comes from package.json, never typed by hand.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: {
    target: 'es2022',
    // The bundle is dominated by the PlayCanvas engine (~1.5 MB minified); that is expected.
    chunkSizeWarningLimit: 2500,
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
