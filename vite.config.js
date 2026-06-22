import { defineConfig } from 'vite';

// Static site. `public/` (with assets/) is copied to the build root as-is, so
// the runtime GLB is fetched at /assets/t-p.glb in both dev and production.
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsInlineLimit: 0,
  },
});
