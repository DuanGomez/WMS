/**
 * Migraciones versionadas (PRAGMA user_version). Agregar siempre al final, nunca editar las anteriores.
 * Todas las tablas de negocio tienen company_id (tenant) para garantizar el aislamiento (RE8, RG10).
 */
export const MIGRATIONS: string[] = [
  /* v1 – esquema inicial */ `
CREATE TABLE plans (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_cop INTEGER NOT NULL,
  max_vehicles INTEGER NOT NULL,
  max_users INTEGER NOT NULL,
  features TEXT NOT NULL DEFAULT '[]',
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  nit TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT 'Medellín',
  address TEXT NOT NULL DEFAULT '',
  is_platform INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  plan_id TEXT NOT NULL REFERENCES plans(id),
  status TEXT NOT NULL CHECK (status IN ('trialing','active','past_due','canceled')),
  started_at TEXT NOT NULL,
  current_period_start TEXT NOT NULL,
  current_period_end TEXT NOT NULL,
  canceled_at TEXT,
  cancel_reason TEXT
);
CREATE INDEX ix_subscriptions_company ON subscriptions(company_id);

CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  subscription_id TEXT NOT NULL REFERENCES subscriptions(id),
  number TEXT NOT NULL,
  plan_name TEXT NOT NULL,
  amount_cop INTEGER NOT NULL,
  tax_cop INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('paid','pending','void')),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  due_at TEXT NOT NULL,
  paid_at TEXT
);
CREATE INDEX ix_invoices_company ON invoices(company_id);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','owner','supervisor','driver','support')),
  permissions TEXT NOT NULL DEFAULT '{}',
  phone TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX ix_users_company ON users(company_id);

CREATE TABLE driver_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  company_id TEXT NOT NULL REFERENCES companies(id),
  document TEXT NOT NULL DEFAULT '',
  license_number TEXT NOT NULL DEFAULT '',
  license_category TEXT NOT NULL DEFAULT 'A2',
  license_expires_at TEXT,
  status TEXT NOT NULL DEFAULT 'disponible' CHECK (status IN ('disponible','en_ruta','descanso','inactivo')),
  shift_active INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX ix_driver_profiles_company ON driver_profiles(company_id);

CREATE TABLE refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE password_resets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  serial TEXT NOT NULL,
  model TEXT NOT NULL,
  api_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','faulty','retired')),
  connection TEXT NOT NULL DEFAULT 'unknown' CHECK (connection IN ('online','offline','unknown')),
  battery INTEGER,
  powered INTEGER NOT NULL DEFAULT 1,
  last_seen_at TEXT,
  notes TEXT NOT NULL DEFAULT '',
  retired_reason TEXT,
  retired_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (company_id, serial)
);
CREATE INDEX ix_devices_company ON devices(company_id);

CREATE TABLE vehicles (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  plate TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('moto','carro','camion','furgon')),
  brand TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  year INTEGER,
  color TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','maintenance','inactive','retired')),
  device_id TEXT REFERENCES devices(id),
  driver_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  retired_at TEXT,
  retired_reason TEXT
);
CREATE UNIQUE INDEX ux_vehicles_plate ON vehicles(company_id, plate) WHERE retired_at IS NULL;
CREATE UNIQUE INDEX ux_vehicles_device ON vehicles(device_id) WHERE device_id IS NOT NULL AND retired_at IS NULL;
CREATE INDEX ix_vehicles_company ON vehicles(company_id);

CREATE TABLE trips (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
  driver_id TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  distance_m REAL NOT NULL DEFAULT 0,
  max_speed REAL NOT NULL DEFAULT 0,
  moving_seconds INTEGER NOT NULL DEFAULT 0,
  stopped_seconds INTEGER NOT NULL DEFAULT 0,
  points INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed'))
);
CREATE INDEX ix_trips_company_vehicle ON trips(company_id, vehicle_id, started_at);

CREATE TABLE positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id TEXT NOT NULL,
  vehicle_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  trip_id TEXT,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  speed REAL NOT NULL DEFAULT 0,
  heading REAL NOT NULL DEFAULT 0,
  accuracy REAL NOT NULL DEFAULT 5,
  battery INTEGER,
  ignition INTEGER NOT NULL DEFAULT 1,
  ts TEXT NOT NULL
);
CREATE INDEX ix_positions_vehicle_ts ON positions(company_id, vehicle_id, ts);
CREATE INDEX ix_positions_trip ON positions(trip_id);

CREATE TABLE vehicle_live (
  vehicle_id TEXT PRIMARY KEY REFERENCES vehicles(id),
  company_id TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  speed REAL NOT NULL DEFAULT 0,
  heading REAL NOT NULL DEFAULT 0,
  accuracy REAL NOT NULL DEFAULT 5,
  battery INTEGER,
  ignition INTEGER NOT NULL DEFAULT 1,
  ts TEXT NOT NULL,
  stopped_since TEXT
);

CREATE TABLE geofences (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  shape TEXT NOT NULL CHECK (shape IN ('circle','polygon','corridor')),
  center_lat REAL,
  center_lng REAL,
  radius_m REAL,
  coordinates TEXT NOT NULL DEFAULT '[]',
  color TEXT NOT NULL DEFAULT '#007AFF',
  all_vehicles INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX ix_geofences_company ON geofences(company_id);

CREATE TABLE geofence_vehicles (
  geofence_id TEXT NOT NULL REFERENCES geofences(id),
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
  PRIMARY KEY (geofence_id, vehicle_id)
);

CREATE TABLE geofence_state (
  geofence_id TEXT NOT NULL,
  vehicle_id TEXT NOT NULL,
  inside INTEGER NOT NULL,
  changed_at TEXT NOT NULL,
  PRIMARY KEY (geofence_id, vehicle_id)
);

CREATE TABLE alert_rules (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('geofence_enter','geofence_exit','prolonged_stop','signal_loss','route_deviation','speeding','theft','low_battery')),
  threshold REAL,
  geofence_id TEXT REFERENCES geofences(id),
  vehicle_ids TEXT NOT NULL DEFAULT '[]',
  recipients TEXT NOT NULL DEFAULT '[]',
  channels TEXT NOT NULL DEFAULT '["inapp"]',
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX ix_alert_rules_company ON alert_rules(company_id);

CREATE TABLE rule_state (
  rule_id TEXT NOT NULL,
  vehicle_id TEXT NOT NULL,
  firing INTEGER NOT NULL DEFAULT 0,
  last_fired_at TEXT,
  PRIMARY KEY (rule_id, vehicle_id)
);

CREATE TABLE alerts (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  rule_id TEXT,
  vehicle_id TEXT,
  device_id TEXT,
  trip_id TEXT,
  type TEXT NOT NULL,
  priority TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  lat REAL,
  lng REAL,
  ts TEXT NOT NULL,
  attended INTEGER NOT NULL DEFAULT 0,
  attended_by TEXT,
  attended_at TEXT
);
CREATE INDEX ix_alerts_company_ts ON alerts(company_id, ts);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  alert_id TEXT,
  channel TEXT NOT NULL CHECK (channel IN ('email','push','inapp')),
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent',
  created_at TEXT NOT NULL
);
CREATE INDEX ix_notifications_company ON notifications(company_id, created_at);

CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  created_by TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('trips','alerts','usage','full')),
  format TEXT NOT NULL CHECK (format IN ('pdf','xlsx')),
  vehicle_id TEXT,
  driver_id TEXT,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '{}',
  content BLOB,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  generated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX ix_reports_company ON reports(company_id, generated_at);

CREATE TABLE report_shares (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  report_id TEXT NOT NULL REFERENCES reports(id),
  token TEXT NOT NULL UNIQUE,
  shared_with_user_id TEXT,
  message TEXT NOT NULL DEFAULT '',
  expires_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE tickets (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  number INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','closed')),
  assigned_to TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX ix_tickets_company ON tickets(company_id);

CREATE TABLE ticket_comments (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id),
  author_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE simulator_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  state TEXT NOT NULL
);
`,
  /* v2 – ubicación del celular del conductor (geolocalización del navegador, sin GPS dedicado) */ `
CREATE TABLE driver_locations (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  company_id TEXT NOT NULL REFERENCES companies(id),
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  accuracy REAL,
  speed REAL,
  heading REAL,
  sharing INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'browser',
  ts TEXT NOT NULL
);
CREATE INDEX ix_driver_locations_company ON driver_locations(company_id);
`,
];
