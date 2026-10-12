import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, StatementSync } from 'node:sqlite';
import { config } from './config';
import { MIGRATIONS } from './migrations';

/**
 * Capa de acceso a datos sobre SQLite embebido (node:sqlite, sin servidores ni compilación nativa).
 * Los repositorios sólo usan estas funciones (all/get/run/tx), de modo que migrar a Azure SQL o
 * Cosmos DB implica reemplazar este módulo y los repositorios, no las funciones.
 */
type Param = string | number | bigint | null | Uint8Array | boolean | undefined;
export type Params = Record<string, Param> | Param[];

let db: DatabaseSync | null = null;
const cache = new Map<string, StatementSync>();
const paramNames = new Map<string, string[]>();

/** Nombres de parámetros (@x) usados por la sentencia: permite pasar objetos con campos extra. */
function namesOf(sql: string): string[] {
  let n = paramNames.get(sql);
  if (!n) {
    const code = sql.replace(/'(?:[^']|'')*'/g, "''"); // ignora literales ('soporte@wms.co')
    n = [...new Set([...code.matchAll(/@([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]))];
    paramNames.set(sql, n);
  }
  return n;
}

export function getDb(): DatabaseSync {
  if (db) return db;
  const file = config.dbPath;
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

export function closeDb() {
  cache.clear();
  db?.close();
  db = null;
}

function migrate(d: DatabaseSync) {
  const current = (d.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  for (let v = current; v < MIGRATIONS.length; v++) {
    d.exec('BEGIN');
    try {
      d.exec(MIGRATIONS[v]);
      d.exec(`PRAGMA user_version = ${v + 1}`);
      d.exec('COMMIT');
    } catch (e) {
      d.exec('ROLLBACK');
      throw e;
    }
  }
}

function norm(v: Param): string | number | bigint | null | Uint8Array {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}

function stmt(sql: string): StatementSync {
  let s = cache.get(sql);
  if (!s) {
    s = getDb().prepare(sql);
    cache.set(sql, s);
  }
  return s;
}

function exec<T>(sql: string, params: Params | undefined, fn: (s: StatementSync, p: any) => T): T {
  const s = stmt(sql);
  if (params === undefined) return fn(s, undefined);
  if (Array.isArray(params)) return fn(s, params.map(norm));
  const o: Record<string, any> = {};
  for (const k of namesOf(sql)) o[k] = norm(params[k]);
  return fn(s, o);
}

export function all<T = any>(sql: string, params?: Params): T[] {
  return exec(sql, params, (s, p) =>
    p === undefined ? s.all() : Array.isArray(p) ? s.all(...p) : s.all(p),
  ) as T[];
}

export function get<T = any>(sql: string, params?: Params): T | undefined {
  return exec(sql, params, (s, p) =>
    p === undefined ? s.get() : Array.isArray(p) ? s.get(...p) : s.get(p),
  ) as T | undefined;
}

export function run(sql: string, params?: Params): { changes: number } {
  const r = exec(sql, params, (s, p) =>
    p === undefined ? s.run() : Array.isArray(p) ? s.run(...p) : s.run(p),
  );
  return { changes: Number(r.changes) };
}

let txDepth = 0;
export function tx<T>(fn: () => T): T {
  const d = getDb();
  if (txDepth > 0) return fn();
  d.exec('BEGIN');
  txDepth++;
  try {
    const out = fn();
    d.exec('COMMIT');
    return out;
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  } finally {
    txDepth--;
  }
}

export const id = () => crypto.randomUUID();
export const now = () => new Date().toISOString();

/** Convierte columnas JSON y booleanas (0/1) de SQLite a tipos JS. */
export function parseJson<T>(v: unknown, fallback: T): T {
  if (typeof v !== 'string' || !v) return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}
export const bool = (v: unknown) => v === 1 || v === true || v === '1';
