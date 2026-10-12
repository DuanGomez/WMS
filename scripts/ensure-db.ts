/** Se ejecuta antes de `npm run dev`: si no existe la base de datos demo, corre el seed automáticamente. */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { config } from '../api/src/shared/config';

if (config.dbPath !== ':memory:' && !fs.existsSync(config.dbPath)) {
  console.log('ℹ️  No hay base de datos local: ejecutando el seed de datos demo por primera vez…');
  execSync('npx tsx scripts/seed.ts', { stdio: 'inherit' });
} else {
  console.log(
    `ℹ️  Usando la base de datos existente (${config.dbPath}). Para reiniciar la demo: npm run seed`,
  );
}
