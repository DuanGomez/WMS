/**
 * Reemplazos mínimos de módulos de Node para ejecutar la API en el navegador (demo de GitHub Pages).
 * Se conectan con alias en scripts/build-pages.mjs; el código de la API no cambia.
 */
const g = globalThis as any;

/* ---------- fs ---------- */
export function existsSync(p: string) {
  return String(p).endsWith('.geojson') && !!g.__WMS_ROUTE;
}
export function readFileSync(p: string) {
  if (String(p).endsWith('.geojson') && g.__WMS_ROUTE) return g.__WMS_ROUTE as string;
  throw new Error(`Archivo no disponible en el navegador: ${p}`);
}
export function mkdirSync() {}
export function rmSync() {}
export function writeFileSync() {}

/* ---------- path ---------- */
const norm = (s: string) => s.replace(/\\/g, '/');
export function join(...parts: string[]) {
  return norm(parts.filter(Boolean).join('/')).replace(/\/+/g, '/');
}
export const resolve = join;
export function dirname(p: string) {
  const s = norm(p);
  const i = s.lastIndexOf('/');
  return i <= 0 ? '/' : s.slice(0, i);
}
export function basename(p: string) {
  return norm(p).split('/').pop() ?? '';
}
export function isAbsolute(p: string) {
  return norm(p).startsWith('/');
}
export function relative(_from: string, to: string) {
  return to;
}
export const sep = '/';

/* ---------- events ---------- */
export class EventEmitter {
  private l = new Map<string, Set<(...a: any[]) => void>>();
  setMaxListeners() {
    return this;
  }
  on(e: string, fn: (...a: any[]) => void) {
    if (!this.l.has(e)) this.l.set(e, new Set());
    this.l.get(e)!.add(fn);
    return this;
  }
  off(e: string, fn: (...a: any[]) => void) {
    this.l.get(e)?.delete(fn);
    return this;
  }
  emit(e: string, ...a: any[]) {
    const set = this.l.get(e);
    if (!set?.size) return false;
    for (const fn of [...set]) fn(...a);
    return true;
  }
}

const api = {
  existsSync,
  readFileSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  join,
  resolve,
  dirname,
  basename,
  isAbsolute,
  relative,
  sep,
  EventEmitter,
};
export default api;
