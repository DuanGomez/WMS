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

/** true si la API corre en la página (sin Worker): entonces hay que ceder el hilo antes de cada petición. */
let inPage = false;

/**
 * API de la demo dentro del Web Worker que creó index.html (build-pages.mjs): las peticiones viajan por
 * mensajes y SQLite, el simulador y el guardado trabajan en otro hilo, sin congelar la interfaz.
 */
function workerApi(w: Worker): Promise<DemoApi> {
  return new Promise((resolve, reject) => {
    let seq = 0;
    const pending = new Map<number, (r: DemoResponse) => void>();
    const call = (msg: Record<string, unknown>) =>
      new Promise<DemoResponse>((res) => {
        const id = ++seq;
        pending.set(id, res);
        try {
          w.postMessage({ ...msg, id });
        } catch {
          // Cuerpo con algo no clonable: se envía como JSON plano.
          w.postMessage({ ...msg, id, body: JSON.parse(JSON.stringify(msg['body'] ?? null)) });
        }
      });
    const a: DemoApi = {
      seededAt: 0,
      handle: (method, url, headers, body) => call({ type: 'req', method, url, headers, body }),
      async reset() {
        await call({ type: 'reset' });
        location.reload();
      },
    };
    w.addEventListener('message', (e: MessageEvent) => {
      const m = e.data;
      if (m?.type === 'res') {
        pending.get(m.id)?.(m.res);
        pending.delete(m.id);
      } else if (m?.type === 'status') {
        if (m.error) reject(new Error(m.error));
        else if (m.ready) {
          a.seededAt = m.seededAt;
          resolve(a);
        } else if (m.step) demoBoot.update((s) => ({ ...s, step: m.step }));
      }
    });
    w.addEventListener('error', (e) => {
      e.preventDefault();
      reject(new Error(e.message || 'No se pudo iniciar la demo en segundo plano.'));
    });
    w.postMessage({ type: 'status' }); // por si ya avanzó antes de que la app escuchara
    // Guarda la base al cerrar u ocultar la pestaña (el Worker no ve esos eventos).
    const save = () => w.postMessage({ type: 'persist' });
    addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && save());
  });
}

/** Respaldo para navegadores sin Workers de módulo: la API se importa y corre en la página. */
function pageApi(): Promise<DemoApi> {
  inPage = true;
  const base = document.baseURI;
  const url = new URL('demo/wms-demo-api.js', base).href;
  return (import(/* @vite-ignore */ url) as Promise<{ boot: (o: unknown) => Promise<DemoApi> }>).then((m) =>
    m.boot({
      wasmUrl: new URL('demo/sql-wasm.wasm', base).href,
      routeUrl: new URL('demo/route-medellin.geojson', base).href,
      onStep: (step: string) => demoBoot.update((s) => ({ ...s, step })),
    }),
  );
}

/** Arranca (una sola vez) la API de la demo: en el Worker de index.html o, si no está o falla, en la página. */
export function demoApi(): Promise<DemoApi> {
  if (!api) {
    const g = window as unknown as { __wmsDemoWorker?: Worker };
    const w = g.__wmsDemoWorker;
    api = (
      w
        ? workerApi(w).catch((e) => {
            console.warn('[demo] el Worker falló, la API corre en la página:', e);
            w.terminate();
            g.__wmsDemoWorker = undefined;
            return pageApi();
          })
        : pageApi()
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
    // Si la API corre en la página (sin Worker), se atiende en una tarea aparte para que el navegador pinte antes
    // el cambio de sección (sin esto, crear la página, las consultas SQL y pintar los datos iban en un solo frame).
    if (inPage) await new Promise((r) => setTimeout(r));
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
