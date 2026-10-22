import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiError } from './models';

type Query = Record<string, string | number | boolean | null | undefined>;

/** Cliente HTTP tipado basado en promesas. Todas las rutas son relativas a /api (proxy en desarrollo). */
@Injectable({ providedIn: 'root' })
export class Api {
  private http = inject(HttpClient);

  private params(q?: Query) {
    let p = new HttpParams();
    for (const [k, v] of Object.entries(q ?? {}))
      if (v !== undefined && v !== null && v !== '') p = p.set(k, String(v));
    return p;
  }

  get<T>(path: string, query?: Query) {
    return firstValueFrom(this.http.get<T>(`/api/${path}`, { params: this.params(query) }));
  }
  post<T>(path: string, body: unknown = {}) {
    return firstValueFrom(this.http.post<T>(`/api/${path}`, body));
  }
  patch<T>(path: string, body: unknown) {
    return firstValueFrom(this.http.patch<T>(`/api/${path}`, body));
  }
  put<T>(path: string, body: unknown) {
    return firstValueFrom(this.http.put<T>(`/api/${path}`, body));
  }
  delete<T = void>(path: string, query?: Query) {
    return firstValueFrom(this.http.delete<T>(`/api/${path}`, { params: this.params(query) }));
  }

  /** Descarga un archivo autenticado y dispara el "Guardar como" del navegador. */
  async download(path: string, fallbackName: string) {
    const res = await firstValueFrom(
      this.http.get(`/api/${path}`, { responseType: 'blob', observe: 'response' }),
    );
    const cd = res.headers.get('content-disposition') ?? '';
    const name = /filename="([^"]+)"/.exec(cd)?.[1] ?? fallbackName;
    saveBlob(res.body!, name);
  }
}

export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Nombres en español de los campos que valida la API (los errores llegan con el nombre interno). */
const FIELD_LABELS: Record<string, string> = {
  accuracy: 'Precisión',
  address: 'Dirección',
  battery: 'Batería',
  body: 'Mensaje',
  brand: 'Marca',
  category: 'Categoría',
  city: 'Ciudad',
  color: 'Color',
  company: 'Empresa',
  coordinates: 'Área',
  currentPassword: 'Contraseña actual',
  description: 'Descripción',
  deviceId: 'Dispositivo',
  document: 'Documento',
  driverId: 'Conductor',
  email: 'Correo',
  expiresInHours: 'Vigencia',
  format: 'Formato',
  geofenceId: 'Geocerca',
  heading: 'Rumbo',
  lat: 'Latitud',
  licenseCategory: 'Categoría de licencia',
  licenseExpiresAt: 'Vencimiento de licencia',
  licenseNumber: 'Número de licencia',
  lng: 'Longitud',
  message: 'Mensaje',
  mode: 'Modo',
  model: 'Modelo',
  name: 'Nombre',
  nit: 'NIT',
  notes: 'Notas',
  owner: 'Propietario',
  password: 'Contraseña',
  periodEnd: 'Fin del periodo',
  periodStart: 'Inicio del periodo',
  phone: 'Teléfono',
  plate: 'Placa',
  priority: 'Prioridad',
  radiusM: 'Radio',
  reason: 'Motivo',
  recipients: 'Destinatarios',
  role: 'Rol',
  serial: 'Serial',
  shape: 'Forma',
  speed: 'Velocidad',
  status: 'Estado',
  subject: 'Asunto',
  threshold: 'Umbral',
  type: 'Tipo',
  userId: 'Usuario',
  vehicleId: 'Vehículo',
  vehicleIds: 'Vehículos',
  year: 'Año',
};
const fieldLabel = (path: string) => FIELD_LABELS[path.split('.')[0]] ?? path;

/** Extrae un mensaje legible en español de cualquier error HTTP. */
export function errorMessage(e: unknown): string {
  if (e instanceof HttpErrorResponse) {
    if (e.status === 0)
      return 'No hay conexión con el servidor. Verifica que la API esté corriendo.';
    const body = e.error as ApiError | null;
    if (body && typeof body === 'object' && 'message' in body) {
      const details = Array.isArray(body.details) ? body.details : [];
      if (body.code === 'VALIDATION_ERROR' && details.length) {
        return details.map((d: any) => `${d.path ? `${fieldLabel(d.path)}: ` : ''}${d.message}`).join(' · ');
      }
      return body.message;
    }
    return `Error ${e.status}`;
  }
  return e instanceof Error ? e.message : 'Error inesperado';
}
