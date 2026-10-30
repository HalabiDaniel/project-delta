import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset paths so the built game also runs from a sub-folder or a static file host.
  base: './',
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
