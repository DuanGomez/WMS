/**
 * Globales de Node que espera la API (inyectados por esbuild en el bundle del navegador).
 */
import { Buffer as BufferPolyfill } from 'buffer';

const g = globalThis as any;
g.Buffer ??= BufferPolyfill;
g.process ??= { env: {}, cwd: () => '/', pid: 1, on() {}, exit() {} };

export const process = g.process;
export const Buffer = g.Buffer;
