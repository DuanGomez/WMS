(function () {
  // Dos versiones en una sola app: COMPLETA (con animaciones de entrada) y LIVIANA (sin ellas).
  // La clase va en <html> antes del primer pintado. Gama: pista rápida aquí, consulta de GPU en tiempo libre y, en
  // gama media o alta, prueba real de cuadros en las primeras entradas. Lo decidido se guarda en localStorage wms.gama.
  var cl = document.documentElement.classList;
  // REGLA: número de la regla de decisión. Al cambiar la regla se sube y lo guardado se vuelve a decidir, aunque el
  // código de la app (APP) no haya cambiado (2: tablet de gama baja o media en liviana desde el primer arranque).
  var APP = __APP__, CLAVE = 'wms.gama', REGLA = 2;
  var nav = navigator, ua = nav.userAgent || '';
  var apple = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && nav.maxTouchPoints > 1) || (/Safari\//.test(ua) && !/Chrome\/|Chromium|CriOS|Edg\/|OPR\/|Firefox\/|FxiOS/.test(ua));
  // en iOS y Safari la memoria y los núcleos no son fiables
  var mem = apple ? undefined : nav.deviceMemory, nuc = apple ? undefined : nav.hardwareConcurrency;
  var reducir = false;
  try { reducir = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  // Tablet (táctil y ancha; también Samsung Internet en modo escritorio, que dice hover:hover con el dedo): pantalla
  // grande con GPU de celular. Arranca en liviana y solo pasa a completa si su GPU es de gama alta (en una tablet con
  // Mali-G68 la completa salió mala en la prueba real 2 de 3 veces y se trababa hasta que la prueba la bajaba).
  // Por el lado menor de la pantalla (screen), no por el ancho de la vista: este script corre antes de que el navegador
  // lea <meta name="viewport">, y en ese momento un celular aún dice 980 px de ancho.
  var tableta = false;
  try { tableta = matchMedia('(hover: none), (pointer: coarse)').matches && Math.min(screen.width, screen.height) >= 600; } catch (e) {}
  var g = null;
  try { g = JSON.parse(localStorage.getItem(CLAVE)); } catch (e) {}
  var valida = !!g && g.appVersion === APP && g.regla === REGLA && (g.version === 'completa' || g.version === 'liviana') && !(g.motivo === 'prueba' && Date.now() - (g.fecha || 0) > 7 * 864e5);
  if (!valida) g = { gama: null, version: null, motivo: null, gpu: null, mem: mem, nucleos: nuc, resultados: [], appVersion: APP, regla: REGLA, fecha: Date.now() };
  if (!g.resultados) g.resultados = [];
  var guardar = function () { try { localStorage.setItem(CLAVE, JSON.stringify(g)); } catch (e) {} };
  var actual = (reducir ? 'liviana' : valida ? g.version : (mem && mem <= 4) || (nuc && nuc <= 4) || tableta ? 'liviana' : 'completa');
  cl.add('v-' + actual);

  // El cambio de versión se aplica en la siguiente navegación, antes de que entre la nueva sección.
  var pendiente = null;
  var cambiar = function (v) { if (!reducir) pendiente = v; };
  var filas = function () {
    var mo = globalThis.__wmsRowMO;
    if (!mo) return;
    if (actual === 'liviana') mo.disconnect();
    else mo.observe(document.body, { childList: true, subtree: true });
  };
  var aplicar = function () {
    if (!pendiente || pendiente === actual) { pendiente = null; return; }
    cl.remove('v-' + actual);
    actual = pendiente;
    pendiente = null;
    cl.add('v-' + actual);
    filas();
    try { document.dispatchEvent(new Event('wms-version')); } catch (e) {}
  };

  // Consulta de GPU: después del primer pintado y en tiempo libre, solo si no hay una decisión guardada.
  var nombreGpu = function (gl) {
    var n = '';
    try { var e = gl.getExtension('WEBGL_debug_renderer_info'); n = String(gl.getParameter(e ? e.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || ''); } catch (e) {}
    try { var l = gl.getExtension('WEBGL_lose_context'); if (l) l.loseContext(); } catch (e) {}
    return n;
  };
  var clasificar = function (s, sw) {
    if (sw || !s) return 'baja';
    if (/Mali-4\d\d|Mali-T\d|Mali-G(31|51|52)\b|PowerVR[^,)]*\b(GE8\d{3}|G6\d{3})\b|Adreno[^0-9]*([345]\d\d|60[5-9]|61[0-2])(?!\d)|Intel[^,)]*GMA|Intel\(R\) HD Graphics(?! \d)|HD Graphics [2-5]\d{3}\b|(HD|UHD) Graphics (400|405|500|505|600|605)\b|Radeon(\(TM\))? R[2-5]\b/i.test(s)) return 'baja';
    if ((mem !== undefined && mem <= 2) || (nuc !== undefined && nuc <= 2)) return 'baja';
    if (/NVIDIA|GeForce|Quadro|Radeon(\(TM\))? (RX|Pro)\b|Apple M\d|Adreno[^0-9]*(7[3-9]\d|[89]\d\d)(?!\d)|Mali-G[79]\d\d|Immortalis|Xclipse/i.test(s)) return 'alta';
    if (/Mali-G(5[4-9]|6\d|7\d)\b|Mali-G[68]\d\d|Adreno[^0-9]*(61[3-9]|6[2-9]\d|7[0-2]\d)(?!\d)|PowerVR[^,)]*\b(BXM|BXE|GM9|GT7)|Intel|Radeon|Apple/i.test(s)) return 'media';
    return mem !== undefined && mem <= 4 ? 'baja' : 'media';
  };
  // consulta en el hilo principal (respaldo): crear el primer contexto WebGL puede tardar cientos de ms
  var consultaPrincipal = function () {
    var nombre = '', sw = false;
    try {
      var gl = document.createElement('canvas').getContext('webgl', { failIfMajorPerformanceCaveat: true });
      if (gl) nombre = nombreGpu(gl);
      else {
        sw = true;
        var gl2 = document.createElement('canvas').getContext('webgl');
        if (gl2) nombre = nombreGpu(gl2);
      }
    } catch (e) { return; }
    aplicarGpu(nombre, sw);
  };
  // La misma consulta en un worker con OffscreenCanvas, fuera del hilo principal (en el Chrome de Lighthouse el
  // primer contexto WebGL costaba 201 ms en el hilo principal). Si el navegador no puede hacer WebGL en un worker, o no
  // responde en 4 s, se usa la consulta de siempre.
  var trabajador = function () {
    self.onmessage = function () {
      var leer = function (gl) {
        var n = '';
        try { var e = gl.getExtension('WEBGL_debug_renderer_info'); n = String(gl.getParameter(e ? e.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || ''); } catch (e) {}
        try { var l = gl.getExtension('WEBGL_lose_context'); if (l) l.loseContext(); } catch (e) {}
        return n;
      };
      var r = { ok: false, nombre: '', sw: false };
      try {
        var gl = new OffscreenCanvas(1, 1).getContext('webgl', { failIfMajorPerformanceCaveat: true });
        if (gl) { r.ok = true; r.nombre = leer(gl); }
        else {
          var gl2 = new OffscreenCanvas(1, 1).getContext('webgl');
          if (gl2) { r.ok = true; r.sw = true; r.nombre = leer(gl2); }
        }
      } catch (e) {}
      self.postMessage(r);
    };
  };
  var decidir = function () {
    if (typeof OffscreenCanvas === 'undefined' || typeof Worker === 'undefined' || typeof Blob === 'undefined' || !window.URL) return consultaPrincipal();
    var w, url, listo = false;
    var fin = function (r) {
      if (listo) return;
      listo = true;
      try { w && w.terminate(); if (url) URL.revokeObjectURL(url); } catch (e) {}
      if (r && r.ok) aplicarGpu(r.nombre, r.sw); else consultaPrincipal();
    };
    try {
      url = URL.createObjectURL(new Blob(['(' + trabajador + ')()'], { type: 'text/javascript' }));
      w = new Worker(url);
      w.onmessage = function (e) { fin(e.data); };
      w.onerror = function () { fin(null); };
      w.postMessage(0);
      setTimeout(function () { fin(null); }, 4000);
    } catch (e) { fin(null); }
  };
  var aplicarGpu = function (nombre, sw) {
    if (/swiftshader|llvmpipe|basic render|software|softpipe/i.test(nombre)) sw = true;
    g.gpu = nombre || '(sin WebGL)';
    g.gama = clasificar(nombre, sw);
    g.mem = mem;
    g.nucleos = nuc;
    g.version = g.gama === 'baja' || (tableta && g.gama !== 'alta') ? 'liviana' : 'completa';
    g.motivo = 'gama ' + g.gama + (tableta && g.gama === 'media' ? ' (tableta)' : '');
    g.resultados = [];
    g.fecha = Date.now();
    guardar();
    cambiar(g.version);
  };
  if (!valida) requestAnimationFrame(function () {
    setTimeout(function () { (window.requestIdleCallback || function (f) { return setTimeout(f, 300); })(decidir, { timeout: 2000 }); }, 0);
  });

  // Prueba real (solo en COMPLETA de gama media o alta): 3 primeras entradas a secciones, 1,2 s cada una.
  var necesita = function () { return !reducir && actual === 'completa' && g.version === 'completa' && /^gama (media|alta)$/.test(g.motivo || '') && g.resultados.length < 3; };
  var evaluar = function (m) {
    if (m.length < 8) return;
    var iv = [], i;
    for (i = 1; i < m.length; i++) iv.push(m[i] - m[i - 1]);
    var orden = iv.slice().sort(function (a, b) { return a - b; }), p10 = orden[Math.floor(orden.length * 0.1)];
    var normal = 1000 / 60, cerca = 1e9;
    [1000 / 144, 1000 / 120, 1000 / 90, 1000 / 60].forEach(function (x) { var d = Math.abs(x - p10); if (d < cerca) { cerca = d; normal = x; } });
    if (!(p10 > 0) || cerca > normal * 0.35) normal = 1000 / 60;
    var tarde = 0, peor = 0;
    iv.forEach(function (x) { if (x > 1.8 * normal) tarde++; if (x > peor) peor = x; });
    var fps = (1000 * iv.length) / (m[m.length - 1] - m[0]);
    var r = { tarde: Math.round((100 * tarde) / iv.length), fps: Math.round(fps), peor: Math.round(peor), hz: Math.round(1000 / normal) };
    r.mala = tarde / iv.length > 0.2 || fps < (0.83 * 1000) / normal || peor > 6 * normal;
    g.resultados.push(r);
    var malas = g.resultados.filter(function (x) { return x.mala; }).length;
    if (malas >= 2) { g.version = 'liviana'; g.motivo = 'prueba'; g.fecha = Date.now(); cambiar('liviana'); }
    else if (g.resultados.length - malas >= 2) { g.motivo = 'probado'; g.fecha = Date.now(); }
    guardar();
  };
  var midiendo = false;
  var medir = function () {
    if (midiendo || document.visibilityState !== 'visible') return;
    midiendo = true;
    var ini = performance.now(), fin = ini + 1200, oculto = false, n = 0, t = new Float64Array(200);
    var vis = function () { if (document.visibilityState !== 'visible') oculto = true; };
    document.addEventListener('visibilitychange', vis);
    var cerrar = function () {
      document.removeEventListener('visibilitychange', vis);
      midiendo = false;
      if (oculto) return;
      var m = [];
      for (var j = 0; j < n; j++) m.push(t[j]);
      evaluar(m);
    };
    var paso = function (ts) { if (n < 200) t[n++] = ts; if (ts < fin) requestAnimationFrame(paso); else cerrar(); };
    requestAnimationFrame(paso);
  };

  var acceso = /\/(login|registro|recuperar|restablecer)(\/|$)/, antes = location.pathname;
  var navego = function () {
    var ahora = location.pathname;
    if (ahora === antes) return;
    antes = ahora;
    aplicar();
    if (!acceso.test(ahora) && necesita()) medir();
  };
  ['pushState', 'replaceState'].forEach(function (k) { var o = history[k]; history[k] = function () { var r = o.apply(this, arguments); navego(); return r; }; });
  addEventListener('popstate', navego);
  addEventListener('DOMContentLoaded', filas);

})();
