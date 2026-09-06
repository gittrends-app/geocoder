import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'tsup';

const cliDirectory = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  esbuildOptions(options) {
    options.alias = {
      ...options.alias,
      '@/core': resolve(cliDirectory, '../core/src/index.ts')
    };
  }
});