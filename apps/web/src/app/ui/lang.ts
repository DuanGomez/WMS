import { ChangeDetectionStrategy, Component, Injectable, NgZone, inject, signal } from '@angular/core';
import { EN, EN_PATTERNS } from './lang.dict';

export type LangCode = 'es' | 'en';

/**
 * Idioma de la interfaz (ES/EN) sin tocar templates ni servicios:
 * traduce en el DOM los textos, placeholders, aria-label y title que estén en el
 * diccionario. Al volver a ES restaura el texto original. Los datos que llegan de
 * la API (nombres, placas, mensajes del servidor) no se traducen.
 */
@Injectable({ providedIn: 'root' })
export class Lang {
  private zone = inject(NgZone);
  readonly code = signal<LangCode>(this.read());
  private orig = new WeakMap<Node, string>();
  private origAttr = new WeakMap<Element, Record<string, string>>();
  private mine = new WeakSet<Node>();
  private obs?: MutationObserver;
  private static ATTRS = ['placeholder', 'aria-label', 'title'];

  constructor() {
    document.documentElement.lang = this.code() === 'en' ? 'en' : 'es-CO';
    this.zone.runOutsideAngular(() => {
      this.obs = new MutationObserver((list) => {
        if (this.code() !== 'en') return;
        for (const m of list) {
          if (m.type === 'characterData') this.text(m.target);
          else if (m.type === 'attributes') this.attr(m.target as Element, m.attributeName!);
          else m.addedNodes.forEach((n) => this.walk(n));
        }
      });
      this.obs.observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: Lang.ATTRS,
      });
    });
    if (this.code() === 'en') queueMicrotask(() => this.walk(document.body));
  }

  private read(): LangCode {
    try {
      return localStorage.getItem('wms.lang') === 'en' ? 'en' : 'es';
    } catch {
      return 'es';
    }
  }
  set(c: LangCode) {
    if (c === this.code()) return;
    this.code.set(c);
    try {
      localStorage.setItem('wms.lang', c);
    } catch {}
    document.documentElement.lang = c === 'en' ? 'en' : 'es-CO';
    this.walk(document.body, c === 'es');
  }
  toggle() {
    this.set(this.code() === 'es' ? 'en' : 'es');
  }

  /** Traduce una cadena suelta (útil para títulos de pestaña). */
  t(es: string): string {
    if (this.code() !== 'en') return es;
    return tr(es) ?? es;
  }

  private walk(root: Node, restore = false) {
    if (root.nodeType === 3) return restore ? this.restoreText(root) : this.text(root);
    if (root.nodeType !== 1) return;
    const el = root as Element;
    if (el.closest('[data-no-i18n],script,style,.leaflet-tile-pane')) return;
    for (const a of Lang.ATTRS) if (el.hasAttribute(a)) this.attrOp(el, a, restore);
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let n: Node | null = w.nextNode();
    while (n) {
      if (n.nodeType === 3) {
        if (restore) this.restoreText(n);
        else this.text(n);
      }
      else
        for (const a of Lang.ATTRS)
          if ((n as Element).hasAttribute(a)) this.attrOp(n as Element, a, restore);
      n = w.nextNode();
    }
  }
  private attrOp(el: Element, a: string, restore: boolean) {
    if (restore) this.restoreAttr(el, a);
    else this.attr(el, a);
  }
  private text(n: Node) {
    if (this.mine.has(n)) {
      this.mine.delete(n);
      return;
    }
    const v = n.nodeValue ?? '';
    const k = v.trim();
    if (!k || k.length > 400) return;
    const t = tr(k);
    if (t == null) return;
    this.orig.set(n, v);
    this.mine.add(n);
    n.nodeValue = v.replace(k, t);
  }
  private restoreText(n: Node) {
    const o = this.orig.get(n);
    if (o == null) return;
    n.nodeValue = o;
    this.orig.delete(n);
  }
  private attr(el: Element, a: string) {
    const v = el.getAttribute(a);
    if (!v) return;
    const store = this.origAttr.get(el) ?? {};
    if (store['__' + a] === v) return;
    const t = tr(v.trim());
    if (t == null) return;
    store[a] = v;
    store['__' + a] = t;
    this.origAttr.set(el, store);
    el.setAttribute(a, t);
  }
  private restoreAttr(el: Element, a: string) {
    const store = this.origAttr.get(el);
    if (!store || store[a] == null) return;
    el.setAttribute(a, store[a]);
    delete store[a];
    delete store['__' + a];
  }
}

function tr(k: string): string | null {
  const d = EN[k];
  if (d != null) return d;
  for (const [re, fn] of EN_PATTERNS) {
    const m = k.match(re);
    if (m) return fn(m);
  }
  return null;
}

/** Selector ES | EN con la píldora activa sólida (igual al prototipo). */
@Component({
  selector: 'app-lang-toggle',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display:contents', 'data-no-i18n': '' },
  template: `
    <button type="button" class="wms-lang" (click)="lang.toggle()" aria-label="Cambiar idioma">
      <span [class.on]="lang.code() === 'es'">ES</span>
      <span [class.on]="lang.code() === 'en'">EN</span>
    </button>
  `,
})
export class LangToggleComponent {
  readonly lang = inject(Lang);
}
