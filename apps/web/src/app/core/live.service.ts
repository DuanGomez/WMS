import { inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { Api } from './api.service';
import { Auth } from './auth.service';
import { ALERT_ICONS } from './format';
import { Alert, Geofence, LatLng, LivePosition, NotificationItem, Vehicle } from './models';
import { pref, Toasts } from './ui.services';

export interface LiveSnapshot {
  serverTime: string;
  trailMinutes: number;
  vehicles: Vehicle[];
  geofences: Geofence[];
  openAlerts: { items: Alert[]; total: number; open: number } | null;
}

/**
 * Tiempo real (RG2): Server-Sent Events desde tracking-stream con reconexión
 * y fallback automático a polling cada 2 s si SSE no está disponible.
 */
@Injectable({ providedIn: 'root' })
export class Live {
  private api = inject(Api);
  private auth = inject(Auth);
  private toasts = inject(Toasts);
  private router = inject(Router);

  readonly mode = signal<'connecting' | 'sse' | 'polling' | 'offline'>('offline');
  readonly openAlerts = signal(0);
  readonly recentAlerts = signal<Alert[]>([]);
  readonly lastEventAt = signal<Date | null>(null);
  readonly positions$ = new Subject<LivePosition>();
  readonly alerts$ = new Subject<Alert>();
  readonly devices$ = new Subject<{
    id: string;
    vehicleId: string | null;
    connection: 'online' | 'offline';
    lastSeenAt: string;
  }>();
  readonly notifications$ = new Subject<NotificationItem>();
  readonly sound = pref('sound', false);

  private es: EventSource | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  private since = new Date().toISOString();
  private started = false;
  private seenAlerts = new Set<string>();

  start() {
    if (this.started || !this.auth.isLoggedIn()) return;
    this.started = true;
    this.refreshOpenCount();
    if (this.auth.can('map')) this.connect();
  }

  stop() {
    this.started = false;
    this.es?.close();
    this.es = null;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.pollTimer = null;
    this.mode.set('offline');
    this.recentAlerts.set([]);
    this.openAlerts.set(0);
  }

  snapshot() {
    return this.api.get<LiveSnapshot>('tracking/live');
  }

  async refreshOpenCount() {
    if (!this.auth.can('alerts')) return;
    try {
      const r = await this.api.get<{ open: number; items: Alert[] }>('alerts', {
        attended: false,
        limit: 10,
      });
      this.openAlerts.set(r.open);
      this.recentAlerts.set(r.items);
    } catch {}
  }

  private connect() {
    if (!this.started) return;
    this.mode.set('connecting');
    const token = this.auth.accessToken();
    if (!token || typeof EventSource === 'undefined') return this.startPolling();
    const es = new EventSource(`/api/tracking/stream?access_token=${encodeURIComponent(token)}`);
    this.es = es;
    es.addEventListener('hello', () => {
      this.failures = 0;
      this.stopPolling();
      this.mode.set('sse');
    });
    es.addEventListener('position', (e) => this.onPosition(JSON.parse((e as MessageEvent).data)));
    es.addEventListener('alert', (e) => this.onAlert(JSON.parse((e as MessageEvent).data)));
    es.addEventListener('device', (e) => {
      this.lastEventAt.set(new Date());
      this.devices$.next(JSON.parse((e as MessageEvent).data));
    });
    es.addEventListener('notification', (e) =>
      this.notifications$.next(JSON.parse((e as MessageEvent).data)),
    );
    es.onerror = async () => {
      es.close();
      if (this.es !== es || !this.started) return;
      this.es = null;
      this.failures++;
      // El token pudo expirar: se renueva antes de reconectar.
      await this.auth.refresh();
      if (this.failures >= 3) this.startPolling();
      this.retryTimer = setTimeout(() => this.connect(), Math.min(15000, 1500 * this.failures));
    };
  }

  private startPolling() {
    if (this.pollTimer || !this.started) return;
    this.mode.set('polling');
    this.since = new Date(Date.now() - 3000).toISOString();
    this.pollTimer = setInterval(async () => {
      try {
        const r = await this.api.get<{
          serverTime: string;
          positions: LivePosition[];
          alerts: Alert[];
        }>('tracking/poll', { since: this.since });
        this.since = r.serverTime;
        r.positions.forEach((p) => this.onPosition(p));
        r.alerts.reverse().forEach((a) => this.onAlert(a));
      } catch {}
    }, 2000);
  }

  private stopPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  private onPosition(p: LivePosition) {
    this.lastEventAt.set(new Date());
    this.positions$.next(p);
  }

  private onAlert(a: Alert) {
    if (this.seenAlerts.has(a.id)) return;
    this.seenAlerts.add(a.id);
    this.lastEventAt.set(new Date());
    this.alerts$.next(a);
    if (!a.attended) {
      this.openAlerts.update((n) => n + 1);
      this.recentAlerts.update((l) => [a, ...l].slice(0, 20));
    }
    const meta = ALERT_ICONS[a.type] ?? { icon: 'bell', color: 'blue' };
    const critical = a.priority === 'critical' || a.priority === 'high';
    this.toasts.show(
      {
        title: a.title,
        text: a.description,
        icon: meta.icon,
        tone: meta.color as any,
        app: `WMS · ${a.typeLabel}`,
        action: () =>
          this.router.navigate(['/mapa'], { queryParams: a.vehicleId ? { v: a.vehicleId } : {} }),
      },
      critical ? 9000 : 5500,
    );
    if (this.sound.get() && !a.attended) chime(critical);
  }

  /** Utilidad para el mapa: estela inicial. */
  static trailOf(v: Vehicle): LatLng[] {
    return v.trail ?? [];
  }
}

/** Sonido corto tipo notificación (Web Audio, sin archivos). */
function chime(urgent: boolean) {
  try {
    const ctx = new AudioContext();
    const notes = urgent ? [880, 660, 880] : [784, 1046];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      const t = ctx.currentTime + i * 0.13;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.25);
    });
    setTimeout(() => ctx.close(), 1000);
  } catch {}
}
