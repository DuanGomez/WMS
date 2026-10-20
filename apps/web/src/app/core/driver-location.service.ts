import { inject, Injectable, signal } from '@angular/core';
import { Api, errorMessage } from './api.service';
import { Auth } from './auth.service';
import { pref } from './ui.services';

export type ShareStatus = 'idle' | 'requesting' | 'active' | 'paused' | 'denied' | 'unavailable' | 'insecure' | 'error';

/**
 * Ubicación del conductor desde su celular (o el dispositivo donde inició sesión), sin GPS dedicado:
 * usa la Geolocation API del navegador y la envía a la plataforma para que el administrador la vea en el mapa.
 * Requiere HTTPS (o localhost) y el permiso de ubicación del navegador.
 */
@Injectable({ providedIn: 'root' })
export class DriverLocation {
  private api = inject(Api);
  private auth = inject(Auth);

  readonly enabled = pref('shareLocation', true);
  readonly status = signal<ShareStatus>('idle');
  readonly last = signal<{ lat: number; lng: number; accuracy: number; ts: string } | null>(null);
  readonly error = signal('');

  private watchId: number | null = null;
  private lastSent = 0;
  private lastSentAt: [number, number] | null = null;
  private sending = false;

  /** Se llama al entrar a la plataforma: si el usuario es conductor, empieza a compartir. */
  start() {
    if (this.auth.user()?.role !== 'driver') return;
    if (!this.enabled.get()) return this.status.set('paused');
    if (this.watchId !== null) return;
    if (!('geolocation' in navigator)) return this.status.set('unavailable');
    if (!window.isSecureContext) return this.status.set('insecure');
    this.status.set('requesting');
    this.watchId = navigator.geolocation.watchPosition(
      (p) => this.onPosition(p),
      (e) => this.onError(e),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 },
    );
  }

  stop() {
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
    if (this.status() === 'active' || this.status() === 'requesting') this.status.set('idle');
  }

  async setEnabled(on: boolean) {
    this.enabled.set(on);
    if (on) {
      this.start();
    } else {
      this.stop();
      this.status.set('paused');
      await this.api.delete('me/location').catch(() => {});
    }
  }

  private async onPosition(p: GeolocationPosition) {
    this.status.set('active');
    this.error.set('');
    const { latitude: lat, longitude: lng, accuracy, speed, heading } = p.coords;
    this.last.set({ lat, lng, accuracy: Math.round(accuracy), ts: new Date(p.timestamp).toISOString() });
    const moved = this.lastSentAt ? distanceM(this.lastSentAt, [lat, lng]) : Infinity;
    if (this.sending || (Date.now() - this.lastSent < 5000 && moved < 20)) return;
    this.sending = true;
    try {
      await this.api.post('me/location', {
        lat,
        lng,
        accuracy,
        speed: speed != null && !Number.isNaN(speed) ? speed : null,
        heading: heading != null && !Number.isNaN(heading) ? heading : null,
        timestamp: new Date(p.timestamp).toISOString(),
      });
      this.lastSent = Date.now();
      this.lastSentAt = [lat, lng];
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.sending = false;
    }
  }

  private onError(e: GeolocationPositionError) {
    if (e.code === e.PERMISSION_DENIED) {
      this.stop();
      this.status.set('denied');
    } else {
      // Sin señal momentánea o tiempo agotado: el watch sigue activo y reintenta solo.
      this.status.set('error');
      this.error.set(e.code === e.TIMEOUT ? 'El celular tarda en obtener la ubicación.' : 'No se pudo obtener la ubicación.');
    }
  }
}

function distanceM(a: [number, number], b: [number, number]): number {
  const r = Math.PI / 180;
  const x = (b[1] - a[1]) * r * Math.cos(((a[0] + b[0]) / 2) * r);
  const y = (b[0] - a[0]) * r;
  return Math.sqrt(x * x + y * y) * 6371008.8;
}
