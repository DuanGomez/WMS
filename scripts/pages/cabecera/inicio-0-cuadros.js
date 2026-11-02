// Mientras la persona interactúa (y hasta 2 s después del último toque, tecla, rueda o scroll) se pide un cuadro en
// cada vsync: la página se mantiene despierta y los temporizadores cortos se cumplen a tiempo (por ejemplo, la
// pulsación larga de 220 ms del tablero). Con la app quieta no corre: no gasta batería en reposo.
(function () {
  var hasta = 0,
    activo = false;
  var cuadro = function () {
    if (performance.now() < hasta) requestAnimationFrame(cuadro);
    else activo = false;
  };
  var tocar = function () {
    hasta = performance.now() + 2000;
    if (!activo) {
      activo = true;
      requestAnimationFrame(cuadro);
    }
  };
  ['pointerdown', 'pointermove', 'keydown', 'wheel', 'scroll'].forEach(function (e) {
    addEventListener(e, tocar, { capture: true, passive: true });
  });
})();
