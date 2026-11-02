(function () {
  // Al entrar a una sección, las animaciones de entrada de lo que queda fuera de la pantalla terminan al instante.
  // nombres de las animaciones de entrada (las de los componentes llevan el prefijo de Angular)
  var entrada = /^(_ngcontent-[^_]+_)?(wms-in|wms-row-in|wms-mask|wms-fade|grow|faGrow|bar-in|wms-pop)$/;
  var afuera = function (t) {
    if (!t || !t.getBoundingClientRect) return false;
    var r = t.getBoundingClientRect();
    return r.top > innerHeight + 40 || r.bottom < -40;
  };
  var ultimo = -1e9;
  // solo en la versión completa (la liviana no tiene animaciones de entrada)
  var cl = document.documentElement.classList, puesto = false;
  var sync = function () {
    var c = cl.contains('v-completa');
    if (c !== puesto) { (c ? document.addEventListener : document.removeEventListener).call(document, 'animationstart', al, true); puesto = c; }
  };
  var al = function (e) {
    if (!entrada.test(e.animationName) && e.animationName !== 'wms-cam') return;
    var ahora = performance.now();
    // una pasada por todas las de entrada (también las que esperan su retardo), como mucho cada 400 ms
    if (ahora - ultimo > 400) {
      ultimo = ahora;
      document.getAnimations().forEach(function (a) {
        if (a.playState !== 'running' || !entrada.test(a.animationName || '')) return;
        var t = a.effect && a.effect.target;
        if (afuera(t)) a.finish();
      });
    } else if (entrada.test(e.animationName) && afuera(e.target)) {
      e.target.getAnimations().forEach(function (a) { if (a.animationName === e.animationName) a.finish(); });
    }
  };
  sync();
  document.addEventListener('wms-version', sync);
})();
