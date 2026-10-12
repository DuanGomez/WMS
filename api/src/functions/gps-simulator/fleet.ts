/**
 * Flota simulada. El seed crea estos vehículos/dispositivos con las mismas API keys,
 * y el simulador las usa para autenticarse en tracking-ingest como lo haría un GPS real.
 */
export interface SimVehicleConfig {
  key: string;
  company: 'la72' | 'trigal';
  plate: string;
  type: 'moto' | 'carro' | 'camion' | 'furgon';
  label: string;
  serial: string;
  model: string;
  apiKey: string;
  /** Distancia inicial sobre la ruta (m). */
  startM: number;
  /** 1 = sentido de la ruta, -1 = sentido inverso. */
  direction: 1 | -1;
  /** Velocidad crucero (km/h). */
  cruise: number;
  minSpeed: number;
  maxSpeed: number;
  /** Hace parada de entrega en Supermercados la 72 en cada vuelta. */
  deliveryStop?: boolean;
}

export const SIM_FLEET: SimVehicleConfig[] = [
  {
    key: 'moto',
    company: 'la72',
    plate: 'KLM45E',
    type: 'moto',
    label: 'Moto de domicilios',
    serial: '860123450000101',
    model: 'Coban GPS303G',
    apiKey: 'gps_demo_moto_la72_K7d9Qm2x',
    startM: 14650,
    direction: 1,
    cruise: 34,
    minSpeed: 20,
    maxSpeed: 45,
    deliveryStop: true,
  },
  {
    key: 'carro',
    company: 'la72',
    plate: 'JRT482',
    type: 'carro',
    label: 'Carro administrativo',
    serial: '860123450000202',
    model: 'Teltonika FMC130',
    apiKey: 'gps_demo_carro_la72_P3w8Zr1v',
    startM: 5200,
    direction: 1,
    cruise: 32,
    minSpeed: 20,
    maxSpeed: 45,
  },
  {
    key: 'camion',
    company: 'la72',
    plate: 'SXK913',
    type: 'camion',
    label: 'Camión de abastecimiento',
    serial: '860123450000303',
    model: 'Queclink GV300',
    apiKey: 'gps_demo_camion_la72_T6n4Hb8y',
    startM: 20500,
    direction: -1,
    cruise: 27,
    minSpeed: 18,
    maxSpeed: 38,
  },
  {
    key: 'trigal',
    company: 'trigal',
    plate: 'HTZ210',
    type: 'furgon',
    label: 'Furgón de reparto (Panadería El Trigal)',
    serial: '860123450000404',
    model: 'Teltonika FMB920',
    apiKey: 'gps_demo_furgon_trigal_W2c5Lk9s',
    startM: 9800,
    direction: -1,
    cruise: 30,
    minSpeed: 20,
    maxSpeed: 42,
  },
];

export type ScenarioType = 'stop' | 'signal_loss' | 'deviation' | 'theft';

export const SCENARIOS: Record<ScenarioType, { label: string; durationS: number; description: string }> = {
  stop: {
    label: 'Parada prolongada',
    durationS: 60,
    description: 'El vehículo se detiene 60 s (dispara la alerta de parada prolongada).',
  },
  signal_loss: {
    label: 'Pérdida de señal GPS',
    durationS: 45,
    description: 'El GPS deja de transmitir 45 s (dispara la alerta de falla del dispositivo).',
  },
  deviation: {
    label: 'Desvío de ruta',
    durationS: 110,
    description: 'El vehículo sale ~450 m del corredor autorizado y regresa.',
  },
  theft: {
    label: 'Simular robo',
    durationS: 150,
    description: 'Se mueve con el encendido apagado y se aleja de la ruta (alerta crítica).',
  },
};
