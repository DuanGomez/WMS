import { Injectable, signal } from '@angular/core';

export interface Toast {
  id: number;
  title: string;
  text?: string;
  icon: string;
  tone: 'blue' | 'green' | 'orange' | 'red' | 'purple' | 'gray';
  app?: string;
  at: Date;
  leaving?: boolean;
  action?: () => void;
}

/** Banners tipo notificación de iOS. */
@Injectable({ providedIn: 'root' })
export class Toasts {
  readonly items = signal<Toast[]>([]);
  private seq = 0;

  show(t: Omit<Toast, 'id' | 'at'>, ms = 5000) {
    const toast: Toast = { ...t, id: ++this.seq, at: new Date() };
    this.items.update((l) => [toast, ...l].slice(0, 4));
    setTimeout(() => this.dismiss(toast.id), ms);
    return toast.id;
  }
  success(title: string, text?: string) {
    return this.show({ title, text, icon: 'check', tone: 'green' }, 3200);
  }
  error(title: string, text?: string) {
    return this.show({ title, text, icon: 'triangle-alert', tone: 'red' }, 6000);
  }
  info(title: string, text?: string) {
    return this.show({ title, text, icon: 'info', tone: 'blue' }, 4000);
  }
  dismiss(id: number) {
    this.items.update((l) => l.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => this.items.update((l) => l.filter((t) => t.id !== id)), 300);
  }
}

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
  /** Si se define, muestra un campo (texto o selección) y devuelve su valor. */
  input?: { placeholder?: string; value?: string; options?: { value: string; label: string }[] };
}

type Pending = ConfirmOptions & { resolve: (v: string | boolean | null) => void; value: string };

/** Diálogos de confirmación estilo UIAlertController. */
@Injectable({ providedIn: 'root' })
export class Confirm {
  readonly current = signal<Pending | null>(null);

  ask(o: ConfirmOptions): Promise<boolean> {
    return new Promise((resolve) =>
      this.current.set({ ...o, value: '', resolve: (v) => resolve(!!v) }),
    );
  }
  prompt(o: ConfirmOptions): Promise<string | null> {
    return new Promise((resolve) =>
      this.current.set({
        ...o,
        value: o.input?.value ?? o.input?.options?.[0]?.value ?? '',
        resolve: (v) => resolve(typeof v === 'string' ? v : null),
      }),
    );
  }
  close(result: boolean) {
    const c = this.current();
    if (!c) return;
    c.resolve(result ? (c.input ? c.value : true) : c.input ? null : false);
    this.current.set(null);
  }
}

export type ThemePref = 'auto' | 'light' | 'dark';

@Injectable({ providedIn: 'root' })
export class Theme {
  readonly pref = signal<ThemePref>(this.read());
  readonly isDark = signal(false);
  private mq = window.matchMedia('(prefers-color-scheme: dark)');

  constructor() {
    this.apply();
    this.mq.addEventListener('change', () => this.apply());
  }
  private read(): ThemePref {
    try {
      return (localStorage.getItem('wms.theme') as ThemePref) || 'auto';
    } catch {
      return 'auto';
    }
  }
  set(p: ThemePref) {
    this.pref.set(p);
    try {
      localStorage.setItem('wms.theme', p);
    } catch {}
    this.apply();
  }
  /**
   * Cambio de tema pedido por la persona: un solo fundido de toda la pantalla. Antes cada elemento cambiaba de
   * color a su propio ritmo (fondo al instante, textos en 0,3 s, chips en 1,1 s) y a mitad del cambio quedaban
   * textos sin contraste que desaparecían y volvían (titileo). Ahora se aplica el tema de golpe, sin esas
   * transiciones (.wms-theme-switch), y la view transition funde la imagen vieja con la nueva.
   */
  change(p: ThemePref) {
    const root = document.documentElement;
    const doc = document as Document & {
      startViewTransition?: (cb: () => void) => { ready: Promise<void>; finished: Promise<void> };
    };
    root.classList.add('wms-theme-switch');
    const done = () => root.classList.remove('wms-theme-switch');
    if (doc.startViewTransition && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const t = doc.startViewTransition(() => this.set(p));
      // Si el navegador la cancela (p. ej. cambia el tamaño de la ventana), ready y finished se rechazan pero el
      // tema igual se aplica, sin fundido.
      t.ready.catch(() => {});
      t.finished.then(done, done);
    } else {
      this.set(p);
      requestAnimationFrame(() => requestAnimationFrame(done));
    }
  }
  private apply() {
    const p = this.pref();
    if (p === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', p);
    this.isDark.set(p === 'dark' || (p === 'auto' && this.mq.matches));
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', this.isDark() ? '#000000' : '#f2f2f7');
  }
}

/** Preferencia local por navegador (comodidades; nunca datos de negocio). */
export function pref<T>(key: string, fallback: T) {
  const s = signal<T>(fallback);
  try {
    const raw = localStorage.getItem(`wms.${key}`);
    if (raw !== null) s.set(JSON.parse(raw));
  } catch {}
  return {
    get: s.asReadonly(),
    set(v: T) {
      s.set(v);
      try {
        localStorage.setItem(`wms.${key}`, JSON.stringify(v));
      } catch {}
    },
  };
}
