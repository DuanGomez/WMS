import { Directive, ElementRef, inject } from '@angular/core';

/**
 * Hace usable con teclado un elemento que reacciona a (click) pero no es un botón (filas de listas
 * que llevan controles adentro y por eso no pueden ser role="button"): recibe foco con Tab y
 * Enter / Espacio ejecutan el mismo (click). Las teclas que vienen de un control interno se ignoran.
 */
@Directive({
  selector: '[wmsKeyClick]',
  host: {
    tabindex: '0',
    '(keydown.enter)': 'activate($event)',
    '(keydown.space)': 'activate($event)',
  },
})
export class KeyClickDirective {
  private el = inject<ElementRef<HTMLElement>>(ElementRef);

  activate(e: Event) {
    if (e.target !== this.el.nativeElement) return;
    e.preventDefault();
    this.el.nativeElement.click();
  }
}
