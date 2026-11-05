import { defineConfig } from 'vitest/config';

/** Developer labs that run game code under Vitest but aren't part of `npm test`. */
export default defineConfig({
  test: { include: ['tools/labs/**/*.lab.ts'], environment: 'node' },
});
