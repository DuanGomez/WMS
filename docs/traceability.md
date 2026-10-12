# Matriz de trazabilidad · WMS

Relación entre cada requisito del PPI (secciones 5, 6 y 7), su implementación en el backend (función / endpoint), la pantalla del frontend que lo usa y la prueba automatizada que lo verifica.

- Las pruebas del backend están en `api/test/` y se ejecutan con `npm run test:api`.
- Las pruebas del frontend están en `apps/web/src/**/*.spec.ts` y se ejecutan con `npm test -w apps/web`.
- «Manual» significa que se verificó a mano siguiendo el guion de demostración del README.

## Requisitos generales (RG)

| Req. | Descripción | Implementación (backend) | Pantalla | Verificación |
|---|---|---|---|---|
| RG1 | App web SaaS accesible desde cualquier dispositivo | SPA Angular + Azure Functions; `companies/signup` | Todas (responsive) | Manual (escritorio, tablet, móvil) |
| RG2 | Monitoreo en tiempo real | `tracking-ingest` → bus → `tracking-stream` (SSE) / `tracking/poll` | Mapa en vivo | `alerts-e2e.test.ts` › E2E GPS → stream |
| RG3 | Geocercas | `geofences/*` (círculo, polígono, corredor) | Geocercas | `geo.test.ts`, `alerts-e2e.test.ts` › entrada/salida |
| RG4 | Alertas automáticas (robo, desvío, parada, fallo) | `shared/alert-engine.ts`, `watchdog-timer` | Alertas, toasts | `alerts-e2e.test.ts` › Motor de alertas |
| RG5 | Reportes de vehículos y conductores | `reports/*` (pdfkit + exceljs) | Reportes | `alerts-e2e.test.ts` › Reportes |
| RG6 | Tipos de vehículo y flotas mixtas | `vehicles` (`moto`, `carro`, `camion`, `furgon`) | Vehículos | `auth-tenant.test.ts` (creación de vehículos) |
| RG7 | Suscripción sin desarrollos a medida | `companies/*`, `subscription/*`, límites del plan | Suscripción, Registro | `auth-tenant.test.ts` › Planes |
| RG8 | Integración con GPS | `POST /api/tracking/ingest` + `x-device-key`; simulador | Dispositivos GPS | `alerts-e2e.test.ts` › Ingesta GPS |
| RG9 | Usuarios y roles | `users/*`, `permissions.ts` | Usuarios y permisos | `auth-tenant.test.ts` › Roles y permisos |
| RG10 | Seguridad y acceso por empresa | JWT + refresh rotativo, bcrypt, zod, filtro `company_id` | Login | `auth-tenant.test.ts` › Aislamiento multi-tenant |

## Requisitos específicos (RE)

| Req. | Descripción | Implementación | Pantalla | Verificación |
|---|---|---|---|---|
| RE1 | Mapa con ubicación actual y actualización periódica | `tracking/live`, `tracking/stream`, `VehicleMarker` interpolado | Mapa en vivo | E2E SSE + manual |
| RE2 | Dibujar geocercas (polígono/círculo) asociadas a vehículos | `POST/PATCH /api/geofences`, `geofence_vehicles` | Geocercas (dibujo en mapa) | `geo.test.ts` |
| RE3 | Notificar entrada/salida (plataforma, correo, push) | `evaluatePosition` + `fireAlert` + bandeja `notifications` | Toasts, Alertas › Notificaciones enviadas | `alerts-e2e.test.ts` › entrada y salida |
| RE4 | Parada prolongada con umbral configurable | regla `prolonged_stop` (ingest + watchdog) | Alertas › Reglas | `alerts-e2e.test.ts` › parada prolongada |
| RE5 | Pérdida de señal / fallo del GPS | `watchdogTick()` (timer cada 5 s) | Alertas, Dispositivos | `alerts-e2e.test.ts` › pérdida de señal |
| RE6 | Exportar reportes (PDF/Excel) | `reports/{id}/download` | Reportes | `alerts-e2e.test.ts` › Reportes (`%PDF-`, `PK`) |
| RE7 | Registrar y asociar conductores | `drivers/*`, `drivers/{id}/vehicle` | Conductores | Manual + `auth-tenant.test.ts` (rol conductor) |
| RE8 | Multi-tenant con datos aislados | `company_id` obligatorio en todos los repositorios | — | `auth-tenant.test.ts` › Aislamiento (4 pruebas) |
| RE9 | Planes de suscripción y facturación | `subscription/*`, `invoices/*` | Suscripción y facturación | `auth-tenant.test.ts` › Planes |
| RE10 | Responsive (celular, tablet, computador) | Sidebar / sidebar colapsada / tab bar + bottom sheet | Todas | Manual (capturas `*-movil.png`) |

## Requisitos funcionales (RF)

| RF | Operación | Endpoint | Pantalla | Verificación |
|---|---|---|---|---|
| RF1 | Crear vehículo | `POST /api/vehicles` | Vehículos › Nuevo | `auth-tenant.test.ts` › Planes |
| RF2 | Consultar vehículo y ubicación | `GET /api/vehicles`, `GET /api/vehicles/{id}`, `GET /api/tracking/live` | Vehículos, Mapa | `alerts-e2e.test.ts` › almacena posición |
| RF3 | Actualizar vehículo (tipo, estado, conductor, GPS) | `PATCH /api/vehicles/{id}` | Vehículos › Editar | `auth-tenant.test.ts` (404 entre tenants) |
| RF4 | Dar de baja vehículo | `DELETE /api/vehicles/{id}?reason=` | Vehículos › Dar de baja | Manual |
| RF5 | Crear geocerca | `POST /api/geofences` | Geocercas › Nueva | Manual |
| RF6 | Consultar geocercas y estado | `GET /api/geofences` (incluye `vehiclesInside`) | Geocercas | `auth-tenant.test.ts` |
| RF7 | Actualizar geocerca | `PATCH /api/geofences/{id}` | Geocercas › Editar | Manual |
| RF8 | Eliminar geocerca (lógico) | `DELETE /api/geofences/{id}` (`deleted_at`) | Geocercas | Manual |
| RF9 | Crear usuario con rol | `POST /api/users` | Usuarios › Nuevo | Manual |
| RF10 | Listar usuarios y permisos | `GET /api/users` | Usuarios | `auth-tenant.test.ts` › permiso granular |
| RF11 | Actualizar datos o rol | `PATCH /api/users/{id}` | Usuarios › Editar | Manual |
| RF12 | Eliminar/desactivar usuario | `DELETE /api/users/{id}` | Usuarios | Manual |
| RF13 | Iniciar sesión | `POST /api/auth/login` | Login | `auth-tenant.test.ts` › Autenticación |
| RF14 | Cerrar sesión segura | `POST /api/auth/logout` (revoca refresh) | Sidebar › Cerrar sesión | `auth-tenant.test.ts` › refresh/logout |
| RF15 | Crear regla de alerta | `POST /api/alert-rules` | Alertas › Reglas › Nueva | `alerts-e2e.test.ts` › CRUD de reglas |
| RF16 | Historial de alertas | `GET /api/alerts` (filtros + paginación) | Alertas › Historial | `alerts-e2e.test.ts` |
| RF17 | Actualizar regla | `PATCH /api/alert-rules/{id}` | Alertas › Reglas | `alerts-e2e.test.ts` › CRUD de reglas |
| RF18 | Eliminar regla | `DELETE /api/alert-rules/{id}` | Alertas › Reglas | `alerts-e2e.test.ts` › CRUD de reglas |
| RF19 | Generar reporte personalizado | `POST /api/reports` | Reportes › Generar | `alerts-e2e.test.ts` › Reportes |
| RF20 | Consultar reportes generados | `GET /api/reports` | Reportes | `auth-tenant.test.ts` |
| RF21 | Regenerar con nuevos parámetros | `POST /api/reports/{id}/regenerate` | Reportes › Regenerar | `alerts-e2e.test.ts` (versión 2) |
| RF22 | Eliminar reporte | `DELETE /api/reports/{id}` | Reportes | `alerts-e2e.test.ts` (enlace deja de funcionar) |
| RF23 | Crear empresa con plan | `POST /api/companies/signup` | Registro | `auth-tenant.test.ts` › registro |
| RF24 | Consultar suscripción y plan | `GET /api/subscription` | Suscripción | `auth-tenant.test.ts` › registro |
| RF25 | Cambiar plan | `PUT /api/subscription/plan` | Suscripción › Planes | Manual |
| RF26 | Cancelar suscripción | `POST /api/subscription/cancel` | Suscripción | Manual |
| RF27 | Cambiar / recuperar contraseña | `POST /api/auth/change-password`, `forgot-password`, `reset-password` | Ajustes, Recuperar | `auth-tenant.test.ts` › cambio de contraseña |
| RF28 | Registrar GPS independiente | `POST /api/devices` (devuelve API key) | Dispositivos › Registrar | Manual |
| RF29 | Listar GPS con estado y vehículo | `GET /api/devices` | Dispositivos | `auth-tenant.test.ts` |
| RF30 | Reasignar GPS o cambiar estado | `PATCH /api/devices/{id}` (`vehicleId`, `status`) | Dispositivos › Editar | Manual |
| RF31 | Eliminar GPS (robado, dañado, fin de vida útil) | `DELETE /api/devices/{id}?reason=` | Dispositivos | Manual |
| RF32 | Permisos granulares por módulo | `PUT /api/users/{id}/permissions` | Usuarios › Permisos | `auth-tenant.test.ts` › permiso revocado |
| RF33 | Compartir reporte (enlace o usuario) | `POST /api/reports/{id}/share`, `GET /api/public/reports/{token}` | Reportes › Compartir, `/compartido/:token` | `alerts-e2e.test.ts` › enlace público |

## Modelo de dominio → tablas

| Clase del diagrama | Tabla / módulo |
|---|---|
| Usuario (iniciarSesion, cerrarSesion, cambiarContraseña) | `users`, `refresh_tokens`, `password_resets` · `functions/auth` |
| Administrador (puedeGestionarUsuarios, …) | rol `admin` + permisos granulares (`permissions.ts`) |
| Repartidor / Conductor (teléfono, estado, turnoActivo, enviarAlertaEmergencia, iniciar/finalizarRecorrido) | `driver_profiles` · `me/emergency`, `me/trip/start`, `me/trip/finish` |
| DispositivoGPS (modelo, nivelBatería, estadoConexión, encendido, últimaActualización) | `devices` |
| Ubicacion (lat, lng, timestamp, velocidad, precisión) | `positions`, `vehicle_live` |
| Recorrido (fechaInicio, fechaFin, distanciaTotal, trayecto, alertas) | `trips` (+ `positions.trip_id`, `alerts.trip_id`) |
| Reporte (fechaGeneración, periodo, formato, recorridos, alertas) | `reports`, `report_shares` |
| Alerta (tipo, descripción, timestamp, ubicación, atendida, prioridad) | `alerts`, `notifications` |
| Empresa, Plan, Suscripción | `companies`, `plans`, `subscriptions`, `invoices` |
| Vehículo, Geocerca, ReglaAlerta | `vehicles`, `geofences`, `geofence_vehicles`, `alert_rules`, `rule_state` |
| TicketSoporte | `tickets`, `ticket_comments` |
