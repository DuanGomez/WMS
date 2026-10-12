/**
 * Punto de entrada de las funciones (Azure Functions v4 – modelo de programación por código).
 * Cada módulo se registra con defineHttp/defineStream/defineTimer (ver shared/http.ts).
 */
import './functions/auth';
import './functions/users';
import './functions/vehicles';
import './functions/drivers';
import './functions/devices';
import './functions/geofences';
import './functions/alerts';
import './functions/reports';
import './functions/companies';
import './functions/support';
import './functions/tracking-ingest';
import './functions/tracking-stream';
import './functions/watchdog-timer';
import './functions/gps-simulator';
import { getDb } from './shared/db';

// Abre la base de datos y aplica migraciones al arrancar.
getDb();

export { registry } from './shared/http';
