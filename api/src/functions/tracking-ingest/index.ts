import { unauthorized } from '../../shared/errors';
import { defineHttp, ok } from '../../shared/http';
import { ingestPayloadOrThrow } from './parse';
import { ingestPosition } from '../../shared/ingest';
import { devicesRepo } from '../../shared/repositories/fleet';

/**
 * tracking-ingest (RE1, RG8): HTTP POST que recibe la posición enviada por el dispositivo GPS.
 * Autenticación por dispositivo con la cabecera `x-device-key` (API key generada al registrar el GPS).
 * El tenant se deduce del dispositivo, nunca del payload.
 */
defineHttp({
  name: 'tracking-ingest',
  route: 'tracking/ingest',
  methods: ['POST'],
  guard: 'public',
  handler: (req) => {
    const key = req.headers.get('x-device-key');
    if (!key) throw unauthorized('Falta la cabecera x-device-key del dispositivo.');
    const device = devicesRepo.byApiKey(key);
    if (!device) throw unauthorized('API key de dispositivo inválida o dispositivo dado de baja.');
    const payload = ingestPayloadOrThrow(req.body);
    const result = ingestPosition(device, payload);
    return result.stored
      ? ok({ stored: true, vehicleId: result.vehicleId, tripId: result.tripId, alerts: result.alerts })
      : { status: 202, json: { stored: false, reason: result.reason } };
  },
});
