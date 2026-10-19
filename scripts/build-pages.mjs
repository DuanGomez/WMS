/**
 * Build para GitHub Pages (demo sin servidor).
 *   1. Angular en modo demo (configuración «pages»: WMS_DEMO=true, base href /WMS/).
 *   2. La API empaquetada para el navegador con esbuild (api/src/demo/browser.ts): los módulos de Node
 *      (node:sqlite, fs, crypto, jsonwebtoken…) se reemplazan por los shims de api/src/demo/shims.
 *   3. Copia sql-wasm.wasm y la ruta fija de Medellín, y crea 404.html para el enrutamiento SPA.
 * Uso: npm run build:pages  (opcional: BASE_HREF=/otro/)
 */
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'apps/web/dist/web/browser');
const demoDir = path.join(out, 'demo');
const shims = path.join(root, 'api/src/demo/shims');
const base = process.env.BASE_HREF ?? '/WMS/';

if (!process.env.SKIP_NG) {
  console.log('▶ Angular (configuración pages)…');
  execSync(`npx ng build --configuration pages --base-href ${base}`, { cwd: path.join(root, 'apps/web'), stdio: 'inherit' });
}

console.log('▶ API para el navegador (esbuild)…');
const alias = {
  'node:sqlite': path.join(shims, 'sqlite.ts'),
  'node:fs': path.join(shims, 'node.ts'),
  fs: path.join(shims, 'node.ts'),
  'node:path': path.join(shims, 'node.ts'),
  path: path.join(shims, 'node.ts'),
  'node:events': path.join(shims, 'node.ts'),
  events: path.join(shims, 'node.ts'),
  'node:crypto': path.join(shims, 'crypto.ts'),
  crypto: path.join(shims, 'crypto.ts'),
  jsonwebtoken: path.join(shims, 'jsonwebtoken.ts'),
  'node:child_process': path.join(shims, 'node.ts'),
};
const shimPlugin = {
  name: 'wms-shims',
  setup(b) {
    b.onResolve({ filter: /.*/ }, (args) => (alias[args.path] ? { path: alias[args.path] } : undefined));
    // El runtime de Azure Functions solo se carga dentro del host de Azure: en el navegador no existe.
    b.onResolve({ filter: /^@azure\/functions$/ }, () => ({ path: 'azure-functions', namespace: 'empty' }));
    b.onLoad({ filter: /.*/, namespace: 'empty' }, () => ({ contents: 'export default {};', loader: 'js' }));
  },
};
fs.mkdirSync(demoDir, { recursive: true });
const result = await build({
  entryPoints: [path.join(root, 'api/src/demo/browser.ts')],
  outfile: path.join(demoDir, 'wms-demo-api.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  plugins: [shimPlugin],
  define: { __dirname: '"/"', 'process.env.NODE_ENV': '"production"' },
  inject: [path.join(shims, 'globals.ts')],
  logLevel: 'warning',
  metafile: true,
});
const size = Object.values(result.metafile.outputs).reduce((s, o) => s + o.bytes, 0);
console.log(`  wms-demo-api.js · ${(size / 1024).toFixed(0)} KB`);

fs.copyFileSync(path.join(root, 'node_modules/sql.js/dist/sql-wasm.wasm'), path.join(demoDir, 'sql-wasm.wasm'));
fs.copyFileSync(
  path.join(root, 'api/src/functions/gps-simulator/route-medellin.geojson'),
  path.join(demoDir, 'route-medellin.geojson'),
);
// GitHub Pages: rutas profundas (/WMS/mapa) se sirven con 404.html → la SPA las resuelve.
fs.copyFileSync(path.join(out, 'index.html'), path.join(out, '404.html'));
fs.writeFileSync(path.join(out, '.nojekyll'), '');
console.log(`✅ Sitio listo en ${path.relative(root, out)} (base ${base})`);
