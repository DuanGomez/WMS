import { HttpInterceptorFn } from '@angular/common/http';

/**
 * Indicadores de compilación (angular.json › define, o `ng build --define` en scripts/build-cloud.mjs):
 *  - WMS_DEMO: build de GitHub Pages; la API corre dentro del navegador (ver src/demo) porque Pages solo sirve
 *    archivos estáticos.
 *  - WMS_ENV: ambiente del build: local | lab | production | demo.
 *  - WMS_API_URL: dirección de la API cuando está en otro dominio (la nube: Render); vacía = mismo origen (/api,
 *    con el proxy de `ng serve` en local).
 */
declare const WMS_DEMO: boolean | undefined;
declare const WMS_ENV: string | undefined;
declare const WMS_API_URL: string | undefined;

export const DEMO = typeof WMS_DEMO !== 'undefined' && !!WMS_DEMO;
export type AppEnv = 'local' | 'lab' | 'production' | 'demo';
export const APP_ENV: AppEnv = DEMO
  ? 'demo'
  : ((['lab', 'production'] as const).find((e) => typeof WMS_ENV !== 'undefined' && e === WMS_ENV) ?? 'local');
export const API_URL = (typeof WMS_API_URL !== 'undefined' ? WMS_API_URL : '').replace(/\/+$/, '');

/** URL completa de un recurso de la API ('/api/...'). */
export const apiUrl = (path: string) => (path.startsWith('/api') ? API_URL + path : path);

/** Antepone la dirección de la API (si está en otro dominio) a las peticiones /api/*. */
export const apiBaseInterceptor: HttpInterceptorFn = (req, next) =>
  API_URL && req.url.startsWith('/api') ? next(req.clone({ url: API_URL + req.url })) : next(req);
