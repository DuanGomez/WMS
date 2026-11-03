/**
 * Reemplazo mínimo de AsyncLocalStorage para el navegador. En la demo la base es SQLite (sql.js) con una sola
 * conexión y las transacciones no dependen de este contexto: solo hace falta la misma forma de la API.
 */
export class AsyncLocalStorage<T> {
  private store: T | undefined;

  getStore(): T | undefined {
    return this.store;
  }

  run<R>(store: T, fn: () => R): R {
    const prev = this.store;
    this.store = store;
    try {
      return fn();
    } finally {
      this.store = prev;
    }
  }
}
