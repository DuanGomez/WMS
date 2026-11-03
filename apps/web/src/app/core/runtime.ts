import { HttpInterceptorFn } from '@angular/common/http';

/**
 * Configuración del sitio. Se lee AL ARRANCAR de `window.__WMS_CFG`, que escribe el build en index.html:
 *  - demo de GitHub Pages (scripts/build-pages.mjs): { demo: true }  → la API corre dentro del navegador (src/demo).
 *  - nube (scripts/build-cloud.mjs): { env: 'lab' | 'production', api: 'https://…' }.
 * Así la demo y la nube usan EXACTAMENTE el mismo build de Angular y los mismos ajustes de rendimiento
 * (scripts/pages/ajustes.mjs). En desarrollo (`ng serve`) no hay __WMS_CFG y valen los `define` de angular.json.
 */
declare const WMS_DEMO: boolean | undefined;
declare const WMS_ENV: string | undefined;
declare const WMS_API_URL: string | undefined;

interface SiteConfig {
  demo?: boolean;
  env?: string;
  api?: string;
}
const cfg: SiteConfig = (globalThis as { __WMS_CFG?: SiteConfig }).__WMS_CFG ?? {};

export const DEMO = cfg.demo ?? (typeof WMS_DEMO !== 'undefined' && !!WMS_DEMO);
export type AppEnv = 'local' | 'lab' | 'production' | 'demo';
const env = cfg.env ?? (typeof WMS_ENV !== 'undefined' ? WMS_ENV : 'local');
export const APP_ENV: AppEnv = DEMO ? 'demo' : ((['lab', 'production'] as const).find((e) => e === env) ?? 'local');
/** Dirección de la API cuando está en otro dominio (la nube: Render); vacía = mismo origen (/api). */
export const API_URL = (cfg.api ?? (typeof WMS_API_URL !== 'undefined' ? WMS_API_URL : '')).replace(/\/+$/, '');

/** URL completa de un recurso de la API ('/api/...'). */
export const apiUrl = (path: string) => (path.startsWith('/api') ? API_URL + path : path);

/** Antepone la dirección de la API (si está en otro dominio) a las peticiones /api/*. */
export const apiBaseInterceptor: HttpInterceptorFn = (req, next) =>
  API_URL && req.url.startsWith('/api') ? next(req.clone({ url: API_URL + req.url })) : next(req);
