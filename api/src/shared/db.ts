import { AsyncLocalStorage } from 'node:async_hooks';
import { config } from './config';
import { MIGRATIONS } from './migrations';

/**
 * Capa de acceso a datos con dos motores y la misma interfaz asíncrona (all/get/run/tx):
 *  - SQLite embebido (node:sqlite): desarrollo local, pruebas y la demo del navegador (sql.js).
 *  - PostgreSQL (DATABASE_URL, p. ej. Neon): los ambientes en la nube (laboratorio y producción).
 * Los repositorios escriben SQL estándar con parámetros @nombre; el motor de Postgres los traduce a $1…$n,
 * cambia LIKE por ILIKE (en SQLite LIKE ya ignora mayúsculas) y adapta los tipos de las migraciones.
 */
type Param = string | number | bigint | null | Uint8Array | boolean | undefined;
export type Params = Record<string, Param> | Param[];
export type Dialect = 'sqlite' | 'postgres';

/** Una conexión (o la transacción en curso). */
interface Conn {
  all(sql: string, params?: Params): Promise<any[]>;
  run(sql: string, params?: Params): Promise<number>;
  exec(sql: string): Promise<void>;
}
interface Driver extends Conn {
  dialect: Dialect;
  transaction<T>(fn: (c: Conn) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

let driver: Promise<Driver> | null = null;
/** Transacción activa en el contexto asíncrono actual (Postgres: cada transacción usa su propia conexión). */
const txStore = new AsyncLocalStorage<Conn>();

/** URL de Postgres configurada; vacía = SQLite (config.dbPath). */
const databaseUrl = () => (process.env.DATABASE_URL ?? '').trim();
export const dialect = (): Dialect => (databaseUrl() ? 'postgres' : 'sqlite');

/** Abre la base (una sola vez) y aplica las migraciones pendientes. */
export function getDb(): Promise<Driver> {
  driver ??= (async () => {
    const d = databaseUrl() ? await postgresDriver(databaseUrl()) : await sqliteDriver(config.dbPath);
    await migrate(d);
    return d;
  })().catch((e) => {
    driver = null;
    throw e;
  });
  return driver;
}

export async function closeDb() {
  const d = driver;
  driver = null;
  if (d) await (await d).close().catch(() => {});
}

/**
 * Borra TODO y deja la base vacía con el esquema al día (lo usa el seed del ambiente de laboratorio).
 * En producción nunca se ejecuta: el seed se niega antes de llegar aquí.
 */
export async function resetDatabase() {
  await closeDb();
  const url = databaseUrl();
  if (url && !url.startsWith('pglite:')) {
    const d = await postgresDriver(url);
    await d.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await d.close();
  } else if (!url) {
    const file = config.dbPath;
    if (file !== ':memory:') {
      const fs = await import('node:fs');
      for (const f of [file, `${file}-wal`, `${file}-shm`]) {
        try {
          if (fs.existsSync(f)) fs.rmSync(f);
        } catch (e) {
          console.error(`\n❌ No se pudo borrar ${f}. ¿La API está corriendo? Detén "npm run dev" y vuelve a intentar.\n`);
          throw e;
        }
      }
    }
  }
  await getDb();
}

/* ------------------------------------------------------------------ */
/* Migraciones                                                          */
/* ------------------------------------------------------------------ */

/** Adapta el DDL de las migraciones (escritas para SQLite) a PostgreSQL. */
export function ddlForPostgres(sql: string): string {
  return sql
    .replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, 'BIGSERIAL PRIMARY KEY')
    // SQLite admite decimales en columnas INTEGER (p. ej. segundos en movimiento): en Postgres, un tipo real.
    .replace(/\bINTEGER\b/g, 'DOUBLE PRECISION')
    .replace(/\bREAL\b/g, 'DOUBLE PRECISION')
    .replace(/\bBLOB\b/g, 'BYTEA')
    .replace(/\s+COLLATE NOCASE/g, '')
    .replace(/^\s*PRAGMA[^;]*;\s*$/gim, '');
}

async function migrate(d: Driver) {
  if (d.dialect === 'sqlite') {
    const current = Number((await d.all('PRAGMA user_version'))[0]?.user_version ?? 0);
    for (let v = current; v < MIGRATIONS.length; v++) {
      await d.transaction(async (c) => {
        await c.exec(MIGRATIONS[v]);
        await c.exec(`PRAGMA user_version = ${v + 1}`);
      });
    }
    return;
  }
  await d.exec('CREATE TABLE IF NOT EXISTS wms_schema (version BIGINT NOT NULL)');
  await d.transaction(async (c) => {
    // Si dos instancias arrancan a la vez, solo una migra (bloqueo hasta el fin de la transacción).
    await c.exec('SELECT pg_advisory_xact_lock(727272)');
    const rows = await c.all('SELECT version FROM wms_schema');
    if (!rows.length) await c.run('INSERT INTO wms_schema (version) VALUES (0)');
    const current = Number(rows[0]?.version ?? 0);
    for (let v = current; v < MIGRATIONS.length; v++) {
      await c.exec(ddlForPostgres(MIGRATIONS[v]));
      await c.run('UPDATE wms_schema SET version = @v', { v: v + 1 });
    }
  });
}

/* ------------------------------------------------------------------ */
/* SQLite (node:sqlite; en el navegador, el shim sobre sql.js)          */
/* ------------------------------------------------------------------ */

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

function norm(v: Param): string | number | bigint | null | Uint8Array {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}

async function sqliteDriver(file: string): Promise<Driver> {
  const { DatabaseSync } = await import('node:sqlite');
  if (file !== ':memory:') {
    const fs = await import('node:fs');
    const path = await import('node:path');
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const cache = new Map<string, any>();
  const stmt = (sql: string) => {
    let s = cache.get(sql);
    if (!s) {
      s = db.prepare(sql);
      cache.set(sql, s);
    }
    return s;
  };
  const bind = (sql: string, params?: Params): any[] => {
    if (params === undefined) return [];
    if (Array.isArray(params)) return params.map(norm);
    const o: Record<string, any> = {};
    for (const k of namesOf(sql)) o[k] = norm(params[k]);
    return [o];
  };
  const conn: Conn = {
    all: async (sql, params) => stmt(sql).all(...bind(sql, params)),
    run: async (sql, params) => Number(stmt(sql).run(...bind(sql, params)).changes),
    exec: async (sql) => void db.exec(sql),
  };
  // Una sola conexión: si ya hay una transacción abierta, las demás corren dentro de ella (no se anidan BEGIN).
  let depth = 0;
  return {
    dialect: 'sqlite',
    ...conn,
    async transaction(fn) {
      if (depth > 0) return fn(conn);
      db.exec('BEGIN');
      depth++;
      try {
        const out = await fn(conn);
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      } finally {
        depth--;
      }
    },
    async close() {
      cache.clear();
      db.close();
    },
  };
}

/* ------------------------------------------------------------------ */
/* PostgreSQL (pg contra Neon/Render; PGlite en memoria para pruebas)   */
/* ------------------------------------------------------------------ */

/** Fragmentos de una sentencia ya analizada: texto, un parámetro, o un «@x IS [NOT] NULL». */
type Piece = string | { p: string } | { isNull: string; not: boolean };
const pgParsed = new Map<string, { pieces: Piece[]; positional: boolean }>();
const pgCache = new Map<string, { text: string; names: string[] }>();

/** Analiza el SQL de los repositorios una sola vez: parámetros @nombre / ?, «IS NULL» de parámetros y LIKE. */
function parseForPostgres(sql: string) {
  const hit = pgParsed.get(sql);
  if (hit) return hit;
  const pieces: Piece[] = [];
  let buf = '';
  let positional = 0;
  const flush = () => {
    if (buf) pieces.push(buf.replace(/(^|[^A-Za-z_])LIKE(?=\s)/g, '$1ILIKE'));
    buf = '';
  };
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'") {
      // Literal entre comillas (con '' escapadas): se copia tal cual.
      let j = sql.indexOf("'", i + 1);
      while (j !== -1 && sql[j + 1] === "'") j = sql.indexOf("'", j + 2);
      const stop = j === -1 ? sql.length : j + 1;
      flush();
      pieces.push(sql.slice(i, stop));
      i = stop - 1;
      continue;
    }
    let name: string | null = null;
    let len = 0;
    if (ch === '@' && /[A-Za-z_]/.test(sql[i + 1] ?? '')) {
      name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(sql.slice(i + 1))![0];
      len = name.length + 1;
    } else if (ch === '?') {
      name = `#${++positional}`;
      len = 1;
    }
    if (!name) {
      buf += ch;
      continue;
    }
    flush();
    const tail = /^\s+IS\s+(NOT\s+)?NULL\b/i.exec(sql.slice(i + len));
    if (tail) {
      pieces.push({ isNull: name, not: !!tail[1] });
      i += len + tail[0].length - 1;
    } else {
      pieces.push({ p: name });
      i += len - 1;
    }
  }
  flush();
  const out = { pieces, positional: positional > 0 };
  pgParsed.set(sql, out);
  return out;
}

/**
 * Traduce el SQL de los repositorios a PostgreSQL para unos valores concretos:
 *  - @nombre y ? pasan a $1…$n (solo los parámetros que se usan de verdad);
 *  - «@x IS NULL» / «@x IS NOT NULL» se resuelven con el valor (TRUE/FALSE): Postgres no puede deducir el tipo
 *    de un parámetro que solo aparece ahí, y el resultado es idéntico;
 *  - LIKE pasa a ILIKE (en SQLite LIKE ya ignora mayúsculas y minúsculas);
 *  - los literales entre comillas simples no se tocan.
 */
export function sqlForPostgres(sql: string, isNull: (name: string) => boolean = () => false) {
  const q = parseForPostgres(sql);
  const nullNames = q.pieces.flatMap((x) => (typeof x === 'object' && 'isNull' in x ? [x.isNull] : []));
  const key = nullNames.length ? `${sql}\u0000${nullNames.map((n) => (isNull(n) ? 1 : 0)).join('')}` : sql;
  const hit = pgCache.get(key);
  if (hit) return hit;
  const names: string[] = [];
  let text = '';
  for (const x of q.pieces) {
    if (typeof x === 'string') text += x;
    else if ('p' in x) {
      let k = names.indexOf(x.p);
      if (k === -1) k = names.push(x.p) - 1;
      text += `$${k + 1}`;
    } else text += isNull(x.isNull) !== x.not ? 'TRUE' : 'FALSE';
  }
  const out = { text, names };
  pgCache.set(key, out);
  return out;
}

function pgValue(v: Param): unknown {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'bigint') return v.toString();
  return v;
}

function pgArgs(sql: string, params?: Params) {
  const value = (name: string): Param =>
    params === undefined
      ? undefined
      : Array.isArray(params)
        ? params[Number(name.slice(1)) - 1]
        : (params as Record<string, Param>)[name];
  const q = sqlForPostgres(sql, (n) => value(n) === null || value(n) === undefined);
  return { text: q.text, values: q.names.map((n) => pgValue(value(n))) };
}

/** Lo mínimo que se necesita de un cliente de Postgres (pg o PGlite). */
interface PgLike {
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null; affectedRows?: number }>;
}

function pgConn(c: PgLike, execMany: (sql: string) => Promise<void>): Conn {
  // El error de Postgres no dice qué consulta falló: se adjunta el SQL (recortado) para poder ubicarla.
  const query = async (sql: string, params?: Params) => {
    const a = pgArgs(sql, params);
    try {
      return await c.query(a.text, a.values);
    } catch (e: any) {
      if (e && typeof e === 'object') e.sql = a.text.replace(/\s+/g, ' ').slice(0, 300);
      throw e;
    }
  };
  return {
    all: async (sql, params) => (await query(sql, params)).rows,
    run: async (sql, params) => {
      const r = await query(sql, params);
      return Number(r.rowCount ?? r.affectedRows ?? 0);
    },
    exec: execMany,
  };
}

async function postgresDriver(url: string): Promise<Driver> {
  if (url.startsWith('pglite:')) {
    // Pruebas: Postgres real compilado a WebAssembly, en memoria, sin servidor.
    const { PGlite } = await import('@electric-sql/pglite');
    const lite = await PGlite.create({ parsers: { 20: Number, 1700: parseFloat } });
    const base = pgConn(lite as unknown as PgLike, async (sql) => void (await lite.exec(sql)));
    return {
      dialect: 'postgres',
      ...base,
      async transaction(fn) {
        const cur = txStore.getStore();
        if (cur) return fn(cur);
        return await lite.transaction(async (t) => {
          const c = pgConn(t as unknown as PgLike, async (sql) => void (await t.exec(sql)));
          return txStore.run(c, () => fn(c));
        }) as Promise<any>;
      },
      close: () => lite.close(),
    };
  }

  const pg = await import('pg');
  const { Pool, types } = (pg as any).default ?? pg;
  types.setTypeParser(20, (v: string) => Number(v)); // BIGINT / COUNT(*) como número
  types.setTypeParser(1700, (v: string) => parseFloat(v)); // NUMERIC (SUM, AVG)
  const pool = new Pool({
    connectionString: url,
    max: Number(process.env.DATABASE_POOL_MAX ?? 8),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
  });
  pool.on('error', (e: Error) => console.error('[db] conexión de Postgres caída:', e.message));
  const base = pgConn(pool, async (sql) => void (await pool.query(sql)));
  return {
    dialect: 'postgres',
    ...base,
    async transaction(fn) {
      const cur = txStore.getStore();
      if (cur) return fn(cur);
      const client = await pool.connect();
      const c = pgConn(client, async (sql) => void (await client.query(sql)));
      try {
        await client.query('BEGIN');
        const out = await txStore.run(c, () => fn(c));
        await client.query('COMMIT');
        return out;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

/* ------------------------------------------------------------------ */
/* API de los repositorios                                              */
/* ------------------------------------------------------------------ */

async function conn(): Promise<Conn> {
  return txStore.getStore() ?? (await getDb());
}

export async function all<T = any>(sql: string, params?: Params): Promise<T[]> {
  return (await (await conn()).all(sql, params)) as T[];
}

export async function get<T = any>(sql: string, params?: Params): Promise<T | undefined> {
  return (await (await conn()).all(sql, params))[0] as T | undefined;
}

export async function run(sql: string, params?: Params): Promise<{ changes: number }> {
  return { changes: await (await conn()).run(sql, params) };
}

/** Ejecuta `fn` en una transacción (si ya hay una abierta en este contexto, se reutiliza). */
export async function tx<T>(fn: () => Promise<T>): Promise<T> {
  const cur = txStore.getStore();
  if (cur) return fn();
  const d = await getDb();
  return d.transaction((c) => (d.dialect === 'postgres' ? txStore.run(c, fn) : fn()));
}

export const id = () => crypto.randomUUID();
export const now = () => new Date().toISOString();

/** Convierte columnas JSON y booleanas (0/1) de la base a tipos JS. */
export function parseJson<T>(v: unknown, fallback: T): T {
  if (typeof v !== 'string' || !v) return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}
export const bool = (v: unknown) => v === 1 || v === true || v === '1';
