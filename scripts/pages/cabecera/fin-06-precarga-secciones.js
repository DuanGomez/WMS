(function () {
  // Después de iniciar sesión deja listo el código de las demás secciones, de a uno: empieza 5 s después y en tiempo
  // libre; cada archivo se descarga y se compila sin ejecutarse (modulepreload), cortando si hubo toques o scroll.
  var archivos = __SECCIONES__, hecho = false, y;
  setInterval(function () {
    if (hecho || /\/(login|registro|recuperar|restablecer)$/.test(location.pathname)) return;
    hecho = true;
    var i = 0;
    var libre = function (f) { (window.requestIdleCallback || function (g) { setTimeout(g, 50); })(f, { timeout: 4000 }); };
    function siguiente() {
      if (i >= archivos.length) return;
      if (performance.now() - (globalThis.__lastTap || -1e9) < 1000 || window.scrollY !== y) { y = window.scrollY; setTimeout(function () { libre(siguiente); }, 800); return; }
      var f = archivos[i++];
      var mp = document.createElement('link'); mp.rel = 'modulepreload'; mp.href = f; document.head.appendChild(mp);
      setTimeout(function () { libre(siguiente); }, 800);
    }
    setTimeout(function () { libre(siguiente); }, 5000);
  }, 4000);
})();
