/**
 * Reemplazo de `node:sqlite` para el navegador sobre sql.js (SQLite compilado a WebAssembly).
 * Implementa solo lo que usa `shared/db.ts`: DatabaseSync.prepare/exec/close y StatementSync.all/get/run.
 * El motor sql.js lo inicializa `demo/browser.ts` y lo deja en `globalThis.__WMS_SQL`.
 */
type Row = Record<string, unknown>;
type Params = unknown[];

const g = globalThis as any;

function bindable(args: Params): any {
  if (!args.length) return undefined;
  const first = args[0];
  // Parámetros con nombre: db.ts envía las claves sin prefijo; sql.js las espera con el prefijo «@».
  if (args.length === 1 && first && typeof first === 'object' && !(first instanceof Uint8Array)) {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(first)) o[`@${k}`] = v === undefined ? null : v;
    return o;
  }
  return args.map((v) => (v === undefined ? null : v));
}

export class StatementSync {
  constructor(
    private owner: DatabaseSync,
    private sql: string,
  ) {}

  /** Se prepara en cada uso: `export()` de sql.js libera las sentencias abiertas. */
  private withStmt<T>(args: Params, fn: (s: any) => T): T {
    const s = this.owner.raw.prepare(this.sql);
    try {
      const b = bindable(args);
      if (b !== undefined) s.bind(b);
      return fn(s);
    } finally {
      s.free();
    }
  }

  all(...args: Params): Row[] {
    return this.withStmt(args, (s) => {
      const out: Row[] = [];
      while (s.step()) out.push(s.getAsObject());
      return out;
    });
  }

  get(...args: Params): Row | undefined {
    return this.withStmt(args, (s) => (s.step() ? s.getAsObject() : undefined));
  }

  run(...args: Params): { changes: number; lastInsertRowid: number } {
    this.withStmt(args, (s) => s.step());
    return { changes: this.owner.raw.getRowsModified(), lastInsertRowid: 0 };
  }
}

export class DatabaseSync {
  raw: any;

  constructor(_path: string) {
    const SQL = g.__WMS_SQL;
    if (!SQL) throw new Error('sql.js no está inicializado');
    // En el navegador hay una sola base en memoria: si ya existe se reutiliza (closeDb/getDb del seed
    // en Node reabren el archivo; aquí no hay archivo, así que cerrarla perdería los datos).
    if (g.__WMS_DB) {
      this.raw = g.__WMS_DB.raw;
      return;
    }
    // Si hay una copia guardada en IndexedDB, se carga una sola vez (la primera conexión).
    const bytes: Uint8Array | null = g.__WMS_DB_BYTES ?? null;
    g.__WMS_DB_BYTES = null;
    this.raw = bytes ? new SQL.Database(bytes) : new SQL.Database();
    g.__WMS_DB = this;
  }

  prepare(sql: string) {
    return new StatementSync(this, sql);
  }

  exec(sql: string) {
    this.raw.exec(sql);
  }

  /** No-op a propósito: la base en memoria vive mientras la página esté abierta. */
  close() {}

  /** Copia binaria de la base (para persistirla en IndexedDB). */
  export(): Uint8Array {
    const out = this.raw.export();
    this.raw.exec('PRAGMA foreign_keys = ON;');
    return out;
  }
}
