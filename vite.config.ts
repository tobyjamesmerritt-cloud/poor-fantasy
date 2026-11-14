import { defineConfig } from 'vitest/config';

export default defineConfig({
  // GitHub Pages serves the site at /poor-fantasy/; local dev uses /.
  base: process.env.GITHUB_PAGES ? '/poor-fantasy/' : '/',
  build: { chunkSizeWarningLimit: 2000 }, // Phaser alone is ~1.2 MB
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
