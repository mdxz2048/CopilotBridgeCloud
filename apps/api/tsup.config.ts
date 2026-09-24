import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts', 'src/mock-main.ts', 'src/cli/create-admin.ts', 'src/cli/seed.ts', 'src/cli/setup-integration-test.ts', 'src/cli/expire-points.ts', 'src/cli/import-copilot-credential.ts', 'src/cli/activate-copilot.ts'],
  format: 'esm', target: 'node22', outDir: 'dist', splitting: false,
  noExternal: ['@bridge/db', '@bridge/contract'],
  external: ['pg'],
});
