import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Theme } from './core/ui.services';
import { OverlaysComponent } from './ui/components';
import { Lang } from './ui/lang';
import { BgComponent } from './ui/wms-fx';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, OverlaysComponent, BgComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-bg /><router-outlet /><app-overlays />`,
})
export class App {
  // Inicializa el tema (claro/oscuro automático o manual) desde el arranque.
  readonly theme = inject(Theme);
  // Inicializa el idioma de la interfaz (ES/EN, solo visual).
  readonly lang = inject(Lang);
}
