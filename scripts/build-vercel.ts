// Assembles a Vercel Build Output API v3 directory (`.vercel/output/`) by
// hand instead of relying on Vercel's zero-config Node.js builder for
// `api/index.ts`. That builder synthesizes its own tsconfig (no root
// tsconfig.json exists) with strict Node ESM resolution, which cannot see
// this repo's `@shared/*` path alias or extensionless relative imports —
// the same relaxed resolution `tsx`/Vite already give the rest of this
// project. Bundling with esbuild ourselves resolves both at build time, so
// the deployed function is plain, already-valid JavaScript with nothing
// left for Vercel to re-interpret.
import { build } from 'esbuild';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const outputDir = path.join(rootDir, '.vercel', 'output');
const functionDir = path.join(outputDir, 'functions', 'api', 'index.func');
const staticDir = path.join(outputDir, 'static');

async function main() {
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(functionDir, { recursive: true });

  // Bundle every dependency (not just first-party code) into one file, so
  // the deployed function is fully self-contained and needs no node_modules
  // alongside it at runtime.
  // CJS output, not ESM: esbuild's ESM bundle wraps every `require(...)` call
  // (including ones deep inside CJS deps like express's `debug`/`body-parser`)
  // in a shim that cannot handle dynamic requires of Node core modules
  // (`require('tty')` throws "Dynamic require ... is not supported" at
  // runtime). CJS output keeps those as real `require()` calls, which Node
  // resolves natively — confirmed by actually running the bundle locally,
  // not just checking that esbuild's own build step reported no errors.
  await build({
    entryPoints: [path.join(rootDir, 'api', 'index.ts')],
    outfile: path.join(functionDir, 'index.js'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    alias: { '@shared': path.join(rootDir, 'shared') },
    sourcemap: false,
    logLevel: 'info',
  });

  await writeFile(
    path.join(functionDir, 'package.json'),
    JSON.stringify({ type: 'commonjs' }, null, 2)
  );
  await writeFile(
    path.join(functionDir, '.vc-config.json'),
    JSON.stringify(
      {
        runtime: 'nodejs24.x',
        handler: 'index.js',
        launcherType: 'Nodejs',
        shouldAddHelpers: true,
      },
      null,
      2
    )
  );

  await mkdir(staticDir, { recursive: true });
  await cp(path.join(rootDir, 'dist', 'client'), staticDir, { recursive: true });

  await writeFile(
    path.join(outputDir, 'config.json'),
    JSON.stringify(
      {
        version: 3,
        routes: [
          { src: '/api/(.*)', dest: '/api' },
          { handle: 'filesystem' },
          { src: '/(.*)', dest: '/index.html' },
        ],
      },
      null,
      2
    )
  );

  console.log('Vercel Build Output written to .vercel/output');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
