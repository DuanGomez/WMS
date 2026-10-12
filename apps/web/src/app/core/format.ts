import { Pipe, PipeTransform } from '@angular/core';

/** Formatos locales es-CO, zona America/Bogota y moneda COP. */
const TZ = 'America/Bogota';
const dtf = new Intl.DateTimeFormat('es-CO', {
  timeZone: TZ,
  dateStyle: 'medium',
  timeStyle: 'short',
});
const df = new Intl.DateTimeFormat('es-CO', { timeZone: TZ, dateStyle: 'medium' });
const tf = new Intl.DateTimeFormat('es-CO', {
  timeZone: TZ,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});
const cop = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});
const rtf = new Intl.RelativeTimeFormat('es-CO', { numeric: 'auto', style: 'short' });

export const fmt = {
  dateTime: (v?: string | Date | null) => (v ? dtf.format(new Date(v)) : '—'),
  date: (v?: string | Date | null) => (v ? df.format(new Date(v)) : '—'),
  time: (v?: string | Date | null) => (v ? tf.format(new Date(v)) : '—'),
  cop: (v?: number | null) => (v == null ? '—' : cop.format(v)),
  num: (v?: number | null, d = 1) =>
    v == null ? '—' : new Intl.NumberFormat('es-CO', { maximumFractionDigits: d }).format(v),
  km: (v?: number | null) => (v == null ? '—' : `${fmt.num(v)} km`),
  bytes: (b: number) =>
    b > 1e6 ? `${fmt.num(b / 1e6)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`,
  relative(v?: string | Date | null) {
    if (!v) return '—';
    const s = (new Date(v).getTime() - Date.now()) / 1000;
    const a = Math.abs(s);
    if (a < 10) return 'ahora';
    if (a < 60) return rtf.format(Math.round(s), 'second');
    if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
    if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour');
    return rtf.format(Math.round(s / 86400), 'day');
  },
  duration(sec: number) {
    if (sec < 60) return `${Math.round(sec)} s`;
    if (sec < 3600) return `${Math.floor(sec / 60)} min ${Math.round(sec % 60)} s`;
    return `${Math.floor(sec / 3600)} h ${Math.round((sec % 3600) / 60)} min`;
  },
  /** Valor para <input type="datetime-local"> en hora de Bogotá. */
  toLocalInput(d: Date) {
    const local = new Date(d.getTime() - 5 * 3600_000);
    return local.toISOString().slice(0, 16);
  },
  fromLocalInput(v: string) {
    return new Date(`${v}:00-05:00`).toISOString();
  },
};

@Pipe({ name: 'dt' })
export class DtPipe implements PipeTransform {
  transform(
    v: string | Date | null | undefined,
    mode: 'datetime' | 'date' | 'time' | 'relative' = 'datetime',
  ) {
    return mode === 'date'
      ? fmt.date(v)
      : mode === 'time'
        ? fmt.time(v)
        : mode === 'relative'
          ? fmt.relative(v)
          : fmt.dateTime(v);
  }
}

@Pipe({ name: 'cop' })
export class CopPipe implements PipeTransform {
  transform(v: number | null | undefined) {
    return fmt.cop(v);
  }
}

@Pipe({ name: 'num' })
export class NumPipe implements PipeTransform {
  transform(v: number | null | undefined, d = 1) {
    return fmt.num(v, d);
  }
}

export const VEHICLE_TYPES: Record<string, { label: string; icon: string }> = {
  moto: { label: 'Moto', icon: 'bike' },
  carro: { label: 'Carro', icon: 'car' },
  camion: { label: 'Camión', icon: 'truck' },
  furgon: { label: 'Furgón', icon: 'bus' },
};

export const VEHICLE_STATUS: Record<string, { label: string; tone: string }> = {
  active: { label: 'Activo', tone: 'green' },
  maintenance: { label: 'Mantenimiento', tone: 'orange' },
  inactive: { label: 'Inactivo', tone: '' },
  retired: { label: 'Dado de baja', tone: 'red' },
};

export const DEVICE_STATUS: Record<string, { label: string; tone: string }> = {
  active: { label: 'Activo', tone: 'green' },
  inactive: { label: 'Inactivo', tone: '' },
  faulty: { label: 'En falla', tone: 'red' },
  retired: { label: 'Dado de baja', tone: 'red' },
};

export const PRIORITY: Record<string, { label: string; tone: string }> = {
  low: { label: 'Baja', tone: '' },
  medium: { label: 'Media', tone: 'blue' },
  high: { label: 'Alta', tone: 'orange' },
  critical: { label: 'Crítica', tone: 'red' },
};

export const ALERT_ICONS: Record<string, { icon: string; color: string }> = {
  geofence_enter: { icon: 'log-in', color: 'green' },
  geofence_exit: { icon: 'log-out', color: 'orange' },
  prolonged_stop: { icon: 'timer', color: 'orange' },
  signal_loss: { icon: 'satellite-dish', color: 'red' },
  route_deviation: { icon: 'route', color: 'purple' },
  speeding: { icon: 'gauge', color: 'orange' },
  theft: { icon: 'siren', color: 'red' },
  low_battery: { icon: 'battery-low', color: 'orange' },
  emergency: { icon: 'siren', color: 'red' },
  signal_restored: { icon: 'satellite', color: 'green' },
};

export const MODULE_LABELS: Record<string, string> = {
  dashboard: 'Inicio',
  map: 'Mapa en vivo',
  vehicles: 'Vehículos',
  drivers: 'Conductores',
  devices: 'Dispositivos GPS',
  geofences: 'Geocercas',
  alerts: 'Alertas',
  reports: 'Reportes',
  users: 'Usuarios y permisos',
  billing: 'Suscripción y facturación',
  support: 'Soporte',
  simulator: 'Simulador GPS',
};
