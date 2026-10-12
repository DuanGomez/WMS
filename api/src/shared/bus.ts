import { EventEmitter } from 'node:events';

/**
 * Bus de eventos en memoria por tenant. Lo usan tracking-ingest / watchdog para publicar y
 * tracking-stream para empujar los eventos al navegador (SSE). En Azure se reemplazaría por
 * Web PubSub / SignalR Service sin cambiar los productores.
 */
export type LiveEvent = 'position' | 'alert' | 'device' | 'notification';

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

export function publish(tenantId: string, event: LiveEvent, data: unknown) {
  emitter.emit(tenantId, event, data);
}

export function subscribe(tenantId: string, fn: (event: LiveEvent, data: any) => void): () => void {
  emitter.on(tenantId, fn);
  return () => emitter.off(tenantId, fn);
}
