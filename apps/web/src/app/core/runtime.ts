/**
 * Indicadores de compilación. `WMS_DEMO` lo define el build de GitHub Pages (angular.json › configuración «pages»):
 * en ese build la API corre dentro del navegador (ver src/demo) porque Pages solo sirve archivos estáticos.
 */
declare const WMS_DEMO: boolean | undefined;

export const DEMO = typeof WMS_DEMO !== 'undefined' && !!WMS_DEMO;
