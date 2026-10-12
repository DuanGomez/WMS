import os from 'node:os';
import path from 'node:path';

// Cada archivo de prueba usa su propia base de datos temporal (nunca la de desarrollo).
process.env.DB_PATH = path.join(
  os.tmpdir(),
  `wms-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
);
process.env.DEMO_MODE = 'true';
process.env.JWT_SECRET = 'test-secret';
