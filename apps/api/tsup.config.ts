import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts', 'src/mock-main.ts', 'src/cli/create-admin.ts', 'src/cli/seed.ts'],
  format: 'esm', target: 'node22', outDir: 'dist', splitting: false,
  noExternal: ['@bridge/db', '@bridge/contract'],
  external: ['pg'],
});
