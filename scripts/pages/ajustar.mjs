/**
 * Ajustes de rendimiento sobre el build de Angular para la demo de GitHub Pages (los usa scripts/build-pages.mjs).
 * Es la versión medida y validada en celulares de gama baja, media y alta y en PC, aplicada igual que allí:
 *  - reemplazos exactos en el código compilado (ajustes.mjs),
 *  - anulaciones de las animaciones de entrada en la versión liviana, junto a cada regla de los componentes,
 *  - Leaflet inicializado en 6 tareas y la pista de compilación de V8 en los archivos del arranque,
 *  - en index.html, los scripts y estilos de la cabecera (cabecera/), la pantalla de carga fija y el tema claro,
 *  - la precarga en tiempo libre (precarga.js) en un archivo aparte que se pide después del evento load.
 * Todo falla con un mensaje claro si el código compilado no es el esperado (una versión nueva de Angular o Leaflet,
 * o un cambio en la app que mueve un texto reemplazado).
 */
import { Parser } from 'acorn';
import { transformSync } from 'esbuild';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reemplazos } from './ajustes.mjs';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const PISTA = '//# allFunctionsCalledOnLoad\n';

// Minificación de los bloques en línea y de la precarga (mismas opciones con que se midió: el script de versión y la
// precarga, que tienen una función «paso», van sin renombrar variables).
const minJs = (c) =>
  transformSync(c, {
    loader: 'js',
    minifyWhitespace: true,
    minifySyntax: true,
    minifyIdentifiers: !/\b(bucle|paso)\b/.test(c),
    target: 'es2019',
  }).code.trim();
const minCss = (c) => transformSync(c, { loader: 'css', minify: true, target: 'chrome100' }).code.trim();

/** Cambios en los .js del build de Angular (antes de armar las páginas). */
export function ajustarCodigo(out) {
  const js = fs.readdirSync(out).filter((f) => f.endsWith('.js'));
  const leer = (f) => fs.readFileSync(path.join(out, f), 'utf8');
  const escribir = (f, s) => fs.writeFileSync(path.join(out, f), s);
  const unico = (pred, nombre) => {
    const r = js.filter((f) => pred(leer(f)));
    if (r.length !== 1) throw new Error(`${nombre}: ${r.length} archivos (se esperaba 1)`);
    return r[0];
  };
  const archivos = {
    main: js.find((f) => /^main-[\w-]+\.js$/.test(f)),
    nucleo: unico((s) => s.includes('this.useMicrotaskScheduler?'), 'núcleo de Angular'),
    enrutador: unico((s) => s.includes('.skipNextTransition)return'), 'enrutador'),
    leaflet: unico((s) => /leaflet-container/.test(s) && /_updateLevels/.test(s), 'Leaflet'),
    mapa: unico((s) => s.includes('selectors:[[`app-live-map`]]'), 'mapa'),
    geocercas: unico((s) => s.includes('selectors:[[`app-geofences`]]'), 'geocercas'),
    hoja: unico((s) => s.includes('this.drag={y:e.clientY,h:this.height()()}'), 'panel arrastrable'),
  };
  aplicarReemplazos(reemplazos.filter((x) => x.archivo !== 'demo'), (a) => path.join(out, archivos[a]));
  escribir(archivos.leaflet, partirLeaflet(leer(archivos.leaflet), 6));
  anularEntradasLiviana(js.map((f) => path.join(out, f)));
  // pista de compilación en el módulo principal y los que se precargan con él
  const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  const arranque = [archivos.main, ...[...html.matchAll(/<link rel="modulepreload" href="([^"]+)"/g)].map((m) => m[1])];
  for (const f of arranque) if (!leer(f).startsWith(PISTA)) escribir(f, PISTA + leer(f));
  return { ...archivos, arranque };
}

/** Cambios en la API de la demo (después de empaquetarla). */
export function ajustarDemo(archivo) {
  aplicarReemplazos(reemplazos.filter((x) => x.archivo === 'demo'), () => archivo);
}

/** Cada «antes» se ubica en el archivo original (una sola vez) y todos se aplican juntos, sin pisarse. */
function aplicarReemplazos(lista, ruta) {
  const porArchivo = new Map();
  for (const x of lista) {
    const f = ruta(x.archivo);
    if (!porArchivo.has(f)) porArchivo.set(f, []);
    porArchivo.get(f).push(x);
  }
  for (const [f, xs] of porArchivo) {
    const s = fs.readFileSync(f, 'utf8');
    const pos = xs
      .map((x) => {
        const n = s.split(x.antes).length - 1;
        if (n !== 1) throw new Error(`${path.basename(f)} · ${x.que}: ${n} coincidencias (se esperaba 1)`);
        const ini = s.indexOf(x.antes);
        return { ini, fin: ini + x.antes.length, x };
      })
      .sort((a, b) => a.ini - b.ini);
    for (let k = 1; k < pos.length; k++)
      if (pos[k].ini < pos[k - 1].fin) throw new Error(`${pos[k - 1].x.que} y ${pos[k].x.que} se pisan`);
    let r = s;
    for (const p of [...pos].reverse()) r = r.slice(0, p.ini) + p.x.despues + r.slice(p.fin);
    fs.writeFileSync(f, r);
  }
}

/**
 * Leaflet viene como CommonJS (UMD): todo su código está dentro de una función (la «fábrica») que corre de una vez la
 * primera vez que alguien lo pide (~100 ms con la CPU limitada 6x). Aquí la fábrica pasa a ser asíncrona, con pausas
 * (setTimeout) entre sus instrucciones repartidas por tamaño, y el propio módulo la ejecuta y la espera en su nivel
 * superior: quien lo importa (mapa, geocercas) evalúa después, con Leaflet completo, igual que antes. El orden de
 * ejecución no cambia. Lleva también la pista de compilación.
 */
function partirLeaflet(src, partes) {
  const parse = (c) => Parser.parse(c, { ecmaVersion: 'latest', sourceType: 'module' });
  const ast = parse(src);
  let fabrica = null;
  let llamada = null;
  const visitar = (n) => {
    if (!n || typeof n.type !== 'string') return;
    if (
      n.type === 'CallExpression' &&
      n.callee.type === 'FunctionExpression' &&
      n.callee.params.length === 2 &&
      n.arguments.length === 2 &&
      n.arguments[1].type === 'FunctionExpression' &&
      n.arguments[1].params.length === 1 &&
      src.slice(n.callee.start, n.callee.end).includes('define.amd')
    ) {
      fabrica = n.arguments[1];
      llamada = n.callee; // la envoltura UMD: function(l,p){ … p(exports) … }
    }
    for (const v of Object.values(n)) {
      if (Array.isArray(v)) v.forEach(visitar);
      else if (v && typeof v.type === 'string') visitar(v);
    }
  };
  visitar(ast);
  if (!fabrica) throw new Error('Leaflet: no se encontró su fábrica UMD');
  const decl = ast.body.find((n) => n.start <= fabrica.start && n.end >= fabrica.end);
  if (decl?.type !== 'VariableDeclaration' || decl.declarations.length !== 1)
    throw new Error('Leaflet: la fábrica no está en una declaración de nivel superior');
  // en la envoltura UMD, la llamada a la fábrica en modo CommonJS (`p(exports)`) guarda su promesa
  const p = llamada.params[1].name;
  const m = src.slice(llamada.start, llamada.end).match(new RegExp(`\\?${p.replace(/\$/g, '\\$')}\\(([A-Za-z_$][\\w$]*)\\):`));
  if (!m) throw new Error('Leaflet: no se encontró la llamada a la fábrica en la envoltura UMD');
  const cuerpo = fabrica.body.body;
  // las declaraciones de funciones se elevan y no cuentan para repartir
  const pesa = (n) =>
    n.type !== 'FunctionDeclaration' && n.type !== 'EmptyStatement' && !(n.type === 'ExpressionStatement' && n.directive);
  const total = cuerpo.filter(pesa).reduce((s, n) => s + (n.end - n.start), 0);
  const cortes = [];
  let acum = 0;
  let siguiente = total / partes;
  for (let i = 0; i < cuerpo.length - 1; i++) {
    if (pesa(cuerpo[i])) acum += cuerpo[i].end - cuerpo[i].start;
    if (acum >= siguiente && cortes.length < partes - 1) {
      cortes.push(cuerpo[i].end);
      siguiente += total / partes;
    }
  }
  // ediciones de atrás hacia adelante para no mover las posiciones
  const ediciones = [
    ...cortes.map((c) => [c, c, ';await new Promise(r=>setTimeout(r));']),
    [fabrica.start, fabrica.start, 'async '],
    [llamada.start + m.index + 1, llamada.start + m.index + m[0].length - 1, `(globalThis.__wmsLeaflet=${p}(${m[1]}))`],
    [decl.end, decl.end, `${decl.declarations[0].id.name}();await globalThis.__wmsLeaflet;`],
  ].sort((a, b) => b[0] - a[0]);
  let out = src;
  for (const [a, b, t] of ediciones) out = out.slice(0, a) + t + out.slice(b);
  parse(out); // sigue siendo un módulo válido
  return PISTA + out;
}

/**
 * Versión liviana: cada regla con animación de ENTRADA de un componente recibe al lado su anulación
 * (html.v-liviana …{animation:none!important}), con la misma clave de componente: no se agregan reglas que el
 * navegador tenga que revisar contra todos los elementos.
 */
function anularEntradasLiviana(archivos) {
  const ENTRADA = new Set([
    '.auth-stage', '.form-ok', '.mgrid > *', '.trip', '.panel', '.gitem', '.sgrid > *', '.d-head > *', '.d-rows',
    '.d-actions', '.bubble', '.mini', '.hbar', '.fill, .fill.green', '.bcol', '.bshare > div', '.vcard', '.fa-head',
    '.fa-titles > * > span', '.kgrid > *, .row1 > *, .row2 > *', '.prevline', '.area', '.line', '.cvrow', '.cvt > div',
    '.dseg', '.ld', '.ldt > div', '.bgrid > *', '.fill',
  ]);
  const NOMBRE =
    /animation:(?:_ngcontent-%COMP%_)?(wms-in|wms-in-hero|wms-row-in|wms-mask|wms-grow|grow|faGrow|faDraw|faDonut|wms-fade|wms-drawer-l|sheet-up)\b/;
  const vistos = new Set();
  for (const f of archivos) {
    let n = 0;
    const s = fs.readFileSync(f, 'utf8').replace(/([^{}"`]{1,220})\{([^{}]*)\}/g, (todo, sel, decl) => {
      if (!NOMBRE.test(decl) || !sel.includes('[_ngcontent-%COMP%]')) return todo;
      const norma = sel.replace(/\[_ngcontent-%COMP%\]/g, '').replace(/\s+/g, ' ').trim();
      if (!ENTRADA.has(norma)) return todo;
      vistos.add(norma);
      n++;
      const lista = sel.trim().split(',').map((x) => 'html.v-liviana ' + x.trim()).join(',');
      return `${todo}${lista}{animation:none!important}`;
    });
    if (n) fs.writeFileSync(f, s);
  }
  const faltan = [...ENTRADA].filter((x) => !vistos.has(x));
  if (faltan.length) throw new Error('versión liviana: reglas de entrada no encontradas: ' + faltan.join(' | '));
}

/**
 * index.html: tema claro, scripts y estilos de la cabecera en sus posiciones, pantalla de carga fija y bloques en
 * línea minificados. Escribe también la precarga (precarga-<hash>.js). `worker` es el script de arranque de la API.
 */
export function armarIndex(out, html, { worker, leaflet }) {
  const cab = (f) => fs.readFileSync(path.join(aqui, 'cabecera', f), 'utf8');
  const una = (s, a, b, d) => {
    const n = s.split(a).length - 1;
    if (n !== 1) throw new Error(`index.html · ${d}: ${n} coincidencias (se esperaba 1)`);
    return s.replace(a, () => b);
  };
  const main = fs.readdirSync(out).find((f) => /^main-[\w-]+\.js$/.test(f));
  const mainJs = fs.readFileSync(path.join(out, main), 'utf8');
  // código de las pantallas a las que se llega desde el acceso (registro, recuperar, reporte compartido y login)
  const acceso = ['registro', 'recuperar', 'compartido/:token', 'login'].map((ruta) => {
    const m = [...mainJs.matchAll(new RegExp(`path:\`${ruta}\`[^{}]*?import\\(\`\\./(chunk-[\\w-]+\\.js)\`\\)`, 'g'))];
    if (m.length !== 1) throw new Error(`ruta ${ruta}: ${m.length} coincidencias en ${main}`);
    return m[0][1];
  });
  // código de todas las secciones, en orden alfabético sin distinguir mayúsculas
  const may = (s) => s.toUpperCase();
  const secciones = fs
    .readdirSync(out)
    .filter((f) => /^chunk-[\w-]+\.js$/.test(f))
    .sort((a, b) => (may(a) < may(b) ? -1 : may(a) > may(b) ? 1 : 0));
  const completar = (s) =>
    s
      .replace('__APP__', () => JSON.stringify(main.slice(5, -3)))
      .replace('__ACCESO__', () => JSON.stringify(acceso))
      .replace('__SECCIONES__', () => JSON.stringify(secciones));

  // precarga en tiempo libre (letras y código del mapa): no hace falta antes de pintar
  const fuente = fs.readFileSync(path.join(aqui, 'precarga.js'), 'utf8');
  if (fuente.split('__MAPA__').length !== 2) throw new Error('precarga.js: se esperaba un solo __MAPA__');
  const precarga = minJs(fuente.replace('__MAPA__', leaflet));
  const archivoPrecarga = `precarga-${createHash('sha256').update(precarga).digest('hex').slice(0, 10)}.js`;
  fs.writeFileSync(path.join(out, archivoPrecarga), precarga + '\n');
  const cargarPrecarga = `addEventListener("load",function(){var e=document.createElement("script");e.src="${archivoPrecarga}";document.head.appendChild(e)})`;

  const etiqueta = (f, codigo) => (f.endsWith('.css') ? `<style>${codigo}</style>` : `<script>${codigo}</script>`);
  const inicio = [
    ['inicio-0-cuadros.js'],
    ['inicio-1-toques.js'],
    ['inicio-2-version.js'],
    [null, cargarPrecarga],
    ['inicio-3-entradas.js'],
    ['inicio-4-brillos.js'],
    ['inicio-5-acceso.js'],
  ]
    .map(([f, c]) => `<script>${c ?? completar(cab(f))}</script>\n`)
    .join('');
  // [archivo, separador que lo sigue]: el mismo orden y los mismos saltos de línea con que se midió
  const fin = [
    ['fin-01-sin-desenfoque.css', '\n'],
    ['fin-02-pantalla-carga.css', '\n'],
    ['fin-03-demo-boot.css', ''],
    ['fin-04-tema-claro.css', '\n'],
    ['fin-05-sin-transicion-tactil.js', '\n'],
    ['fin-06-precarga-secciones.js', '\n'],
    ['fin-07-barra.css', '\n'],
    ['fin-08-paneles-desenfoque.css', ''],
    ['fin-09-precarga-acceso.js', '\n'],
    ['fin-10-menu.css', '\n'],
    ['fin-11-fondo.css', '\n'],
    ['fin-12-ajustes-1.css', '\n'],
    ['fin-13-ajustes-2.css', '\n'],
    ['fin-14-ajustes-3.css', '\n'],
    ['fin-15-sombra-paneles.css', '\n'],
    ['fin-16-paneles-capa.css', '\n'],
    ['fin-17-liviana.css', '\n'],
    ['fin-18-tactil.css', '\n'],
  ]
    .map(([f, sep]) => etiqueta(f, completar(cab(f))) + sep)
    .join('');

  // saltos de línea LF, como en Linux (en Windows, con autocrlf, el HTML de Angular sale con CRLF)
  html = html.replace(/\r\n/g, '\n');
  // El HTML se compila con el tema oscuro (y su CSS crítico): aquí pasa a claro, con los tokens claros en fin-04.
  html = una(html, '<html lang="es-CO" data-theme="dark"', '<html lang="es-CO" data-theme="light"', 'tema');
  html = una(html, '<meta name="theme-color" content="#000000">', '<meta name="theme-color" content="#d2d2d0">', 'color de la barra');
  html = una(
    html,
    "        if (t === 'light') document.documentElement.setAttribute('data-theme', 'light');",
    "        if (t === 'dark') { document.documentElement.setAttribute('data-theme', 'dark'); document.querySelector('meta[name=\"theme-color\"]').setAttribute('content', '#000000'); }",
    'tema guardado',
  );
  html = una(html, '<head>\n', '<head>\n' + inicio, 'inicio de la cabecera');
  html = una(html, '</noscript></head>', `</noscript>  <script>${worker}</script>\n${fin}</head>`, 'fin de la cabecera');
  const pantalla = fs.readFileSync(path.join(aqui, 'pantalla-carga.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '').trim();
  html = una(html, '<app-root></app-root>', pantalla + '<app-root></app-root>', 'pantalla de carga');
  // minifica los bloques en línea (los de la cabecera y los que ya traía el HTML)
  return html.replace(/<(script|style)([^>]*)>([\s\S]*?)<\/\1>/g, (todo, t, at, c) => {
    if (!c.trim() || /\bsrc=/.test(at) || /type=["']?(application\/(?!javascript)|text\/(?!javascript|css))/.test(at))
      return todo;
    return `<${t}${at}>${t === 'style' ? minCss(c) : minJs(c)}</${t}>`;
  });
}
