import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  Directive,
  ElementRef,
  HostListener,
  NgZone,
  OnDestroy,
  OnInit,
  effect,
  inject,
  input,
  output,
  untracked,
} from '@angular/core';
import { NavigationCancel, NavigationCancellationCode, NavigationEnd, NavigationError, Router } from '@angular/router';
import { filter, Subscription } from 'rxjs';
import { Theme } from '../core/ui.services';

/* =====================================================================
   Efectos visuales del rediseño. Ninguno toca datos ni servicios de negocio:
   solo DOM y estilos. Se pueden quitar sin romper nada.
   ===================================================================== */

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const touch = () => window.matchMedia('(hover: none)').matches;
/** Teléfono o tablet de gama baja: táctil y con 4 GB de RAM o menos, o 4 núcleos o menos (lo que informa el navegador). */
const lowEnd = () => {
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return (
    window.matchMedia('(hover: none) and (pointer: coarse)').matches &&
    ((mem !== undefined && mem <= 4) || (navigator.hardwareConcurrency || 8) <= 4)
  );
};

/** Fondo animado (brillos difusos) + tema oscuro por defecto si el usuario no eligió. */
@Component({
  selector: 'app-bg',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true' },
  styles: `
    :host { position: fixed; inset: 0; z-index: -1; pointer-events: none; overflow: hidden; }
    i { position: absolute; border-radius: 50%; display: block; }
    .a { top: -25vh; left: 15%; width: 100vh; height: 65vh; background: var(--wms-glow-a); filter: blur(90px); animation: glowPulse 9s ease-in-out infinite; }
    .b { top: 30vh; right: -15vw; width: 70vh; height: 70vh; background: var(--wms-glow-b); filter: blur(110px); animation: glowDrift 28s ease-in-out infinite; }
    .c { bottom: -20vh; left: -10vw; width: 80vh; height: 60vh; background: var(--wms-glow-a); filter: blur(120px); animation: glowDrift 36s ease-in-out infinite reverse; }
    .d { top: 45vh; left: 40%; width: 45vh; height: 45vh; background: var(--wms-glow-b); filter: blur(100px); animation: glowDrift 44s ease-in-out infinite; }
    @keyframes glowDrift { 0%,100% { transform: translate(0,0) scale(1) } 33% { transform: translate(6vw,4vh) scale(1.08) } 66% { transform: translate(-4vw,6vh) scale(.95) } }
    @keyframes glowPulse { 0%,100% { opacity: .6; transform: scale(.98) } 50% { opacity: 1; transform: scale(1.04) } }
  `,
  template: `<i class="a"></i><i class="b"></i><i class="c"></i><i class="d"></i>`,
})
export class BgComponent implements AfterViewInit, OnDestroy {
  private host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private zone = inject(NgZone);
  private timer = 0;
  private lastInput = 0;
  private last = 0;
  private anims: Animation[] = [];
  private static STEP = 500;
  private static EVENTS = ['pointermove', 'pointerdown', 'wheel', 'touchstart', 'keydown', 'scroll'] as const;

  constructor() {
    startRowReplay(inject(NgZone));
    trackKeyboard(inject(NgZone));
    const theme = inject(Theme);
    try {
      if (!localStorage.getItem('wms.theme')) theme.set('dark');
    } catch {}
  }

  /**
   * Los brillos tienen blur de 90–120 px y ciclos de 9–44 s: moverlos a 60 fps obliga a recalcular el
   * backdrop-filter de todas las tarjetas de vidrio en cada frame. Se avanzan a 2 Hz (mismo recorrido y
   * velocidad, salto imperceptible) y se detienen mientras el usuario interactúa, para que el scroll,
   * los clics y el arrastre tengan todos los frames. Sin JS o con reduced-motion queda el CSS tal cual.
   */
  ngAfterViewInit() {
    // Gama baja: sin brillos. Sin GPU suficiente, sus desenfoques (90–120 px) y el vidrio que los toma de fondo
    // costaban más que todo lo demás (simulado: mapa quieto de ~25 % de frames perdidos a ~0 %, cambio de sección
    // de ~47 % a ~24 %). En el resto de dispositivos se ven igual que siempre.
    if (lowEnd()) {
      this.host.style.display = 'none';
      return;
    }
    if (reduced() || typeof this.host.getAnimations !== 'function') return;
    requestAnimationFrame(() => {
      this.anims = this.host.getAnimations({ subtree: true });
      this.anims.forEach((a) => a.pause());
      this.last = performance.now();
      this.zone.runOutsideAngular(() => {
        for (const e of BgComponent.EVENTS) window.addEventListener(e, this.input, { passive: true, capture: true });
        this.timer = window.setInterval(this.step, BgComponent.STEP);
      });
    });
  }
  private input = () => (this.lastInput = performance.now());
  private step = () => {
    const now = performance.now();
    const dt = Math.min(now - this.last, BgComponent.STEP);
    this.last = now;
    if (document.hidden || now - this.lastInput < 1000) return;
    for (const a of this.anims) a.currentTime = (Number(a.currentTime) || 0) + dt;
  };
  ngOnDestroy() {
    clearInterval(this.timer);
    for (const e of BgComponent.EVENTS) window.removeEventListener(e, this.input, { capture: true });
  }
}

/** Botón de tema (sol / luna) idéntico al del prototipo. */
@Component({
  selector: 'app-theme-toggle',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display:contents' },
  template: `
    <button
      type="button"
      class="wms-ctl"
      [class.wide]="labeled()"
      (click)="toggle()"
      [attr.aria-label]="labeled() ? null : 'Cambiar modo'"
    >
      @if (theme.isDark()) {
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2m-7.07-17.07 1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"></path></svg>
        @if (labeled()) {
          <span>Modo claro</span>
        }
      } @else {
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"></path></svg>
        @if (labeled()) {
          <span>Modo oscuro</span>
        }
      }
    </button>
  `,
})
export class ThemeToggleComponent {
  readonly theme = inject(Theme);
  readonly labeled = input(false);
  toggle() {
    this.theme.set(this.theme.isDark() ? 'light' : 'dark');
  }
}

/** Inclinación 3D de la tarjeta según el mouse (máx ≈ ±6°), una actualización por frame. */
@Directive({ selector: '[wmsTilt]' })
export class TiltDirective implements OnDestroy {
  private el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private raf = 0;
  private rx = 0;
  private ry = 0;
  constructor() {
    this.el.style.transition = 'transform var(--dur-2) var(--ease-out)';
    this.el.style.backfaceVisibility = 'hidden';
  }
  @HostListener('mousemove', ['$event'])
  move(e: MouseEvent) {
    if (touch() || reduced() || flip.active) return;
    if ((e.target as HTMLElement).closest('button,input,a,label,select,textarea')) return this.set(0, 0);
    const r = this.el.getBoundingClientRect();
    const x = e.clientX - r.left - r.width / 2;
    const y = e.clientY - r.top - r.height / 2;
    this.set(-Math.round(y / 5) / 10, Math.round(x / 5) / 10);
  }
  @HostListener('mouseleave')
  leave() {
    this.set(0, 0);
  }
  private set(rx: number, ry: number) {
    if (rx === this.rx && ry === this.ry) return;
    this.rx = rx;
    this.ry = ry;
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => {
      this.el.style.transform = rx || ry ? `rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)` : 'none';
    });
  }
  ngOnDestroy() {
    cancelAnimationFrame(this.raf);
  }
}

/* Giro 360° de la tarjeta entre login y registro (1150 ms, ease-in-out cúbico, cambio de cara a 90°). */
const flip = { active: false, t0: 0, raf: 0, card: null as HTMLElement | null, face: null as HTMLElement | null };
const D = 1150;
const ez = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
function flipFrame(now: number) {
  const p = Math.min((now - flip.t0) / D, 1);
  const e = ez(p);
  const a = 360 * e;
  const s = 1 - 0.08 * Math.sin(Math.PI * e);
  if (flip.card) flip.card.style.transform = p < 1 ? `rotateY(${a.toFixed(2)}deg) scale(${s.toFixed(4)})` : 'none';
  if (flip.face) flip.face.style.transform = a > 90 && a < 270 ? 'scaleX(-1)' : 'none';
  if (p < 1) flip.raf = requestAnimationFrame(flipFrame);
  else flip.active = false;
  return a;
}

/** Tarjeta que participa en el giro. Va en el contenedor 3D; [wmsFlipFace] en la cara interior. */
@Directive({ selector: '[wmsFlipCard]' })
export class FlipCardDirective implements OnInit, OnDestroy {
  private el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  ngOnInit() {
    this.el.style.willChange = 'transform';
    flip.card = this.el;
    flip.face = (this.el.querySelector('[wmsFlipFace]') ?? this.el.firstElementChild) as HTMLElement | null;
    if (flip.active) flipFrame(performance.now());
  }
  ngOnDestroy() {
    if (flip.card === this.el) flip.card = null;
  }
}

/** Enlace que navega con el giro. Uso: <a wmsFlip="/registro" href="/registro">. */
@Directive({ selector: 'a[wmsFlip]' })
export class FlipLinkDirective {
  private router = inject(Router);
  readonly wmsFlip = input.required<string>();
  @HostListener('click', ['$event'])
  click(e: MouseEvent) {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    const url = this.wmsFlip();
    if (reduced() || !flip.card) {
      this.router.navigateByUrl(url);
      return;
    }
    if (flip.active) return;
    flip.active = true;
    flip.t0 = performance.now();
    let swapped = false;
    const step = (now: number) => {
      const a = flipFrame(now);
      if (!swapped && a >= 90) {
        swapped = true;
        cancelAnimationFrame(flip.raf);
        this.router.navigateByUrl(url).then(() => requestAnimationFrame(flipFrame));
        return;
      }
      if (!swapped) flip.raf = requestAnimationFrame(step);
    };
    cancelAnimationFrame(flip.raf);
    flip.raf = requestAnimationFrame(step);
  }
}

/**
 * Píldora deslizante de la navbar: una capa para hover y otra para el activo.
 * Mide los hijos con [routerLinkActive] → clase .active.
 */
@Directive({ selector: '[wmsNavPill]' })
export class NavPillDirective implements AfterViewInit, OnDestroy {
  private host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private router = inject(Router);
  private zone = inject(NgZone);
  private hov = document.createElement('span');
  private act = document.createElement('span');
  private sub?: Subscription;
  private ro?: ResizeObserver;
  private first = true;
  private movingUntil = 0;
  private lastActive: HTMLElement | null = null;
  /** Sección elegida con clic mientras la navegación termina (todavía no tiene la clase .active). */
  private pending: HTMLElement | null = null;

  ngAfterViewInit() {
    this.hov.className = 'wms-pill-hover';
    this.act.className = 'wms-pill-active';
    this.host.prepend(this.hov, this.act);
    this.zone.runOutsideAngular(() => {
      this.host.addEventListener('mouseover', this.over);
      this.host.addEventListener('mouseleave', this.out);
      this.host.addEventListener('click', this.go);
      // También observa cada sección: su ancho cambia al activarse, al cargar la fuente o al traducir a inglés,
      // y la píldora debe seguirla (antes se quedaba con la medida vieja y aparecía desplazada).
      // Si la píldora se está deslizando, el ajuste continúa animado en vez de cortar el movimiento.
      this.ro = new ResizeObserver(() => this.place(performance.now() < this.movingUntil));
      this.ro.observe(this.host);
      this.observeItems();
    });
    this.sub = this.router.events
      .pipe(
        filter(
          (e) =>
            e instanceof NavigationEnd ||
            e instanceof NavigationError ||
            // Si se eligió otra sección antes de que cargara la primera, esa sigue en curso: no se vuelve atrás.
            (e instanceof NavigationCancel && e.code !== NavigationCancellationCode.SupersededByNewNavigation),
        ),
      )
      .subscribe(() => requestAnimationFrame(() => {
        this.pending = this.chosen = null;
        // RouterLinkActive ya movió .active: se quitan las marcas provisionales (si se canceló, vuelve la anterior).
        this.mark(this.host, null);
        // La sección recién activada empieza ahora a crecer: se mantiene la medida final mientras dura.
        const act = this.host.querySelector('.nav-item.active');
        if (this.goal && this.goal.el === act) this.holdGoal(this.goal, 550);
        this.observeItems();
        this.place(true);
      }));
    requestAnimationFrame(() => this.place(false));
    document.fonts?.ready.then(() => this.place(false));
  }
  private over = (e: Event) => {
    const it = (e.target as HTMLElement).closest('.nav-item') as HTMLElement | null;
    if (!it || !this.host.contains(it)) return;
    this.hov.style.opacity = '1';
    this.hov.style.width = it.offsetWidth + 'px';
    this.hov.style.transform = `translateX(${it.offsetLeft}px)`;
  };
  private out = () => {
    this.hov.style.opacity = '0';
  };
  /** Al hacer clic la píldora sale ya hacia la sección elegida, con el hilo libre: si esperara al final de la
   *  navegación, la carga y el pintado de la página nueva le quitarían los frames y parecería un salto.
   *  Píldora y etiquetas arrancan juntas en el clic (ya soltado): si la píldora saliera al presionar, mientras se
   *  mantiene el botón quedaba ancha sobre una sección todavía cerrada (estirada entre las dos), y si las etiquetas
   *  cambiaran al presionar, las secciones se correrían bajo el puntero y el clic se perdería. */
  private go = (e: Event) => {
    const it = this.itemOf(e);
    if (!it || (e as MouseEvent).metaKey || (e as MouseEvent).ctrlKey) return;
    if (it !== this.pending) {
      this.pending = it;
      this.place(true, it);
    }
    this.chosen = it;
    this.mark(this.host, it);
  };
  /** Sección elegida con clic cuya navegación sigue en curso (lleva la marca .on). */
  private chosen: HTMLElement | null = null;
  private itemOf(e: Event) {
    const it = (e.target as HTMLElement).closest('.nav-item') as HTMLElement | null;
    return it && this.host.contains(it) ? it : null;
  }
  /** Mientras la sección elegida se activa (y su padding crece con transición), la píldora usa la medida final
   *  calculada al presionar; al terminar vuelve a medir la real y corrige si algo cambió entre medias. */
  private goal: { el: HTMLElement; left: number; width: number; until: number } | null = null;
  private goalTimer = 0;
  private geometry(a: HTMLElement) {
    const now = performance.now();
    if (this.goal?.el === a && now < this.goal.until) return this.goal;
    if (a.classList.contains('active') && !this.host.querySelector('.nav-item:is(.on, .off)'))
      return { left: a.offsetLeft, width: a.offsetWidth };
    this.holdGoal({ el: a, ...this.predict(a), until: 0 }, 900);
    return this.goal!;
  }
  /** Marca provisional mientras carga la sección elegida: .on la muestra ya abierta (con su etiqueta) y .off
   *  cierra la activa anterior. Sin esto la etiqueta vieja seguía abierta hasta que terminaba la navegación y
   *  la píldora, ya en su medida final, quedaba estirada entre las dos secciones. */
  private mark(root: HTMLElement, t: HTMLElement | null) {
    root.querySelectorAll('.nav-item:is(.on, .off)').forEach((e) => e.classList.remove('on', 'off'));
    if (!t || t.classList.contains('active')) return;
    t.classList.add('on');
    root.querySelectorAll('.nav-item.active').forEach((e) => e.classList.add('off'));
  }
  private holdGoal(goal: { el: HTMLElement; left: number; width: number; until: number }, ms: number) {
    goal.until = performance.now() + ms;
    this.goal = goal;
    clearTimeout(this.goalTimer);
    this.goalTimer = window.setTimeout(() => {
      this.goal = null;
      this.place(true);
    }, ms + 50);
  }
  /** Geometría final de una sección si estuviera activa, medida en una copia invisible de la barra: tocar las
   *  clases de la real cortaría sus transiciones en curso y movería las secciones bajo el puntero. */
  private predict(t: HTMLElement) {
    const i = Array.from(this.host.querySelectorAll('.nav-item')).indexOf(t);
    const copy = this.host.cloneNode(true) as HTMLElement;
    copy.setAttribute('aria-hidden', 'true');
    copy.style.cssText = `position:absolute;left:0;top:0;width:${this.host.clientWidth}px;visibility:hidden;pointer-events:none`;
    const items = Array.from(copy.querySelectorAll<HTMLElement>('.nav-item'));
    items.forEach((e) => (e.style.transition = 'none'));
    this.mark(copy, items[i]);
    this.host.after(copy);
    const g = { left: items[i].offsetLeft, width: items[i].offsetWidth };
    copy.remove();
    return g;
  }
  private observeItems() {
    // border-box: el ítem activo crece por padding (transición), que la caja de contenido no registra
    this.host.querySelectorAll('.nav-item').forEach((it) => this.ro?.observe(it, { box: 'border-box' }));
  }
  private place(animate: boolean, target?: HTMLElement) {
    const a = target ?? this.pending ?? (this.host.querySelector('.nav-item.active') as HTMLElement | null);
    if (!a) {
      this.act.style.opacity = '0';
      return;
    }
    // Si cambió la sección activa, siempre se desliza (venga de la navegación o del ResizeObserver,
    // que puede llegar antes); un simple cambio de tamaño de la misma sección se ajusta sin animación.
    const tr = (animate || a !== this.lastActive) && !this.first && !reduced();
    this.lastActive = a;
    this.act.style.transition = tr
      ? 'transform var(--dur-3) var(--ease), width var(--dur-3) var(--ease), opacity var(--dur-2)'
      : 'none';
    // Destino elegido con clic que aún no es la sección activa: se mide cómo quedará (con su etiqueta
    // y con la anterior ya encogida) para ir directo, sin pasar por la posición vieja y rebotar.
    const g = this.geometry(a);
    this.act.style.opacity = '1';
    this.act.style.width = g.width + 'px';
    this.act.style.transform = `translateX(${g.left}px)`;
    if (tr) this.movingUntil = performance.now() + 500;
    // La sección activa siempre a la vista (también al cargar, cuando la barra no cabe completa).
    const l = g.left - this.host.scrollLeft;
    if (l < 0 || l + g.width > this.host.clientWidth)
      this.host.scrollTo({ left: g.left - 24, behavior: tr ? 'smooth' : 'auto' });
    this.first = false;
  }
  ngOnDestroy() {
    this.sub?.unsubscribe();
    this.ro?.disconnect();
    this.host.removeEventListener('mouseover', this.over);
    this.host.removeEventListener('mouseleave', this.out);
    this.host.removeEventListener('click', this.go);
    clearTimeout(this.goalTimer);
  }
}

/**
 * Deslizar a la izquierda para ejecutar una acción (atender alerta) en táctil, como swipeItem() del prototipo:
 * la fila sigue al dedo (máx. −220 px; a la derecha con resistencia), detrás aparece una capa con la etiqueta
 * y un círculo; a −90 px queda "armada" (capa sólida, círculo 1.15, vibración). Al soltar armada la fila sale
 * a −110 %, se desvanece, su alto se cierra y a los 430 ms se emite (swiped). Si no, vuelve a su sitio.
 * Uso: <div class="list-item" wmsSwipe swipeLabel="Atendida" (swiped)="attend(a)">.
 */
@Directive({ selector: '[wmsSwipe]', host: { class: 'wms-swipe' } })
export class SwipeDirective implements OnInit, OnDestroy {
  private el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private zone = inject(NgZone);
  readonly swipeLabel = input('Atendida');
  readonly swipeDisabled = input(false);
  readonly swiped = output<void>();
  private bg = document.createElement('div');
  private lab = document.createElement('span');
  private x0 = 0;
  private y0 = 0;
  private dx = 0;
  private lock: 'x' | 'y' | null = null;
  private armed = false;
  private gone = false;
  private timers: number[] = [];
  private static TH = 90;

  constructor() {
    // Cuando la acción se completa (la fila queda deshabilitada) o se reutiliza, vuelve a su estado sin transición.
    effect(() => {
      this.swipeDisabled();
      untracked(() => this.gone && this.restore(false));
    });
  }
  ngOnInit() {
    this.bg.className = 'wms-swipe-bg';
    this.bg.setAttribute('aria-hidden', 'true');
    this.lab.className = 'wms-swipe-lab';
    const ic = document.createElement('span');
    ic.className = 'wms-swipe-ic';
    ic.innerHTML =
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    this.bg.append(this.lab, ic);
    this.zone.runOutsideAngular(() => {
      this.el.addEventListener('touchstart', this.start, { passive: true });
      this.el.addEventListener('touchmove', this.move, { passive: false });
      this.el.addEventListener('touchend', this.end);
      this.el.addEventListener('touchcancel', this.end);
    });
  }
  private start = (e: TouchEvent) => {
    if (this.swipeDisabled() || this.gone) return;
    this.x0 = e.touches[0].clientX;
    this.y0 = e.touches[0].clientY;
    this.dx = 0;
    this.lock = null;
    this.armed = false;
  };
  /** Primer movimiento horizontal: capa detrás y fila opaca (para que la capa solo se vea donde se descubre). */
  private begin() {
    this.lab.textContent = this.swipeLabel();
    if (this.bg.parentNode !== this.el.parentNode) this.el.parentNode?.insertBefore(this.bg, this.el);
    const b = this.bg.style;
    b.top = this.el.offsetTop + 'px';
    b.left = this.el.offsetLeft + 'px';
    b.width = this.el.offsetWidth + 'px';
    b.height = this.el.offsetHeight + 'px';
    b.transition = 'background .18s, color .18s';
    b.opacity = '1';
    this.bg.classList.remove('armed');
    this.lab.style.opacity = '0';
    const m = getComputedStyle(this.el).color.match(/\d+/);
    const dark = !!m && +m[0] > 128; // texto claro = tema oscuro (como cardC del prototipo)
    // Una animación de entrada en curso (se repite cuando llegan alertas en vivo) no debe pisar el arrastre.
    this.el.classList.add('wms-swiping');
    this.el.style.transition = 'none';
    this.el.style.background = dark ? '#161617' : '#ecece9';
  }
  private move = (e: TouchEvent) => {
    if (this.swipeDisabled() || this.gone || this.lock === 'y') return;
    const ddx = e.touches[0].clientX - this.x0;
    const ddy = e.touches[0].clientY - this.y0;
    if (!this.lock) {
      if (Math.abs(ddy) > 8 && Math.abs(ddy) > Math.abs(ddx)) {
        this.lock = 'y';
        return;
      }
      if (Math.abs(ddx) < 6) return;
      this.lock = 'x';
      this.begin();
    }
    if (e.cancelable) e.preventDefault();
    this.dx = ddx < 0 ? Math.max(-220, ddx) : ddx * 0.15;
    this.el.style.transform = `translate3d(${this.dx}px,0,0)`;
    const armed = this.dx <= -SwipeDirective.TH;
    if (armed !== this.armed) {
      this.armed = armed;
      this.bg.classList.toggle('armed', armed);
      if (armed) navigator.vibrate?.(8);
    }
    this.lab.style.opacity = String(Math.max(0, Math.min(1, -this.dx / 60)));
  };
  private end = () => {
    if (this.lock !== 'x') {
      this.lock = null;
      return;
    }
    this.lock = null;
    const s = this.el.style;
    if (this.armed) {
      this.gone = true;
      const ease = 'var(--ease-swipe)'; // duraciones del gesto: sincronizadas con los temporizadores de abajo
      s.height = this.el.offsetHeight + 'px';
      s.overflow = 'hidden';
      void this.el.offsetHeight;
      s.transition = `transform .26s ${ease}, opacity .2s ease .08s, height .3s ${ease} .12s, min-height .3s ${ease} .12s, padding .3s ${ease} .12s`;
      s.transform = 'translate3d(-110%,0,0)';
      s.opacity = '0';
      s.height = '0px';
      s.minHeight = '0px';
      s.paddingTop = '0px';
      s.paddingBottom = '0px';
      this.bg.style.transition = `height .3s ${ease} .12s`;
      this.bg.style.height = '0px';
      this.timers.push(
        window.setTimeout(() => {
          this.zone.run(() => this.swiped.emit());
          // Si la acción no llega a completarse (error), la fila vuelve.
          this.timers.push(window.setTimeout(() => this.restore(true), 5000));
        }, 430),
      );
      return;
    }
    s.transition = 'transform .34s var(--ease-swipe)';
    s.transform = '';
    this.bg.style.transition = 'opacity .28s ease';
    this.bg.style.opacity = '0';
    this.timers.push(
      window.setTimeout(() => {
        s.transition = '';
        s.background = '';
        this.el.classList.remove('wms-swiping');
        this.bg.classList.remove('armed');
        this.lab.style.opacity = '0';
      }, 360),
    );
  };
  private restore(animated: boolean) {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this.gone = false;
    this.armed = false;
    const s = this.el.style;
    s.transition = animated ? 'transform .34s var(--ease-swipe), opacity .3s var(--ease-fade)' : 'none';
    for (const p of ['transform', 'opacity', 'height', 'minHeight', 'paddingTop', 'paddingBottom', 'overflow', 'background'] as const)
      s[p] = '';
    this.el.classList.remove('wms-swiping');
    this.bg.style.transition = 'none';
    this.bg.style.opacity = '0';
    this.bg.classList.remove('armed');
    if (animated) this.timers.push(window.setTimeout(() => (s.transition = ''), 380));
    else requestAnimationFrame(() => requestAnimationFrame(() => (s.transition = '')));
  }
  ngOnDestroy() {
    this.timers.forEach(clearTimeout);
    this.bg.remove();
    this.el.removeEventListener('touchstart', this.start);
    this.el.removeEventListener('touchmove', this.move);
    this.el.removeEventListener('touchend', this.end);
    this.el.removeEventListener('touchcancel', this.end);
  }
}

/**
 * Contador animado: anima el número de 0 al valor (1.2 s, ease-out) cuando cambia.
 * Uso: <span [wmsCount]="kpis().km" [decimals]="0"></span>. Formato es-CO.
 */
@Directive({ selector: '[wmsCount]' })
export class CountDirective implements OnDestroy {
  private el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  readonly wmsCount = input<number | null | undefined>(0);
  readonly decimals = input(0);
  private raf = 0;
  private cur = 0;
  constructor() {
    effect(() => {
      const to = Number(this.wmsCount() ?? 0);
      const dec = this.decimals();
      const fmt = (v: number) =>
        v.toLocaleString(document.documentElement.lang === 'en' ? 'en-US' : 'es-CO', {
          minimumFractionDigits: dec,
          maximumFractionDigits: dec,
        });
      cancelAnimationFrame(this.raf);
      if (reduced() || !isFinite(to)) {
        this.cur = to;
        this.el.textContent = fmt(to);
        return;
      }
      const from = this.cur;
      const t0 = performance.now();
      const step = (n: number) => {
        const p = Math.min((n - t0) / 1200, 1);
        const e = 1 - Math.pow(1 - p, 3);
        this.cur = from + (to - from) * e;
        this.el.textContent = fmt(this.cur);
        if (p < 1) this.raf = requestAnimationFrame(step);
      };
      this.raf = requestAnimationFrame(step);
    });
  }
  ngOnDestroy() {
    cancelAnimationFrame(this.raf);
  }
}

/**
 * Tablero con arrastrar y soltar (mouse y táctil con pulsación larga de 220 ms).
 * Host = contenedor del tablero. Columnas: [data-col="valor"]. Tarjetas: [data-card="id"].
 * Emite (moved) con { id, col } al soltar en otra columna. No llama a la API: la página decide.
 */
@Directive({ selector: '[wmsBoard]' })
export class BoardDragDirective implements OnInit, OnDestroy {
  private host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private zone = inject(NgZone);
  readonly boardDisabled = input(false);
  readonly moved = output<{ id: string; col: string }>();
  private card: HTMLElement | null = null;
  private ghost: HTMLElement | null = null;
  private over: HTMLElement | null = null;
  private timer = 0;
  private x0 = 0;
  private y0 = 0;
  private dx = 0;
  private dy = 0;
  private dragging = false;
  private suppressClick = false;
  private lastX = 0;
  private lastY = 0;
  private edgeDir = 0;
  private edgeTimer = 0;

  ngOnInit() {
    this.zone.runOutsideAngular(() => {
      this.host.addEventListener('pointerdown', this.down);
      this.host.addEventListener('click', this.click, true);
      this.host.addEventListener('contextmenu', this.noMenu);
      this.host.addEventListener('scroll', this.scrolled, { passive: true });
    });
  }
  /** Táctil: mientras se arrastra, el navegador no debe tomar el gesto como scroll (si no, cancela el puntero). */
  private block = (e: TouchEvent) => {
    if (this.dragging && e.cancelable) e.preventDefault();
  };
  private noMenu = (e: Event) => {
    if (this.dragging) e.preventDefault();
  };
  private scrolled = () => {
    if (this.dragging) this.hit();
  };
  private down = (e: PointerEvent) => {
    if (this.boardDisabled() || e.button !== 0) return;
    const c = (e.target as HTMLElement).closest('[data-card]') as HTMLElement | null;
    if (!c || (e.target as HTMLElement).closest('button,a,input,select')) return;
    this.card = c;
    this.x0 = e.clientX;
    this.y0 = e.clientY;
    const r = c.getBoundingClientRect();
    this.dx = e.clientX - r.left;
    this.dy = e.clientY - r.top;
    window.addEventListener('pointermove', this.move, { passive: false });
    window.addEventListener('pointerup', this.up);
    window.addEventListener('pointercancel', this.cancel);
    if (e.pointerType !== 'mouse') {
      window.addEventListener('touchmove', this.block, { passive: false });
      this.timer = window.setTimeout(() => this.start(e.clientX, e.clientY), 220);
    }
  };
  private start(x: number, y: number) {
    if (!this.card || this.dragging) return;
    this.dragging = true;
    navigator.vibrate?.(8);
    const r = this.card.getBoundingClientRect();
    const g = this.card.cloneNode(true) as HTMLElement;
    g.classList.add('wms-ghost');
    g.style.width = r.width + 'px';
    g.style.left = x - this.dx + 'px';
    g.style.top = y - this.dy + 'px';
    document.body.appendChild(g);
    this.ghost = g;
    this.card.classList.add('wms-dragging');
    this.host.classList.add('wms-board-active');
  }
  private move = (e: PointerEvent) => {
    if (!this.card) return;
    if (!this.dragging) {
      if (e.pointerType === 'mouse' && Math.hypot(e.clientX - this.x0, e.clientY - this.y0) > 6)
        this.start(e.clientX, e.clientY);
      else if (e.pointerType !== 'mouse' && Math.hypot(e.clientX - this.x0, e.clientY - this.y0) > 10) {
        clearTimeout(this.timer);
        this.cancel();
      }
      return;
    }
    e.preventDefault();
    this.ghost!.style.left = e.clientX - this.dx + 'px';
    this.ghost!.style.top = e.clientY - this.dy + 'px';
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.hit();
    this.edge(e.clientX);
  };
  /** Columna bajo el puntero (limitado al área visible del tablero, para que el borde también cuente). */
  private hit() {
    const r = this.host.getBoundingClientRect();
    const x = Math.min(r.right - 16, Math.max(r.left + 16, this.lastX));
    const y = Math.min(Math.min(r.bottom, window.innerHeight) - 16, Math.max(Math.max(r.top, 0) + 16, this.lastY));
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    let col = el?.closest('[data-col]') as HTMLElement | null;
    if (col && !this.host.contains(col)) col = null;
    if (col !== this.over) {
      this.over?.classList.remove('wms-over');
      col?.classList.add('wms-over');
      this.over = col;
    }
  }
  /** Cerca del borde izquierdo/derecho el tablero avanza una columna (en móvil solo se ve una). */
  private edge(x: number) {
    const r = this.host.getBoundingClientRect();
    const E = 36;
    const dir = this.host.scrollWidth > this.host.clientWidth ? (x < r.left + E ? -1 : x > r.right - E ? 1 : 0) : 0;
    if (dir === this.edgeDir) return;
    this.edgeDir = dir;
    clearTimeout(this.edgeTimer);
    if (dir) this.edgeTimer = window.setTimeout(this.autoScroll, 350);
  }
  private autoScroll = () => {
    if (!this.dragging || !this.edgeDir) return;
    const col = this.host.querySelector<HTMLElement>('[data-col]');
    const gap = parseFloat(getComputedStyle(this.host).columnGap) || 0;
    this.host.scrollBy({ left: this.edgeDir * ((col?.offsetWidth ?? 260) + gap), behavior: reduced() ? 'auto' : 'smooth' });
    this.edgeTimer = window.setTimeout(this.autoScroll, 1000);
  };
  private up = () => {
    clearTimeout(this.timer);
    if (this.dragging && this.card && this.over) {
      const id = this.card.dataset['card']!;
      const from = (this.card.closest('[data-col]') as HTMLElement | null)?.dataset['col'];
      const col = this.over.dataset['col']!;
      if (col !== from) this.zone.run(() => this.moved.emit({ id, col }));
    }
    if (this.dragging) this.suppressClick = true;
    this.cancel();
  };
  private cancel = () => {
    clearTimeout(this.timer);
    clearTimeout(this.edgeTimer);
    this.edgeDir = 0;
    window.removeEventListener('pointermove', this.move);
    window.removeEventListener('pointerup', this.up);
    window.removeEventListener('pointercancel', this.cancel);
    window.removeEventListener('touchmove', this.block);
    this.over?.classList.remove('wms-over');
    this.card?.classList.remove('wms-dragging');
    this.host.classList.remove('wms-board-active');
    if (this.ghost) {
      const g = this.ghost;
      g.classList.add('wms-ghost-drop');
      setTimeout(() => g.remove(), 220);
    }
    this.ghost = null;
    this.over = null;
    this.card = null;
    this.dragging = false;
  };
  private click = (e: Event) => {
    if (this.suppressClick) {
      e.stopPropagation();
      e.preventDefault();
      this.suppressClick = false;
    }
  };
  ngOnDestroy() {
    this.cancel();
    this.host.removeEventListener('pointerdown', this.down);
    this.host.removeEventListener('click', this.click, true);
    this.host.removeEventListener('contextmenu', this.noMenu);
    this.host.removeEventListener('scroll', this.scrolled);
  }
}

/**
 * Alto del teclado en pantalla como --kb (en <html>), para subir las hojas fijas abajo y que no tapen el campo
 * donde se escribe. En Android ya lo resuelve interactive-widget=resizes-content (index.html) y --kb queda en 0;
 * Safari (iOS) ignora esa opción y solo encoge el visualViewport, que es lo que se mide aquí.
 */
function trackKeyboard(zone: NgZone) {
  const vv = window.visualViewport;
  if (!vv) return;
  let last = -1;
  const update = () => {
    const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    if (kb === last) return;
    last = kb;
    document.documentElement.style.setProperty('--kb', kb + 'px');
  };
  // .wms-typing en <html> mientras se escribe en un campo de texto (styles.scss sube los avisos para que no lo tapen)
  const typing = (t: EventTarget | null) =>
    t instanceof HTMLElement &&
    (t.isContentEditable ||
      t.matches('textarea, select, input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=button]):not([type=submit])'));
  zone.runOutsideAngular(() => {
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    document.addEventListener('focusin', (e) => document.documentElement.classList.toggle('wms-typing', typing(e.target)));
    document.addEventListener('focusout', () => document.documentElement.classList.remove('wms-typing'));
  });
}

/**
 * Repite la animación de entrada de las filas cuando una lista o tabla cambia
 * (filtros, pestañas, búsqueda), igual que replayRows() del prototipo. Global, sin tocar templates.
 */
const ROW_HOSTS = '.list, .table tbody, .vlist, .glist, .wms-board, .alerts-mini, .hbars';
const ROW_ITEMS = ':scope > .list-item, :scope > tr, :scope > .vrow, :scope > .gitem, :scope > .mini, :scope > .hbar, .vcard';
function startRowReplay(zone: NgZone) {
  if (reduced()) return;
  const pending = new Set<Element>();
  let raf = 0;
  const flush = () => {
    raf = 0;
    pending.forEach((host) => {
      const rows = Array.from(host.querySelectorAll<HTMLElement>(ROW_ITEMS)).slice(0, 16);
      rows.forEach((r) => (r.style.animation = 'none'));
      void (host as HTMLElement).offsetWidth;
      rows.forEach((r, i) => {
        r.style.animation = '';
        r.style.animationDelay = 60 + i * 45 + 'ms';
      });
    });
    pending.clear();
  };
  zone.runOutsideAngular(() => {
    new MutationObserver((list) => {
      for (const m of list) {
        if (!m.addedNodes.length && !m.removedNodes.length) continue;
        const t = m.target as Element;
        if (t.nodeType !== 1 || !t.matches(ROW_HOSTS)) continue;
        // Solo cuando cambia el conjunto (filtros); la primera carga ya anima por CSS
        if (!(t as HTMLElement).dataset['wmsSeen']) {
          (t as HTMLElement).dataset['wmsSeen'] = '1';
          continue;
        }
        pending.add(t);
      }
      if (pending.size && !raf) raf = requestAnimationFrame(flush);
    }).observe(document.body, { childList: true, subtree: true });
  });
}
