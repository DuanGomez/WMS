(function () {
  // Después de entrar a la app y en tiempo libre, deja listas las letras que usan las secciones. Lo caro la
  // primera vez no es cada texto sino cada combinación nueva de familia, tamaño, peso, cifras y espaciado (≈13 ms con
  // CPU 6x; después, 60 textos nuevos con esa letra cuestan 3–4 ms). Por eso se preparan las combinaciones exactas que
  // usa la app (lista sacada de todas las secciones, en móvil y en PC), de a 2 por tarea libre, en un elemento oculto
  // que se quita enseguida. Así la primera entrada a cada sección no paga ese costo. No se ve nada.
  var acceso = /\/(login|registro|recuperar|restablecer)(\/|$)/, hecho = false;
  var libre = function (f) { (window.requestIdleCallback || function (g) { return setTimeout(g, 200); })(f, { timeout: 3000 }); };
  var texto = 'ABCDEFGHIJKLMNÑOPQRSTUVWXYZ abcdefghijklmnñopqrstuvwxyz ÁÉÍÓÚÜ áéíóúü 0123456789 .,:;·•—–-+±%/()¿?¡!@#°$ km/h';
  // [familia ('ui' | 'mono' | lista literal), tamaño px, peso, cifras tabulares, espaciado px]
  var combos = [
    ['ui', 12, 400, 0, -0.07],
    ['ui', 11, 400, 0, -0.07],
    ['ui', 13, 500, 0, -0.07],
    ['ui', 12, 600, 0, -0.07],
    ['ui', 14, 500, 0, -0.07],
    ['ui', 13, 400, 0, -0.07],
    ['ui', 13, 600, 0, -0.07],
    ['ui', 12, 500, 0, -0.07],
    ['ui', 11, 600, 0, -0.07],
    ['ui', 14, 400, 0, -0.07],
    ['ui', 11, 600, 0, 0.44],
    ['ui', 14, 700, 0, -0.07],
    ['ui', 13, 600, 1, -0.07],
    ['ui', 11, 400, 1, -0.07],
    ['ui', 10, 600, 0, 1.2],
    ['ui', 15, 600, 0, -0.07],
    ['ui', 12, 600, 1, -0.07],
    ['ui', 10, 600, 0, -0.07],
    ['ui', 12, 400, 1, -0.07],
    ['ui', 13, 400, 1, -0.07],
    ['ui', 11, 600, 0, 0.66],
    ['ui-monospace, Menlo, Consolas, monospace', 11, 600, 0, -0.07],
    ['ui', 13, 500, 1, -0.07],
    ['ui', 11, 600, 0, 1.32],
    ['ui', 16, 600, 0, -0.16],
    ['ui', 10, 700, 1, -0.07],
    ['ui', 10, 400, 1, -0.07],
    ['ui', 30, 600, 0, -0.75],
    ['ui', 13, 700, 1, -0.07],
    ['ui', 15, 600, 1, -0.15],
    ['ui', 15, 600, 0, -0.15],
    ['ui', 14, 600, 0, -0.07],
    ['mono', 11.96, 700, 0, -0.07],
    ['mono', 11.96, 600, 1, -0.07],
    ['ui', 15, 500, 1, 0],
    ['ui', 32, 600, 1, -0.96],
    ['ui', 24, 600, 1, -0.72],
    ['mono', 11.96, 500, 1, -0.07],
    ['ui', 10, 600, 1, -0.07],
    ['ui', 10, 400, 0, -0.07],
    ['ui', 10, 700, 0, 0.4],
    ['ui', 34, 600, 1, -1.19],
    ['ui', 11, 600, 1, -0.07],
    ['ui', 11, 900, 1, -0.07],
    ['ui', 26, 600, 1, -0.78],
    ['Lucida Console, Monaco, monospace', 22, 700, 0, -0.07],
    ['ui', 20, 600, 0, -0.4],
    ['ui', 40, 800, 0, 5],
    ['ui', 20, 700, 0, -0.2],
    ['mono', 12, 600, 0, -0.07],
    ['ui', 13, 600, 0, -0.26],
    ['ui', 22, 600, 0, -0.44],
    ['ui', 30, 600, 1, -0.9],
    ['ui', 10, 700, 0, -0.07],
  ];
  // dentro de la app (no en las pantallas de acceso): se revisa al arrancar, no al programar, porque la carga de /WMS/
  // todavía no es /login cuando ocurre DOMContentLoaded (Lighthouse veía este trabajo en la pantalla de acceso)
  var enApp = function () { return !acceso.test(location.pathname) && !!document.querySelector('app-shell'); };
  var calentar = function () {
    if (hecho || acceso.test(location.pathname)) return;
    hecho = true;
    var i = 0;
    var paso = function () {
      if (i >= combos.length || !document.body) return;
      var d = document.createElement('div');
      d.setAttribute('aria-hidden', 'true');
      d.style.cssText = 'position:fixed;left:-10000px;top:0;width:700px;height:10px;overflow:hidden;visibility:hidden;pointer-events:none;contain:strict';
      var ultimo = null;
      combos.slice(i, i + 2).forEach(function (c) {
        var s = document.createElement('div');
        s.textContent = texto;
        s.style.fontFamily = c[0] === 'ui' ? 'var(--font)' : c[0] === 'mono' ? 'var(--font-mono)' : c[0];
        s.style.fontSize = c[1] + 'px';
        s.style.fontWeight = c[2];
        if (c[3]) s.style.fontVariantNumeric = 'tabular-nums';
        s.style.letterSpacing = c[4] ? c[4] + 'px' : 'normal';
        d.appendChild(s);
        ultimo = s;
      });
      i += 2;
      document.body.appendChild(d);
      ultimo.offsetWidth; // da forma al texto aquí, en la tarea libre, y no en el siguiente cuadro
      d.remove();
      libre(paso);
    };
    setTimeout(function () { if (enApp()) libre(paso); else hecho = false; }, 1500);
  };
  // El código del mapa (Leaflet) se evalúa en tiempo libre unos segundos después de entrar, sin toques ni scroll
  // recientes; así la primera entrada al mapa o a geocercas no paga esa evaluación (que va en tareas cortas)
  var mapaListo = false;
  var prepararMapa = function () {
    if (mapaListo || acceso.test(location.pathname) || /\/(mapa|geocercas)(\/|$)/.test(location.pathname)) return;
    mapaListo = true;
    var y = NaN;
    var intento = function () {
      if (!enApp()) { mapaListo = false; return; }
      if (performance.now() - (globalThis.__lastTap || -1e9) < 1500 || window.scrollY !== y) { y = window.scrollY; setTimeout(function () { libre(intento); }, 1200); return; }
      import('./__MAPA__').catch(function () {});
    };
    setTimeout(function () { libre(intento); }, 8000);
  };
  var alNavegar = function () { calentar(); prepararMapa(); };
  ['pushState', 'replaceState'].forEach(function (k) { var o = history[k]; history[k] = function () { var r = o.apply(this, arguments); alNavegar(); return r; }; });
  addEventListener('popstate', alNavegar);
  // este archivo se carga después del evento load: si el documento ya está listo, revisa la ruta ahora
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', alNavegar);
  else alNavegar();
})();
