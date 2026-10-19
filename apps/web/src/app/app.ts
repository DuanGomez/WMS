import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Theme } from './core/ui.services';
import { OverlaysComponent } from './ui/components';
import { Lang } from './ui/lang';
import { BgComponent } from './ui/wms-fx';
import { DemoBootComponent } from './ui/demo-boot.component';
import { DEMO } from './core/runtime';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, OverlaysComponent, BgComponent, DemoBootComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-bg /><router-outlet /><app-overlays />@if (demo) {<app-demo-boot />}`,
})
export class App {
  // Inicializa el tema (claro/oscuro automático o manual) desde el arranque.
  readonly theme = inject(Theme);
  // Inicializa el idioma de la interfaz (ES/EN, solo visual).
  readonly lang = inject(Lang);
  readonly demo = DEMO;
}
