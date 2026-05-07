import { defineConfig } from 'tsup';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8')) as { version: string };

export default defineConfig({
  entry: {
    cli: 'src/bin/crmd1.ts',
    mcp: 'src/bin/crmd1-mcp.ts',
  },
  format: ['esm'],
  target: 'node20',
  clean: true,
  minify: false,
  splitting: false,
  shims: true,
  sourcemap: true,
  banner: {
    js: '#!/usr/bin/env node',
  },
  // Inject package version at build time so the bundled CLI doesn't need
  // to resolve package.json at runtime (which fails in dist/).
  define: {
    __PKG_VERSION__: JSON.stringify(pkg.version),
  },
});
