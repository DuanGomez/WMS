/**
 * Genera las capturas del README (docs/screenshots) con Playwright.
 * Requisitos: `npm run dev` corriendo y `npx playwright install chromium`.
 * Uso: npm run screenshots  [-- --only=mapa,inicio] [-- --dark | --light] [-- --mobile] [-- --all]
 * Solo guarda las capturas que muestra el README (--all genera todas las variantes).
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.WEB_URL ?? 'http://localhost:4200';
const OUT = path.resolve('docs/screenshots');
const args = process.argv.slice(2);
const only = args
  .find((a) => a.startsWith('--only='))
  ?.slice(7)
  .split(',');
const themes = args.includes('--dark') ? ['dark'] : args.includes('--light') ? ['light'] : ['light', 'dark'];
const mobile = args.includes('--mobile');
// Las variantes que el README no usa pesaban ~17 MB en el repositorio sin mostrarse en ninguna parte.
const all = args.includes('--all');
const readme = fs.readFileSync('README.md', 'utf8');
const ADMIN = 'admin@la72.co';
const DRIVER = 'conductor@la72.co';

const PAGES = [
  { name: 'login', path: '/login', auth: false },
  // El conductor comparte la ubicación de su celular (geolocalización simulada del navegador)
  { name: 'mi-turno', path: '/mi-turno', as: DRIVER, wait: 5000 },
  { name: 'inicio', path: '/inicio', wait: 2500 },
  { name: 'mapa', path: '/mapa', wait: 6000 },
  { name: 'vehiculos', path: '/vehiculos' },
  { name: 'conductores', path: '/conductores', wait: 2000 },
  { name: 'dispositivos', path: '/dispositivos' },
  { name: 'geocercas', path: '/geocercas', wait: 2000 },
  {
    name: 'geocercas-mapa',
    path: '/geocercas',
    wait: 4000,
    action: (page) => page.getByRole('button', { name: /Ver en el mapa/ }).first().click(),
  },
  { name: 'alertas', path: '/alertas' },
  { name: 'reportes', path: '/reportes' },
  { name: 'usuarios', path: '/usuarios' },
  { name: 'suscripcion', path: '/suscripcion' },
  { name: 'soporte', path: '/soporte' },
  { name: 'ajustes', path: '/ajustes', wait: 2500 },
];

const sessions = new Map();
async function login(email) {
  if (sessions.has(email)) return sessions.get(email);
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'Demo1234!' }),
  });
  if (!res.ok) throw new Error(`Login falló (${res.status}). ¿Está corriendo npm run dev?`);
  const s = await res.json();
  sessions.set(email, s);
  return s;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  for (const theme of themes) {
    const ctx = await browser.newContext({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
      deviceScaleFactor: mobile ? 3 : 1.5,
      isMobile: mobile,
      hasTouch: mobile,
      colorScheme: theme,
      locale: 'es-CO',
      timezoneId: 'America/Bogota',
      permissions: ['geolocation'],
      geolocation: { latitude: 6.2508, longitude: -75.5899, accuracy: 9 },
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error(`  ⚠️  [${theme}] error en la página:`, e.message));
    for (const p of PAGES) {
      if (only && !only.includes(p.name)) continue;
      const name = `${p.name}${mobile ? '-movil' : ''}${theme === 'dark' ? '-oscuro' : ''}.png`;
      if (!all && !readme.includes(`docs/screenshots/${name}`)) continue;
      const session = p.auth === false ? null : await login(p.as ?? ADMIN);
      await page.goto(`${BASE}/login`);
      await page.evaluate(
        ([s, t]) => {
          // El rediseño arranca en oscuro si no hay preferencia: se fija el tema de cada captura.
          localStorage.setItem('wms.theme', t);
          if (s)
            localStorage.setItem(
              'wms.session',
              JSON.stringify({ accessToken: s.accessToken, refreshToken: s.refreshToken, user: s.user }),
            );
          else localStorage.removeItem('wms.session');
        },
        [session, theme],
      );
      await page.goto(`${BASE}${p.path}`, { waitUntil: 'load' }).catch(() => {});
      await sleep(1200);
      if (p.action) await p.action(page).catch((e) => console.error(`  ⚠️  acción de ${p.name}:`, e.message));
      await sleep(p.wait ?? 1500);
      const file = path.join(OUT, name);
      await page.screenshot({ path: file });
      console.log(`📸 ${path.relative(process.cwd(), file)}`);
    }
    await ctx.close();
  }
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
