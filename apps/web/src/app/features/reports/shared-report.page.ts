import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, input, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Api, errorMessage, saveBlob } from '../../core/api.service';
import { DtPipe, NumPipe } from '../../core/format';
import { IconComponent } from '../../ui/icon.component';
import { LogoComponent } from '../../ui/logo.component';

interface Shared {
  name: string;
  typeLabel: string;
  format: 'pdf' | 'xlsx';
  company: string;
  message: string;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  expiresAt: string;
  summary: { km?: number; trips?: number; alerts?: number; movingHours?: number };
}

/** RF33 – Vista pública de un reporte compartido por enlace con token (no requiere sesión). */
@Component({
  selector: 'app-shared-report',
  imports: [RouterLink, IconComponent, LogoComponent, DtPipe, NumPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../auth/auth.scss',
  template: `
    <section class="auth-card glass-thick" style="width:min(520px,100%)">
      <app-logo class="auth-logo" [size]="40" />
      @if (data(); as d) {
        <p class="auth-sub" style="margin:0 0 4px">{{ d.company }} compartió contigo</p>
        <h1 class="auth-title">{{ d.name }}</h1>
        <p class="auth-sub">
          {{ d.typeLabel }} · {{ d.periodStart | dt: 'date' }} – {{ d.periodEnd | dt: 'date' }}
        </p>
        @if (d.message) {
          <blockquote class="card" style="margin:0 0 16px;font-style:italic">
            «{{ d.message }}»
          </blockquote>
        }
        <div class="grid grid-2" style="margin-bottom:16px">
          <div class="card kpi">
            <div class="kpi-head">Kilómetros</div>
            <div class="kpi-value">{{ d.summary.km ?? 0 | num }}</div>
          </div>
          <div class="card kpi">
            <div class="kpi-head">Recorridos</div>
            <div class="kpi-value">{{ d.summary.trips ?? 0 }}</div>
          </div>
          <div class="card kpi">
            <div class="kpi-head">Alertas</div>
            <div class="kpi-value">{{ d.summary.alerts ?? 0 }}</div>
          </div>
          <div class="card kpi">
            <div class="kpi-head">Horas en marcha</div>
            <div class="kpi-value">{{ d.summary.movingHours ?? 0 | num }}</div>
          </div>
        </div>
        <button class="btn primary lg block" type="button" (click)="download()" [disabled]="busy()">
          <app-icon name="download" [size]="18" />Descargar
          {{ d.format === 'pdf' ? 'PDF' : 'Excel' }}
        </button>
        <p class="foot">
          Enlace válido hasta {{ d.expiresAt | dt }} · Generado {{ d.generatedAt | dt }}
        </p>
      } @else if (error()) {
        <h1 class="auth-title">Enlace no disponible</h1>
        <p class="auth-sub">{{ error() }}</p>
        <a class="btn block" routerLink="/login">Ir a WMS</a>
      } @else {
        <div class="skeleton" style="height:28px;width:70%;margin:0 auto 12px"></div>
        <div class="skeleton" style="height:120px"></div>
      }
    </section>
  `,
})
export class SharedReportPage implements OnInit {
  private api = inject(Api);
  private http = inject(HttpClient);
  readonly token = input.required<string>();
  readonly data = signal<Shared | null>(null);
  readonly error = signal('');
  readonly busy = signal(false);

  async ngOnInit() {
    try {
      this.data.set(await this.api.get<Shared>(`public/reports/${this.token()}`));
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  async download() {
    const d = this.data();
    if (!d) return;
    this.busy.set(true);
    try {
      const blob = await firstValueFrom(
        this.http.get(`/api/public/reports/${this.token()}/download`, { responseType: 'blob' }),
      );
      saveBlob(blob, `${d.name}.${d.format}`);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
