(function () {
  var cl = document.documentElement.classList;
  // Último toque o tecla: los trabajos en tiempo libre esperan a que la persona no esté tocando.
  globalThis.__lastTap = -1e9;
  var marca = function () { globalThis.__lastTap = performance.now(); };
  addEventListener('pointerdown', marca, { capture: true, passive: true });
  addEventListener('keydown', marca, { capture: true, passive: true });
  // Sin fondo animado donde no se ve (acceso y mapa lo tapan): .wms-nobg.
  var rutas = /\/(login|registro|recuperar|restablecer|mapa)(\/|$)/;
  var ruta = function () { cl.toggle('wms-nobg', rutas.test(location.pathname)); };
  ['pushState', 'replaceState'].forEach(function (k) { var o = history[k]; history[k] = function () { var r = o.apply(this, arguments); ruta(); return r; }; });
  addEventListener('popstate', ruta);
  ruta();
  // Brillos del acceso a 2 Hz (mismo recorrido, salto imperceptible) y quietos mientras la persona interactúa.
  setInterval(function () {
    if (document.hidden || performance.now() - globalThis.__lastTap < 1000 || !document.querySelector('.a-glow-a')) return;
    document.getAnimations().forEach(function (a) {
      var t = a.effect && a.effect.target;
      if (t && t.classList && (t.classList.contains('a-glow-a') || t.classList.contains('a-glow-b'))) {
        if (a.playState !== 'paused') a.pause();
        a.currentTime = (a.currentTime || 0) + 500;
      }
    });
  }, 500);
})();
