/**
 * Sirve el build de GitHub Pages en local tal como lo hace Pages: http://localhost:4300/WMS/
 * (rutas desconocidas → 404.html, igual que GitHub). Uso: npm run build:pages && node scripts/serve-pages.mjs
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../apps/web/dist/web/browser');
const base = '/WMS/';
const port = Number(process.env.PORT ?? 4300);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.geojson': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

http
  .createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
    if (!url.startsWith(base)) {
      res.writeHead(302, { Location: base });
      return res.end();
    }
    let file = path.join(root, url.slice(base.length));
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    const found = fs.existsSync(file);
    if (!found) file = path.join(root, '404.html');
    res.writeHead(found ? 200 : 404, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  })
  .listen(port, () => console.log(`Demo de Pages en http://localhost:${port}${base}`));
