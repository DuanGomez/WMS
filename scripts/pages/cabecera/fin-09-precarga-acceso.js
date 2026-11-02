// En el acceso, ya dibujado el formulario: se descarga (sin ejecutar) el código de las otras pantallas de acceso.
(function () {
  var a = __ACCESO__, h = false;
  var t = setInterval(function () {
    if (h) return clearInterval(t);
    if (document.querySelector('.wms-shell') || !document.querySelector('form')) return;
    h = true;
    clearInterval(t);
    setTimeout(function () {
      a.forEach(function (f) {
        var l = document.createElement('link');
        l.rel = 'prefetch';
        l.href = f;
        document.head.appendChild(l);
      });
    }, 1500);
  }, 500);
})();
