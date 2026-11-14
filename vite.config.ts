import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => ({
  // GitHub Pages serves the site at /poor-fantasy/; local dev uses /.
  base: process.env.GITHUB_PAGES ? '/poor-fantasy/' : '/',
  build: { chunkSizeWarningLimit: 2000 }, // Phaser alone is ~1.2 MB
  test: {
    // `npm run sim` (mode "sim") runs the balance simulator instead of the unit tests.
    include: mode === 'sim' ? ['tests/**/*.sim.ts'] : ['tests/**/*.test.ts'],
    environment: 'node',
  },
}));
