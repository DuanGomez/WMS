/* =====================================================================
   Utilidades de movimiento y de UI (solo DOM y estilos, sin datos ni servicios).
   Las animaciones por JS (Web Animations) usan los mismos tokens CSS que el resto
   de la app (--dur-*, --ease*), leídos en tiempo de ejecución.
   ===================================================================== */

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Valor de un token CSS de :root (p. ej. --ease) o el respaldo si no existe. */
export function cssVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/** Duración de un token CSS en milisegundos (acepta "0.45s" o "450ms"). */
export function cssMs(name: string, fallback: number): number {
  const v = cssVar(name, '');
  const n = parseFloat(v);
  if (!isFinite(n)) return fallback;
  return v.endsWith('ms') ? n : n * 1000;
}
