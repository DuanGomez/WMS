import { ChangeDetectionStrategy, Component } from '@angular/core';
import { demoBoot } from '../core/demo-backend';
import { LogoComponent } from './logo.component';

/** Pantalla de carga del demo de GitHub Pages mientras la API arranca dentro del navegador. */
@Component({
  selector: 'app-demo-boot',
  imports: [LogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!boot().ready) {
      <div class="boot" role="status" aria-live="polite">
        <app-logo [size]="48" />
        @if (boot().error) {
          <p class="t">No se pudo iniciar la demo</p>
          <p class="s">{{ boot().error }}</p>
          <button class="btn primary" type="button" (click)="reload()">Reintentar</button>
        } @else {
          <span class="spin" aria-hidden="true"></span>
          <p class="t">{{ boot().step }}</p>
          <p class="s">Versión demo: la plataforma corre completa en tu navegador.</p>
        }
      </div>
    }
  `,
  styles: `
    .boot {
      position: fixed;
      inset: 0;
      z-index: 9000;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      padding: 24px;
      text-align: center;
      background: var(--wms-page, var(--bg, #f2f2f7));
      color: var(--wms-text, var(--label, #000));
    }
    .t { margin: 6px 0 0; font-size: 15px; font-weight: 600; }
    .s { margin: 0; font-size: 12px; color: var(--wms-muted, var(--label-2, #6e6e73)); max-width: 320px; }
    .spin {
      width: 22px;
      height: 22px;
      border-radius: 50%;
      border: 2.5px solid currentColor;
      border-right-color: transparent;
      animation: spin 0.8s linear infinite;
      opacity: 0.7;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  `,
})
export class DemoBootComponent {
  readonly boot = demoBoot;
  reload() {
    location.reload();
  }
}
