import { HttpBackend, provideHttpClient, withInterceptors } from '@angular/common/http';
import { registerLocaleData } from '@angular/common';
import localeEsCo from '@angular/common/locales/es-CO';
import { ApplicationConfig, LOCALE_ID, provideBrowserGlobalErrorListeners } from '@angular/core';
import {
  provideRouter,
  withComponentInputBinding,
  withInMemoryScrolling,
  withViewTransitions,
} from '@angular/router';
import { routes } from './app.routes';
import { authInterceptor } from './core/auth.service';
import { DemoHttpBackend, demoApi } from './core/demo-backend';
import { DEMO } from './core/runtime';
import { isFlipping } from './ui/wms-fx';

// Demo de GitHub Pages: la API arranca dentro del navegador mientras carga la interfaz.
if (DEMO) demoApi().catch(() => {});

registerLocaleData(localeEsCo);

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'top' }),
      // Entre login y registro la transición es el giro de la tarjeta: el fundido encima mezclaba la tarjeta
      // vieja con la nueva a medio giro (parpadeo). En desarrollo Angular anota en consola el AbortError de omitirlo
      // («Transition was skipped»); en producción no.
      withViewTransitions({ onViewTransitionCreated: ({ transition }) => isFlipping() && transition.skipTransition() }),
    ),
    provideHttpClient(withInterceptors([authInterceptor])),
    ...(DEMO ? [{ provide: HttpBackend, useClass: DemoHttpBackend }] : []),
    { provide: LOCALE_ID, useValue: 'es-CO' },
  ],
};
