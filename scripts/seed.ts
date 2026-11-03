/**
 * Carga los datos demo (empresas, usuarios de cada rol, flota, geocercas, 7 días de historial…).
 * Uso: npm run seed — BORRA y recrea la base: la local (SQLite) o, con DATABASE_URL, la del laboratorio.
 * En producción (APP_ENV=production) se niega a ejecutarse. El seed vive en api/src/seed/demo.ts.
 */
import { closeDb } from '../api/src/shared/db';
import { seed } from '../api/src/seed/demo';

seed()
  .then(() => closeDb())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
