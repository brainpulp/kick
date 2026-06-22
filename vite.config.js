import { defineConfig } from 'vite';

// Build stamp so the live page always shows which build it is (the deploy
// runner sets GITHUB_SHA; in dev we fall back to a timestamp).
const BUILD = (process.env.GITHUB_SHA || '').slice(0, 7)
  || new Date().toISOString().replace('T', ' ').slice(0, 16);

// Static site. `public/` (with assets/) is copied to the build root as-is, so
// the runtime GLB is fetched at /assets/t-p.glb in both dev and production.
export default defineConfig({
  base: './',
  define: { __BUILD__: JSON.stringify(BUILD) },
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsInlineLimit: 0,
  },
});
