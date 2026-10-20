/* global document, window, innerWidth, innerHeight, getComputedStyle -- código que corre dentro del navegador (page.evaluate) */
/**
 * Auditoría automática de la interfaz (accesibilidad y diseño responsive) con Playwright + axe-core.
 * Recorre cada página en varios tamaños de pantalla y revisa:
 *   - desborde horizontal (scroll lateral no deseado) y elementos que se salen de la pantalla;
 *   - controles tapados por la barra de navegación u otros elementos;
 *   - formularios: el botón de guardar debe verse y poder pulsarse;
 *   - reglas WCAG 2.1 A/AA de axe-core (contraste, nombres accesibles, etiquetas…).
 * Requisitos: `npm run dev` corriendo. Uso: node scripts/ui-audit.mjs [--out=carpeta] [--only=usuarios,mapa] [--vp=mob]
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const BASE = process.env.WEB_URL ?? 'http://localhost:4200';
const args = process.argv.slice(2);
const arg = (k) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
const OUT = path.resolve(arg('out') ?? 'ui-audit');
const only = arg('only')?.split(',');
const onlyVp = arg('vp')?.split(',');
const theme = arg('theme') ?? 'light';
fs.mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { id: 'desk', width: 1440, height: 900 },
  { id: 'laptop', width: 1280, height: 720 },
  { id: 'tab', width: 820, height: 1180 },
  { id: 'mob', width: 390, height: 844, mobile: true },
  { id: 'mob-s', width: 360, height: 640, mobile: true },
];

const SAVE = /^(Guardar|Crear|Generar|Regenerar|Enviar|Registrar|Asignar|Compartir|Continuar|Crear cuenta)$/i;
const PAGES = [
  { id: 'inicio', path: '/inicio' },
  { id: 'mapa', path: '/mapa', wait: 3500 },
  { id: 'vehiculos', path: '/vehiculos', sheet: /Nuevo vehículo/, row: true },
  { id: 'conductores', path: '/conductores', sheet: /Nuevo conductor/, row: true },
  { id: 'dispositivos', path: '/dispositivos', sheet: /Registrar dispositivo/ },
  { id: 'geocercas', path: '/geocercas' },
  { id: 'geocercas-nueva', path: '/geocercas', click: /Nueva geocerca/, wait: 1500, saveInPanel: true },
  { id: 'alertas', path: '/alertas' },
  { id: 'alertas-reglas', path: '/alertas', tab: /^Reglas$/, sheet: /Nueva regla/ },
  { id: 'reportes', path: '/reportes', sheet: /Generar reporte/ },
  { id: 'usuarios', path: '/usuarios', sheet: /Nuevo usuario/, row: true },
  { id: 'suscripcion', path: '/suscripcion', inline: '.cform', as: 'gerencia@la72.co' },
  { id: 'soporte', path: '/soporte', sheet: /Nuevo ticket/ },
  { id: 'ajustes', path: '/ajustes' },
  { id: 'mi-turno', path: '/mi-turno', as: 'conductor@la72.co' },
  { id: 'login', path: '/login', auth: false },
  { id: 'registro', path: '/registro', auth: false },
];

const sessions = new Map();
async function login(email) {
  if (!sessions.has(email)) {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'Demo1234!' }),
    });
    if (!r.ok) throw new Error(`login ${email}: ${r.status}`);
    sessions.set(email, await r.json());
  }
  return sessions.get(email);
}

/** Problemas de maquetación medidos en el navegador. */
function layoutProbe(scope) {
  const vw = innerWidth;
  const vh = innerHeight;
  const issues = [];
  const doc = document.documentElement;
  if (doc.scrollWidth > vw + 1) {
    const culprits = [...document.querySelectorAll('body *')]
      .filter((e) => {
        const r = e.getBoundingClientRect();
        if (!r.width || r.right <= vw + 1) return false;
        // ignora lo que está dentro de un contenedor con scroll propio
        for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) {
          const o = getComputedStyle(p).overflowX;
          if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') return false;
        }
        return true;
      })
      .slice(0, 4)
      .map((e) => `${e.tagName.toLowerCase()}.${[...e.classList].slice(0, 2).join('.')} (${Math.round(e.getBoundingClientRect().right)}px)`);
    issues.push({ kind: 'desborde-horizontal', detail: `scrollWidth ${doc.scrollWidth} > ${vw}: ${culprits.join(', ')}` });
  }
  // Secciones de la navbar que no caben (quedarían inaccesibles sin desplazamiento)
  const nav = document.querySelector('.nav');
  if (!scope && nav && getComputedStyle(nav).display !== 'none') {
    const nr = nav.getBoundingClientRect();
    const cut = [...nav.querySelectorAll('.nav-item')].filter((a) => { const r = a.getBoundingClientRect(); return r.right > nr.right + 1 || r.left < nr.left - 1; });
    if (cut.length) issues.push({ kind: 'navbar-cortada', detail: cut.map((a) => a.getAttribute('title')).join(', ') });
  }
  const root = scope ? document.querySelector(scope) : document;
  if (!root) return issues;
  const bar = document.querySelector('header.bar, .bar');
  const barBottom = bar ? bar.getBoundingClientRect().bottom : 0;
  const ctrls = [...root.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=switch]')].filter((e) => {
    if (bar && bar.contains(e)) return false;
    if (e.closest('.drawer, .leaflet-control-container, [aria-hidden=true], [inert], .skip')) return false;
    // Fuera del área visible de su contenedor con scroll: se ve al desplazarse, no es un fallo.
    for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (/(auto|scroll|hidden|clip)/.test(cs.overflowX + cs.overflowY)) {
        const pr = p.getBoundingClientRect();
        const er = e.getBoundingClientRect();
        if (er.left < pr.left - 1 || er.right > pr.right + 1 || er.top < pr.top - 1 || er.bottom > pr.bottom + 1) return false;
      }
    }
    const cs = getComputedStyle(e);
    const r = e.getBoundingClientRect();
    return cs.visibility !== 'hidden' && cs.display !== 'none' && r.width > 2 && r.height > 2 && r.bottom > 0 && r.top < vh;
  });
  for (const e of ctrls) {
    const r = e.getBoundingClientRect();
    const label = (e.getAttribute('aria-label') || e.textContent || e.getAttribute('placeholder') || e.tagName).trim().replace(/\s+/g, ' ').slice(0, 40);
    if (r.right > vw + 1 || r.left < -1) {
      issues.push({ kind: 'fuera-de-pantalla', detail: `«${label}» x=${Math.round(r.left)}..${Math.round(r.right)}` });
      continue;
    }
    const cx = Math.min(vw - 1, Math.max(0, r.left + r.width / 2));
    const cy = Math.min(vh - 1, Math.max(0, r.top + Math.min(r.height / 2, 12)));
    const top = document.elementFromPoint(cx, cy);
    if (top && top !== e && !e.contains(top) && !top.contains(e) && !(e.tagName === 'INPUT' && top.tagName === 'LABEL')) {
      const under = bar && bar.contains(top) ? 'la barra de navegación' : `${top.tagName.toLowerCase()}.${[...top.classList].slice(0, 2).join('.')}`;
      if (r.top < barBottom || !top.closest('.backdrop, .toasts, .toast')) issues.push({ kind: 'tapado', detail: `«${label}» queda debajo de ${under}` });
    }
    if (r.width < 24 || r.height < 24) {
      if (!['INPUT'].includes(e.tagName)) issues.push({ kind: 'objetivo-pequeño', detail: `«${label}» ${Math.round(r.width)}×${Math.round(r.height)} px` });
    }
  }
  return issues;
}

async function runAxe(page, scope) {
  await page.addScriptTag({ content: AXE });
  return page.evaluate(async (scope) => {
    const r = await window.axe.run(scope ? document.querySelector(scope) : document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
      resultTypes: ['violations'],
    });
    return r.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => ({ id: v.id, impact: v.impact, help: v.help, n: v.nodes.length, sample: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) }));
  }, scope);
}

async function checkSave(page, scope, inPage = false) {
  // Busca el botón de acción del formulario abierto, lo lleva a la vista si hace falta y verifica que se pueda pulsar.
  return page.evaluate(
    ([scope, re, inPage]) => {
      const root = document.querySelector(scope);
      if (!root) return { ok: false, detail: 'no se abrió el formulario' };
      const r0 = root.getBoundingClientRect();
      const inside = inPage || r0.top >= -1 && r0.left >= -1 && r0.right <= innerWidth + 1 && r0.bottom <= innerHeight + 1;
      const rx = new RegExp(re, 'i');
      const btn = [...root.querySelectorAll('button')].find((b) => rx.test(b.textContent.trim()) && getComputedStyle(b).display !== 'none' && !b.hidden);
      if (!btn) return { ok: false, detail: 'sin botón de guardar visible', panel: inside };
      btn.scrollIntoView({ block: 'nearest' });
      const r = btn.getBoundingClientRect();
      const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const clickable = !!t && (t === btn || btn.contains(t));
      return {
        ok: clickable && inside,
        detail: `«${btn.textContent.trim()}» en (${Math.round(r.left)},${Math.round(r.top)})${clickable ? '' : ` tapado por ${t?.tagName.toLowerCase()}.${t ? [...t.classList].slice(0, 2).join('.') : ''}`}${inside ? '' : ' · el panel se sale de la pantalla'}`,
      };
    },
    [scope, SAVE.source, inPage],
  );
}

const report = [];
const browser = await chromium.launch();
for (const vp of VIEWPORTS) {
  if (onlyVp && !onlyVp.includes(vp.id)) continue;
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    isMobile: !!vp.mobile,
    hasTouch: !!vp.mobile,
    deviceScaleFactor: 1,
    locale: 'es-CO',
    timezoneId: 'America/Bogota',
    permissions: ['geolocation'],
    geolocation: { latitude: 6.2508, longitude: -75.5899, accuracy: 9 },
  });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  for (const p of PAGES) {
    if (only && !only.includes(p.id)) continue;
    const entry = { vp: vp.id, page: p.id, issues: [], axe: [], forms: [] };
    const s = p.auth === false ? null : await login(p.as ?? 'admin@la72.co');
    await page.goto(`${BASE}/login`);
    await page.evaluate(
      ([s, t]) => {
        localStorage.setItem('wms.theme', t);
        if (s) localStorage.setItem('wms.session', JSON.stringify({ accessToken: s.accessToken, refreshToken: s.refreshToken, user: s.user }));
        else localStorage.removeItem('wms.session');
      },
      [s, theme],
    );
    await page.goto(`${BASE}${p.path}`, { waitUntil: 'load' });
    await page.waitForTimeout(p.wait ?? 1800);
    if (p.tab) await page.getByRole('tab', { name: p.tab }).or(page.getByRole('button', { name: p.tab })).first().click().catch(() => {});
    if (p.click) {
      await page.getByRole('button', { name: p.click }).first().click().catch((e) => entry.issues.push({ kind: 'acción', detail: `no se pudo pulsar ${p.click}: ${e.message.split('\n')[0]}` }));
      await page.waitForTimeout(p.wait ?? 800);
    }
    entry.issues.push(...(await page.evaluate(layoutProbe, null)));
    entry.axe = await runAxe(page, null);
    await page.screenshot({ path: path.join(OUT, `${vp.id}-${p.id}.png`) });
    if (p.saveInPanel) entry.forms.push({ form: 'panel', ...(await checkSave(page, '.panel')) });
    if (p.inline) entry.forms.push({ form: p.inline, ...(await checkSave(page, p.inline, true)) });

    if (p.sheet) {
      const opener = page.getByRole('button', { name: p.sheet }).first();
      if (await opener.isVisible().catch(() => false)) {
        await opener.click();
        await page.waitForTimeout(700);
        const res = await checkSave(page, '.sheet, [role=dialog]');
        entry.forms.push({ form: String(p.sheet), ...res });
        entry.issues.push(...(await page.evaluate(layoutProbe, '.sheet, [role=dialog]')).map((i) => ({ ...i, kind: `form:${i.kind}` })));
        entry.axe.push(...(await runAxe(page, '.sheet, [role=dialog]')).map((v) => ({ ...v, id: `form:${v.id}` })));
        await page.screenshot({ path: path.join(OUT, `${vp.id}-${p.id}-form.png`) });
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
      } else entry.forms.push({ form: String(p.sheet), ok: false, detail: 'el botón para abrir el formulario no es visible' });
    }
    if (p.row) {
      const row = page.locator('tbody tr.clickable').first();
      if (await row.isVisible().catch(() => false)) {
        await row.click();
        await page.waitForTimeout(700);
        entry.issues.push(...(await page.evaluate(layoutProbe, 'aside, [role=dialog]')).map((i) => ({ ...i, kind: `detalle:${i.kind}` })));
        await page.screenshot({ path: path.join(OUT, `${vp.id}-${p.id}-detalle.png`) });
        await page.keyboard.press('Escape');
        await page.waitForTimeout(400);
      }
    }
    report.push(entry);
    const bad = entry.issues.length + entry.axe.length + entry.forms.filter((f) => !f.ok).length;
    console.log(`${bad ? '✗' : '✓'} ${vp.id.padEnd(6)} ${p.id.padEnd(16)} ${entry.issues.length} maquetación · ${entry.axe.length} a11y · forms ${entry.forms.map((f) => (f.ok ? 'ok' : 'FALLA')).join(',') || '-'}`);
  }
  if (pageErrors.length) report.push({ vp: vp.id, page: '*', pageErrors: [...new Set(pageErrors)] });
  await ctx.close();
}
await browser.close();
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(`\nInforme: ${path.join(OUT, 'report.json')}`);
