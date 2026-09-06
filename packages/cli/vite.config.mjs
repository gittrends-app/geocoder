import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url))
    },
    tsconfigPaths: true
  }
});