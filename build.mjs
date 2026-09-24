import { build } from 'esbuild';
import { readFile, mkdir, rm } from 'node:fs/promises';

// Bundle the Worker into a single self-contained ESM module for Cloudflare Workers.
// Static assets (HTML/CSS/JS) are inlined into the bundle via an ASSETS banner so the
// Worker serves them without any external file system, KV, or asset upload step.
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });

const assets = {};
for (const [file, type] of [
  ['login.html', 'text/html; charset=utf-8'],
  ['auth-ui.js', 'text/javascript; charset=utf-8'],
  ['index.html', 'text/html; charset=utf-8'],
  ['app.js', 'text/javascript; charset=utf-8'],
  ['merge.js', 'text/javascript; charset=utf-8'],
  ['sortable.min.js', 'text/javascript; charset=utf-8'],
  ['styles.css', 'text/css; charset=utf-8'],
  ['manifest.webmanifest', 'application/manifest+json; charset=utf-8'],
]) assets['/' + file] = { body: await readFile('src/' + file, 'utf8'), type };

// Binary assets (PWA icons) are inlined as base64 and decoded by the Worker.
for (const [file, type] of [
  ['icon-192.png', 'image/png'],
  ['icon-512.png', 'image/png'],
  ['apple-touch-icon.png', 'image/png'],
]) assets['/' + file] = { body: (await readFile('src/' + file)).toString('base64'), type, bin: true };

await build({
  entryPoints: ['src/worker.js'],
  outfile: 'dist/worker.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  banner: { js: 'const ASSETS=' + JSON.stringify(assets) + ';' },
});

console.log('Built dist/worker.js');
