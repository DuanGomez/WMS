import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Logotipo WMS: wordmark W·M·S a la misma altura; la M lleva integrado un pin de ubicación.
 * Usa currentColor. [size] = alto en px de las letras (por defecto 40).
 * [compact] = monograma "W" en cuadro de 30×30 para la navbar.
 */
@Component({
  selector: 'app-logo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display:block;line-height:0', role: 'img', 'aria-label': 'WMS' },
  styles: `
    .mark { display:inline-flex; align-items:baseline; justify-content:center; line-height:1; font-weight:800; letter-spacing:5px; margin-right:-5px; white-space:nowrap; padding-top:8px; color:currentColor; }
    .w { display:inline-block; height:.72em; width:auto; margin-right:5px; vertical-align:baseline; }
    .m { display:inline-block; height:1em; width:auto; margin-right:5px; vertical-align:-.02em; overflow:visible; }
    .mono { font-family:inherit; position:relative; width:30px; height:30px; border-radius:9px; border:1px solid var(--wms-logo-border); display:flex; align-items:center; justify-content:center; overflow:hidden; font-size:14px; font-weight:700; line-height:1; }
    .mono::after { content:''; position:absolute; inset:0; background:linear-gradient(to bottom right, var(--wms-sheen), transparent); pointer-events:none; }
  `,
  template: `
    @if (compact()) {
      <span class="mono" aria-hidden="true">W</span>
    } @else {
      <span class="mark" aria-hidden="true" [style.font-size.px]="size()"
        ><svg class="w" viewBox="0 0 48 32">
          <polyline
            points="2,-3 13,30 24,7 35,30 46,-3"
            fill="none"
            stroke="currentColor"
            stroke-width="6.4"
            stroke-linejoin="miter"
            stroke-miterlimit="10"
          ></polyline></svg
        ><svg class="m" viewBox="0 0 44 40">
          <defs>
            <mask [attr.id]="maskId" maskUnits="userSpaceOnUse" x="-5" y="-5" width="54" height="50">
              <rect x="-5" y="-5" width="54" height="50" fill="#fff"></rect>
              <path
                d="M22 33C22 33 13.5 21 13.5 10.5a8.5 8.5 0 0 1 17 0C30.5 21 22 33 22 33Z"
                fill="#000"
                stroke="#000"
                stroke-width="5"
                stroke-linejoin="round"
              ></path>
              <ellipse cx="22" cy="35.5" rx="7.5" ry="3.2" fill="#000"></ellipse>
            </mask>
          </defs>
          <g fill="currentColor" [attr.mask]="'url(#' + maskId + ')'">
            <path d="M0 40V19C0 15 3 12 7 12H10.5L22 25.5V31L10 18.5V40Z"></path>
            <path d="M44 40V19C44 15 41 12 37 12H33.5L22 25.5V31L34 18.5V40Z"></path>
          </g>
          <path
            fill="currentColor"
            fill-rule="evenodd"
            d="M22 33C22 33 13.5 21 13.5 10.5a8.5 8.5 0 0 1 17 0C30.5 21 22 33 22 33ZM22 7a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7Z"
          ></path>
          <ellipse
            cx="22"
            cy="35.5"
            rx="5.5"
            ry="1.9"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
          ></ellipse></svg
        >S</span
      >
    }
  `,
})
export class LogoComponent {
  readonly size = input(40);
  readonly compact = input(false);
  readonly maskId = 'wmsPinGap' + Math.random().toString(36).slice(2, 8);
}
