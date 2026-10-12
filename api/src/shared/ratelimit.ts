import { ApiError } from './errors';

/** Rate limit básico en memoria (ventana fija) — usado en login y recuperación de contraseña. */
const buckets = new Map<string, { count: number; reset: number }>();

export function rateLimit(key: string, max: number, windowMs: number) {
  const t = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < t) {
    buckets.set(key, { count: 1, reset: t + windowMs });
    return;
  }
  b.count++;
  if (b.count > max) {
    const secs = Math.ceil((b.reset - t) / 1000);
    throw new ApiError(429, 'TOO_MANY_REQUESTS', `Demasiados intentos. Intenta de nuevo en ${secs} s.`);
  }
}

export function resetRateLimit(key: string) {
  buckets.delete(key);
}
