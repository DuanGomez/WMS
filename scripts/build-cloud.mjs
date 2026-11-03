/**
 * Build del frontend para la nube (Cloudflare Pages), un ambiente a la vez:
 *   WMS_ENV=lab        WMS_API_URL=https://wms-api-lab.onrender.com   node scripts/build-cloud.mjs
 *   WMS_ENV=production WMS_API_URL=https://wms-api-prod.onrender.com  node scripts/build-cloud.mjs
 * Deja el sitio en apps/web/dist/web/browser. Es el build normal de Angular (sin los ajustes de la demo de
 * GitHub Pages) con la dirección de la API y el ambiente fijados al compilar.
 * Cloudflare Pages sirve index.html para cualquier ruta que no exista (SPA) porque no hay 404.html.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'apps/web/dist/web/browser');
const env = process.env.WMS_ENV;
const api = (process.env.WMS_API_URL ?? '').trim().replace(/\/+$/, '');

if (!['lab', 'production'].includes(env)) throw new Error('WMS_ENV debe ser «lab» o «production».');
// WMS_ALLOW_HTTP=1 permite http://localhost:PUERTO para probar el build de la nube en el equipo.
const local = !!process.env.WMS_ALLOW_HTTP && /^http:\/\/localhost:\d+$/.test(api);
if (!/^https:\/\/[^/]+$/.test(api) && !local) throw new Error('WMS_API_URL debe ser la dirección https de la API, p. ej. https://wms-api-lab.onrender.com');

console.log(`▶ Angular · ambiente ${env} · API ${api}`);
const define = { WMS_DEMO: 'false', WMS_ENV: `'${env}'`, WMS_API_URL: `'${api}'` };
const args = Object.entries(define).map(([k, v]) => `--define ${k}=${JSON.stringify(v)}`).join(' ');
execSync(`npx ng build --configuration production ${args}`, { cwd: path.join(root, 'apps/web'), stdio: 'inherit' });

// Comprobación: el bundle debe llevar la dirección de la API (si --define no se aplicara, la app llamaría a /api).
const js = fs.readdirSync(out).filter((f) => f.endsWith('.js'));
if (!js.some((f) => fs.readFileSync(path.join(out, f), 'utf8').includes(api))) {
  throw new Error('El build no contiene WMS_API_URL: revisa la opción --define de Angular.');
}

// Cloudflare Pages: encabezados de seguridad y caché larga para los archivos con hash.
const origin = new URL(api).origin;
fs.writeFileSync(
  path.join(out, '_headers'),
  `/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: geolocation=(self), camera=(), microphone=(), payment=()
  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob: https://tile.openstreetmap.org; connect-src 'self' ${origin}; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
/*.js
  Cache-Control: public, max-age=31536000, immutable
/*.css
  Cache-Control: public, max-age=31536000, immutable
/media/*
  Cache-Control: public, max-age=31536000, immutable
`,
);
console.log(`✅ Sitio (${env}) listo en ${path.relative(root, out)}`);
