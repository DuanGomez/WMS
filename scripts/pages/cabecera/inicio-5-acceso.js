(function () {
  var cl = document.documentElement.classList;
  // .wms-auth-nav mientras se pasa de una pantalla de acceso a otra (sin entrada repetida).
  var acceso = /\/(login|registro|recuperar|restablecer)(\/|$)/, antes = location.pathname;
  var ruta = function () {
    var ahora = location.pathname;
    if (acceso.test(ahora) && acceso.test(antes) && ahora !== antes) cl.add('wms-auth-nav');
    else if (!acceso.test(ahora)) cl.remove('wms-auth-nav');
    antes = ahora;
  };
  ['pushState', 'replaceState'].forEach(function (k) { var o = history[k]; history[k] = function () { var r = o.apply(this, arguments); ruta(); return r; }; });
  addEventListener('popstate', ruta);
  if (window.ResizeObserver) {
    // el desenfoque cubre lo que el panel deja a la vista: arriba hasta su borde (+ las esquinas redondeadas), las bandas
    // de los lados y la de abajo (+ sus esquinas). Las bandas de los lados son dos <i> dentro del fondo; la de abajo, su ::after.
    var franja = function (s) {
      var b = s.previousElementSibling;
      if (!b || !b.classList.contains('backdrop')) return;
      var t = s.offsetTop, l = s.offsetLeft, r = b.clientWidth - l - s.offsetWidth, a = b.clientHeight - t - s.offsetHeight;
      b.style.setProperty('--wms-franja', (t + 28) + 'px');
      b.style.setProperty('--wms-izq', Math.max(0, l) + 'px');
      b.style.setProperty('--wms-der', Math.max(0, r) + 'px');
      b.style.setProperty('--wms-abajo', Math.max(0, a) + 'px');
      if (!b.querySelector(':scope > .wms-banda')) {
        ['wms-bi', 'wms-bd'].forEach(function (c) { var i = document.createElement('i'); i.className = 'wms-banda ' + c; i.setAttribute('aria-hidden', 'true'); b.appendChild(i); });
      }
    };
    var ro = new ResizeObserver(function (es) { es.forEach(function (e) { if (e.target.isConnected) franja(e.target); else ro.unobserve(e.target); }); });
    document.addEventListener('animationstart', function (e) {
      var s = e.target;
      if (!s.classList || !s.classList.contains('sheet')) return;
      if (s.classList.contains('wms-leave-sheet')) { ro.unobserve(s); return; }
      franja(s); ro.observe(s);
    }, true);
  }
  // En el acceso, en tiempo libre: el código de las otras pantallas de acceso queda listo (sin toques recientes).
  var archivos = __ACCESO__, i = 0;
  var libre = function (f) { (window.requestIdleCallback || function (g) { setTimeout(g, 50); })(f, { timeout: 5000 }); };
  function siguiente() {
    if (i >= archivos.length || !acceso.test(location.pathname)) return;
    if (performance.now() - (globalThis.__lastTap || -1e9) < 1500) { setTimeout(function () { libre(siguiente); }, 1000); return; }
    import('./' + archivos[i++]).catch(function () {});
    setTimeout(function () { libre(siguiente); }, 700);
  }
  setTimeout(function () { libre(siguiente); }, 2500);
})();
