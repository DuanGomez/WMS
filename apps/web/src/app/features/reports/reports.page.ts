import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorMessage } from '../../core/api.service';
import { Auth } from '../../core/auth.service';
import { DtPipe, fmt, NumPipe } from '../../core/format';
import { Driver, Report, User, Vehicle } from '../../core/models';
import { Confirm, Toasts } from '../../core/ui.services';
import {
  EmptyComponent,
  SegmentedComponent,
  SheetComponent,
  SkeletonListComponent,
} from '../../ui/components';
import { IconComponent } from '../../ui/icon.component';
import { FleetActivityComponent } from './fleet-activity.component';
import { DetailComponent, DetailRow } from '../../ui/detail.component';
import { PlaybackComponent } from '../map/playback.component';

interface Share {
  id: string;
  token: string;
  path: string;
  sharedWith: string | null;
  expiresAt: string;
  createdAt: string;
  revoked: boolean;
  expired: boolean;
}
interface SharedWithMe {
  token: string;
  name: string;
  format: string;
  typeLabel: string;
  message: string;
  sharedBy: string;
  expiresAt: string;
}

/** RG5 / RE6 / RF19-RF22 / RF33 – Reportes PDF y Excel: generar, consultar, regenerar, eliminar y compartir. */
@Component({
  selector: 'app-reports',
  imports: [
    FormsModule,
    IconComponent,
    SheetComponent,
    EmptyComponent,
    SkeletonListComponent,
    SegmentedComponent,
    PlaybackComponent,
    DtPipe,
    NumPipe, FleetActivityComponent, DetailComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './reports.page.html',
  styleUrl: './reports.page.scss',
})
export class ReportsPage implements OnInit {
  // --- Solo presentación (rediseño): panel Detalle al hacer clic en una fila ---
  readonly detail = signal<Report | null>(null);
  reportRows(r: Report): DetailRow[] {
    return [
      { k: 'Contenido', v: r.typeLabel },
      { k: 'Periodo', v: `${fmt.date(r.periodStart)} – ${fmt.date(r.periodEnd)}` },
      { k: 'Vehículo', v: r.vehiclePlate ?? 'Todos los vehículos' },
      ...(r.driverName ? [{ k: 'Conductor', v: r.driverName }] : []),
      { k: 'Resumen', v: `${fmt.num(r.summary.km ?? 0)} km · ${r.summary.trips ?? 0} recorridos` },
      { k: 'Alertas', v: `${r.summary.alerts ?? 0} · ${fmt.num(r.summary.movingHours ?? 0)} h en marcha` },
      { k: 'Generado', v: fmt.dateTime(r.generatedAt) + (r.createdBy ? ' · ' + r.createdBy : '') },
      { k: 'Tamaño', v: this.bytes(r.sizeBytes) },
      { k: 'Enlaces activos', v: String(r.activeShares ?? 0) },
    ];
  }

  private api = inject(Api);
  readonly auth = inject(Auth);
  private toasts = inject(Toasts);
  private confirm = inject(Confirm);

  readonly reports = signal<Report[]>([]);
  readonly sharedWithMe = signal<SharedWithMe[]>([]);
  readonly vehicles = signal<Vehicle[]>([]);
  readonly drivers = signal<Driver[]>([]);
  readonly users = signal<User[]>([]);
  readonly loading = signal(true);
  readonly canWrite = computed(() => this.auth.can('reports', 'write'));
  readonly bytes = fmt.bytes;

  // Generar / regenerar
  readonly sheetOpen = signal(false);
  readonly regenerating = signal<Report | null>(null);
  readonly busy = signal(false);
  readonly formError = signal('');
  readonly period = signal('7d');
  form = this.emptyForm();
  readonly typeOptions = [
    { value: 'full', label: 'Completo' },
    { value: 'trips', label: 'Recorridos' },
    { value: 'alerts', label: 'Alertas' },
    { value: 'usage', label: 'Uso' },
  ];
  readonly formatOptions = [
    { value: 'pdf', label: 'PDF' },
    { value: 'xlsx', label: 'Excel' },
  ];
  readonly periodOptions = [
    { value: 'today', label: 'Hoy' },
    { value: '7d', label: '7 días' },
    { value: '30d', label: '30 días' },
    { value: 'custom', label: 'Personalizado' },
  ];

  // Compartir
  readonly shareOpen = signal(false);
  readonly sharing = signal<Report | null>(null);
  readonly shares = signal<Share[]>([]);
  readonly lastLink = signal('');
  shareForm = { mode: 'link', userId: '', expiresInHours: 72, message: '' };

  // Playback
  readonly playOpen = signal(false);
  readonly playVehicle = signal<{ id: string; plate: string } | null>(null);

  private emptyForm() {
    const end = new Date();
    const start = new Date(end.getTime() - 7 * 86400_000);
    return {
      name: 'Informe de la flota',
      type: 'full',
      format: 'pdf',
      vehicleId: null as string | null,
      driverId: null as string | null,
      from: fmt.toLocalInput(start),
      to: fmt.toLocalInput(end),
    };
  }

  async ngOnInit() {
    await this.load();
    const [v, d, u] = await Promise.all([
      this.auth.can('vehicles')
        ? this.api.get<Vehicle[]>('vehicles', { includeRetired: true })
        : Promise.resolve([]),
      this.auth.can('drivers') ? this.api.get<Driver[]>('drivers') : Promise.resolve([]),
      this.auth.can('users') ? this.api.get<User[]>('users') : Promise.resolve([]),
    ]).catch(() => [[], [], []] as [Vehicle[], Driver[], User[]]);
    this.vehicles.set(v);
    this.drivers.set(d);
    this.users.set(u.filter((x) => x.id !== this.auth.user()?.id && x.active));
  }

  async load() {
    this.loading.set(true);
    try {
      const [r, s] = await Promise.all([
        this.api.get<Report[]>('reports'),
        this.api.get<SharedWithMe[]>('reports-shared'),
      ]);
      this.reports.set(r);
      this.sharedWithMe.set(s);
    } catch (e) {
      this.toasts.error('No se pudieron cargar los reportes', errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  setPeriod(p: string) {
    this.period.set(p);
    const end = new Date();
    if (p === 'today') {
      const start = new Date(
        new Date(end.getTime() - 5 * 3600_000).toISOString().slice(0, 10) + 'T00:00:00-05:00',
      );
      this.form.from = fmt.toLocalInput(start);
    } else if (p === '7d')
      this.form.from = fmt.toLocalInput(new Date(end.getTime() - 7 * 86400_000));
    else if (p === '30d')
      this.form.from = fmt.toLocalInput(new Date(end.getTime() - 30 * 86400_000));
    if (p !== 'custom') this.form.to = fmt.toLocalInput(end);
  }

  openCreate() {
    this.regenerating.set(null);
    this.form = this.emptyForm();
    this.period.set('7d');
    this.formError.set('');
    this.sheetOpen.set(true);
  }

  /** RF21 – Regenerar con nuevos parámetros (prellenado). */
  openRegenerate(r: Report) {
    this.regenerating.set(r);
    this.form = {
      name: r.name,
      type: r.type,
      format: r.format,
      vehicleId: r.vehicleId,
      driverId: r.driverId,
      from: fmt.toLocalInput(new Date(r.periodStart)),
      to: fmt.toLocalInput(new Date()),
    };
    this.period.set('custom');
    this.formError.set('');
    this.sheetOpen.set(true);
  }

  async generate() {
    this.busy.set(true);
    this.formError.set('');
    const body = {
      name: this.form.name,
      type: this.form.type,
      format: this.form.format,
      vehicleId: this.form.vehicleId || null,
      driverId: this.form.driverId || null,
      periodStart: fmt.fromLocalInput(this.form.from),
      periodEnd: fmt.fromLocalInput(this.form.to),
    };
    try {
      const r = this.regenerating();
      const out = r
        ? await this.api.post<Report>(`reports/${r.id}/regenerate`, body)
        : await this.api.post<Report>('reports', body);
      this.sheetOpen.set(false);
      this.toasts.show(
        {
          title: r ? `Reporte regenerado (v${out.version})` : 'Reporte generado',
          text: `${out.summary.trips ?? 0} recorridos · ${fmt.km(out.summary.km ?? 0)} · ${out.summary.alerts ?? 0} alertas`,
          icon: 'file-text',
          tone: 'green',
          action: () => this.download(out),
        },
        6000,
      );
      await this.load();
    } catch (e) {
      this.formError.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  async download(r: Report) {
    try {
      await this.api.download(`reports/${r.id}/download`, `${r.name}.${r.format}`);
    } catch (e) {
      this.toasts.error('No se pudo descargar', errorMessage(e));
    }
  }

  async remove(r: Report) {
    const ok = await this.confirm.ask({
      title: `¿Eliminar «${r.name}»?`,
      message: 'El archivo se borrará y sus enlaces compartidos dejarán de funcionar.',
      confirmText: 'Eliminar',
      destructive: true,
    });
    if (!ok) return;
    try {
      await this.api.delete(`reports/${r.id}`);
      this.toasts.success('Reporte eliminado');
      await this.load();
    } catch (e) {
      this.toasts.error('No se pudo eliminar', errorMessage(e));
    }
  }

  /* RF33 – Compartir */
  async openShare(r: Report) {
    this.sharing.set(r);
    this.shareForm = {
      mode: 'link',
      userId: this.users()[0]?.id ?? '',
      expiresInHours: 72,
      message: '',
    };
    this.lastLink.set('');
    this.shareOpen.set(true);
    await this.loadShares();
  }

  async loadShares() {
    const r = this.sharing();
    if (r) this.shares.set(await this.api.get<Share[]>(`reports/${r.id}/shares`));
  }

  linkOf(path: string) {
    // Relativo a <base href>: funciona en la raíz del dominio y en GitHub Pages (/WMS/).
    return new URL(path.replace(/^\//, ''), document.baseURI).href;
  }

  async share() {
    const r = this.sharing();
    if (!r) return;
    this.busy.set(true);
    try {
      const out = await this.api.post<{ path: string; sharedWith: { name: string } | null }>(
        `reports/${r.id}/share`,
        {
          mode: this.shareForm.mode,
          userId: this.shareForm.mode === 'user' ? this.shareForm.userId : undefined,
          expiresInHours: Number(this.shareForm.expiresInHours),
          message: this.shareForm.message || undefined,
        },
      );
      this.lastLink.set(this.linkOf(out.path));
      if (out.sharedWith)
        this.toasts.success(
          'Reporte enviado',
          `${out.sharedWith.name} lo verá en «Compartidos conmigo» y recibió un correo (simulado).`,
        );
      else await this.copy(this.lastLink());
      await this.loadShares();
      await this.load();
    } catch (e) {
      this.toasts.error('No se pudo compartir', errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  async revoke(s: Share) {
    await this.api.delete(`report-shares/${s.id}`);
    this.toasts.success('Enlace revocado');
    await this.loadShares();
    await this.load();
  }

  async copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      this.toasts.success('Enlace copiado', 'Pégalo en WhatsApp o correo.');
    } catch {
      this.toasts.info('Copia el enlace manualmente');
    }
  }

  openPlayback(r: Report) {
    const v = this.vehicles().find((x) => x.id === r.vehicleId);
    if (!v) return;
    this.playVehicle.set({ id: v.id, plate: v.plate });
    this.playOpen.set(true);
  }
}
