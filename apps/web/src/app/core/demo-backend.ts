import {
  HttpBackend,
  HttpErrorResponse,
  HttpEvent,
  HttpHeaders,
  HttpRequest,
  HttpResponse,
} from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import { from, Observable } from 'rxjs';

interface DemoResponse {
  status: number;
  headers: Record<string, string>;
  json?: unknown;
  body?: Uint8Array | string;
}
interface DemoApi {
  handle(method: string, url: string, headers: Record<string, string>, body: unknown): Promise<DemoResponse>;
  reset(): Promise<void>;
  seededAt: number;
}

/** Estado del arranque de la demo (lo muestra la pantalla de carga). */
export const demoBoot = signal<{ ready: boolean; step: string; error: string }>({
  ready: false,
  step: 'Preparando la demo…',
  error: '',
});

let api: Promise<DemoApi> | null = null;

/** Carga (una sola vez) la API empaquetada para el navegador: demo/wms-demo-api.js. */
export function demoApi(): Promise<DemoApi> {
  if (!api) {
    const base = document.baseURI;
    const url = new URL('demo/wms-demo-api.js', base).href;
    api = (import(/* @vite-ignore */ url) as Promise<{ boot: (o: unknown) => Promise<DemoApi> }>)
      .then((m) =>
        m.boot({
          wasmUrl: new URL('demo/sql-wasm.wasm', base).href,
          routeUrl: new URL('demo/route-medellin.geojson', base).href,
          onStep: (step: string) => demoBoot.update((s) => ({ ...s, step })),
        }),
      )
      .then((a) => {
        demoBoot.set({ ready: true, step: '', error: '' });
        (window as any).wmsDemo = a; // utilidades de depuración (p. ej. wmsDemo.reset())
        return a;
      })
      .catch((e) => {
        demoBoot.set({ ready: false, step: '', error: String(e?.message ?? e) });
        api = null;
        throw e;
      });
  }
  return api;
}

/**
 * HttpBackend del demo de GitHub Pages: las peticiones /api/* no salen a la red, las atiende la API
 * que corre dentro del navegador. Lo demás (teselas del mapa, etc.) no pasa por HttpClient.
 */
@Injectable()
export class DemoHttpBackend implements HttpBackend {
  handle(req: HttpRequest<unknown>): Observable<HttpEvent<unknown>> {
    return from(this.run(req));
  }

  private async run(req: HttpRequest<unknown>): Promise<HttpEvent<unknown>> {
    const a = await demoApi();
    const headers: Record<string, string> = {};
    for (const k of req.headers.keys()) headers[k] = req.headers.get(k) ?? '';
    const path = new URL(req.urlWithParams, location.origin).pathname.replace(/^.*?(\/api\/)/, '/api/');
    const qs = req.urlWithParams.includes('?') ? req.urlWithParams.slice(req.urlWithParams.indexOf('?')) : '';
    const r = await a.handle(req.method, path + qs, headers, req.body ?? {});
    const resHeaders = new HttpHeaders(r.headers);
    let body: unknown = r.json ?? null;
    if (r.body !== undefined && r.json === undefined) {
      body =
        req.responseType === 'blob'
          ? new Blob([r.body as BlobPart], { type: r.headers['Content-Type'] ?? 'application/octet-stream' })
          : r.body;
    }
    if (r.status >= 400) {
      throw new HttpErrorResponse({ error: r.json ?? body, status: r.status, headers: resHeaders, url: req.url });
    }
    return new HttpResponse({ body, status: r.status, headers: resHeaders, url: req.url });
  }
}
