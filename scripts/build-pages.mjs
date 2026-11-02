/**
 * Build para GitHub Pages (demo sin servidor).
 *   1. Angular en modo demo (configuración «pages»: WMS_DEMO=true, base href /WMS/).
 *   2. La API empaquetada para el navegador con esbuild (api/src/demo/browser.ts): los módulos de Node
 *      (node:sqlite, fs, crypto, jsonwebtoken…) se reemplazan por los shims de api/src/demo/shims.
 *   3. Copia sql-wasm.wasm y la ruta fija de Medellín, y crea 404.html para el enrutamiento SPA.
 *   4. Ajustes de rendimiento sobre lo compilado y armado de index.html (scripts/pages/ajustar.mjs).
 * Uso: npm run build:pages  (opcional: BASE_HREF=/otro/)
 */
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ajustarCodigo, ajustarDemo, armarIndex } from './pages/ajustar.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'apps/web/dist/web/browser');
const demoDir = path.join(out, 'demo');
const shims = path.join(root, 'api/src/demo/shims');
const base = process.env.BASE_HREF ?? '/WMS/';

if (!process.env.SKIP_NG) {
  console.log('▶ Angular (configuración pages)…');
  execSync(`npx ng build --configuration pages --base-href ${base}`, { cwd: path.join(root, 'apps/web'), stdio: 'inherit' });
}
const indexHtml = path.join(out, 'index.html');
if (fs.readFileSync(indexHtml, 'utf8').includes('__wmsDemoWorker'))
  throw new Error('Este build de Angular ya pasó por build-pages.mjs: vuelve a compilarlo (sin SKIP_NG).');
console.log('▶ Ajustes de rendimiento sobre el build…');
const ajustado = ajustarCodigo(out);

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
    // ExcelJS y PDFKit (lo más pesado de la API) quedan en archivos aparte que el builder de reportes carga
    // con import() solo al generar uno: la primera visita no los descarga.
    b.onResolve({ filter: /^(exceljs|pdfkit)$/ }, (args) =>
      /reports[\\/]builder\.ts$/.test(args.importer)
        ? { path: args.path === 'exceljs' ? './wms-demo-xlsx.js' : './wms-demo-pdf.js', external: true }
        : undefined,
    );
    b.onResolve({ filter: /.*/ }, (args) => (alias[args.path] ? { path: alias[args.path] } : undefined));
    // El runtime de Azure Functions solo se carga dentro del host de Azure: en el navegador no existe.
    b.onResolve({ filter: /^@azure\/functions$/ }, () => ({ path: 'azure-functions', namespace: 'empty' }));
    b.onLoad({ filter: /.*/, namespace: 'empty' }, () => ({ contents: 'export default {};', loader: 'js' }));
  },
};
fs.mkdirSync(demoDir, { recursive: true });
const result = await build({
  entryPoints: {
    'wms-demo-api': path.join(root, 'api/src/demo/browser.ts'),
    'wms-demo-xlsx': path.join(root, 'api/src/demo/reports-xlsx.ts'),
    'wms-demo-pdf': path.join(root, 'api/src/demo/reports-pdf.ts'),
  },
  outdir: demoDir,
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
for (const [file, o] of Object.entries(result.metafile.outputs)) console.log(`  ${path.basename(file)} · ${(o.bytes / 1024).toFixed(0)} KB`);
ajustarDemo(path.join(demoDir, 'wms-demo-api.js'));

fs.copyFileSync(path.join(root, 'node_modules/sql.js/dist/sql-wasm.wasm'), path.join(demoDir, 'sql-wasm.wasm'));
fs.copyFileSync(
  path.join(root, 'api/src/functions/gps-simulator/route-medellin.geojson'),
  path.join(demoDir, 'route-medellin.geojson'),
);
// Arranque de la API de la demo en un Web Worker desde el propio index.html: el Worker se descarga en paralelo
// con la app (sin esperar a main.js) y la API nunca ocupa el hilo de la interfaz.
// El wasm y la ruta los descarga la página y se los pasa al Worker sin copiarlos, pero justo después del primer
// pintado: antes se precargaban desde el inicio y, en una red lenta, el wasm (329 KB) competía con la app y la
// fuente; PageSpeed lo contaba dentro del LCP (3,7 s → 2,3 s en Lighthouse móvil al moverlo). Si el navegador no
// avisa del primer pintado, se descargan de inmediato; y nunca después de 3 s (p. ej. pestaña abierta de fondo).
// core/demo-backend.ts toma window.__wmsDemoWorker; si no existe o falla, carga la API en la página.
// Cuando la API avisa que está lista, se quita la pantalla de carga fija del HTML (scripts/pages/pantalla-carga.html).
const workerBoot = `(function () {
  try {
    var u = function (p) { return new URL(p, document.baseURI).href; };
    var w = new Worker(u('demo/wms-demo-api.js'), { type: 'module' });
    var base = { type: 'assets', wasmUrl: u('demo/sql-wasm.wasm'), routeUrl: u('demo/route-medellin.geojson') };
    window.__wmsDemoWorker = w;
    w.addEventListener('message', function (e) {
      if (e.data && e.data.type === 'status' && e.data.ready) {
        var s = document.querySelector('.wms-shell');
        if (s) s.remove();
      }
    });
    var assets = function () {
      if (assets.done) return;
      assets.done = true;
      Promise.all([
        fetch(base.wasmUrl).then(function (r) { if (!r.ok) throw r; return r.arrayBuffer(); }),
        fetch(base.routeUrl).then(function (r) { if (!r.ok) throw r; return r.text(); })
      ]).then(function (a) {
        w.postMessage(Object.assign({ wasm: a[0], route: a[1] }, base), [a[0]]);
      }, function () {
        w.postMessage(base);
      });
    };
    try {
      new PerformanceObserver(function (l) {
        if (l.getEntriesByName('first-contentful-paint').length) setTimeout(assets);
      }).observe({ type: 'paint', buffered: true });
    } catch (e) {
      assets();
    }
    setTimeout(assets, 3000);
  } catch (e) {}
})();`;
fs.writeFileSync(
  indexHtml,
  armarIndex(out, fs.readFileSync(indexHtml, 'utf8'), { worker: workerBoot, leaflet: ajustado.leaflet }),
);
// GitHub Pages: /WMS/mapa se sirve desde mapa.html si existe (código 200). Se crea una copia de index.html por
// cada ruta de la app (leídas de app.routes.ts, así la lista no se desactualiza); el resto pasa por 404.html.
const routesTs = fs.readFileSync(path.join(root, 'apps/web/src/app/app.routes.ts'), 'utf8');
const pages = [...new Set([...routesTs.matchAll(/path: '([a-z-]+)'/g)].map((m) => m[1]))];
for (const p of pages) fs.copyFileSync(indexHtml, path.join(out, `${p}.html`));
console.log(`  ${pages.length} páginas por ruta (${pages.join(', ')})`);
// GitHub Pages: rutas profundas (/WMS/mapa) se sirven con 404.html → la SPA las resuelve.
fs.copyFileSync(indexHtml, path.join(out, '404.html'));
fs.writeFileSync(path.join(out, '.nojekyll'), '');
console.log(`✅ Sitio listo en ${path.relative(root, out)} (base ${base})`);
