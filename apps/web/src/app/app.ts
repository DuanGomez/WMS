import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Theme } from './core/ui.services';
import { OverlaysComponent } from './ui/components';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, OverlaysComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<router-outlet /><app-overlays />`,
})
export class App {
  // Inicializa el tema (claro/oscuro automático o manual) desde el arranque.
  readonly theme = inject(Theme);
}
