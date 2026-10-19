export type Level = 'none' | 'read' | 'write';
export type Module =
  | 'dashboard'
  | 'map'
  | 'vehicles'
  | 'drivers'
  | 'devices'
  | 'geofences'
  | 'alerts'
  | 'reports'
  | 'users'
  | 'billing'
  | 'support'
  | 'simulator';
export type Role = 'admin' | 'owner' | 'supervisor' | 'driver' | 'support';
export type PermissionMap = Record<Module, Level>;
export type LatLng = [number, number];

export interface Session {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: Role;
  roleLabel: string;
  permissions: PermissionMap;
  modules: Module[];
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  company: {
    id: string;
    name: string;
    isPlatform: boolean;
    planName: string | null;
    subscriptionStatus: string | null;
  };
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: Session;
}

export interface ApiError {
  code: string;
  message: string;
  details?: { path: string; message: string }[] | unknown;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  roleLabel: string;
  phone: string;
  active: boolean;
  permissionOverrides: Partial<PermissionMap>;
  permissions: PermissionMap;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface Driver extends User {
  document: string;
  licenseNumber: string;
  licenseCategory: string;
  licenseExpiresAt: string | null;
  status: string;
  shiftActive: boolean;
  vehicle: { id: string; plate: string; type: string } | null;
  openTripId: string | null;
  location: DriverLocation | null;
}

export type VehicleType = 'moto' | 'carro' | 'camion' | 'furgon';

export interface LiveState {
  lat: number;
  lng: number;
  speed: number;
  heading: number;
  accuracy: number;
  battery: number | null;
  ignition: boolean;
  ts: string;
  stoppedSince: string | null;
}

export interface Vehicle {
  id: string;
  plate: string;
  type: VehicleType;
  brand: string;
  model: string;
  year: number | null;
  color: string;
  status: 'active' | 'maintenance' | 'inactive' | 'retired';
  createdAt: string;
  retiredAt: string | null;
  retiredReason: string | null;
  device: {
    id: string;
    serial: string;
    model: string;
    connection: string;
    battery: number | null;
    status: string;
    lastSeenAt: string | null;
  } | null;
  driver: { id: string; name: string; phone: string } | null;
  live: LiveState | null;
  trail?: LatLng[];
}

export interface Device {
  id: string;
  serial: string;
  model: string;
  status: 'active' | 'inactive' | 'faulty' | 'retired';
  connection: 'online' | 'offline' | 'unknown';
  battery: number | null;
  powered: boolean;
  lastSeenAt: string | null;
  notes: string;
  retiredReason: string | null;
  retiredAt: string | null;
  createdAt: string;
  vehicle: { id: string; plate: string; type: string } | null;
  apiKey?: string;
}

export interface Geofence {
  id: string;
  name: string;
  description: string;
  shape: 'circle' | 'polygon' | 'corridor';
  center: LatLng | null;
  radiusM: number | null;
  coordinates: LatLng[];
  color: string;
  allVehicles: boolean;
  vehicleIds: string[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
  vehiclesInside: string[];
}

export type Priority = 'low' | 'medium' | 'high' | 'critical';

export interface Alert {
  id: string;
  ruleId: string | null;
  vehicleId: string | null;
  vehiclePlate: string | null;
  deviceId: string | null;
  type: string;
  typeLabel: string;
  priority: Priority;
  title: string;
  description: string;
  lat: number | null;
  lng: number | null;
  ts: string;
  attended: boolean;
  attendedBy: string | null;
  attendedAt: string | null;
}

export interface AlertRule {
  id: string;
  name: string;
  type: string;
  typeLabel: string;
  threshold: number | null;
  geofenceId: string | null;
  geofenceName: string | null;
  vehicleIds: string[];
  recipients: string[];
  channels: ('inapp' | 'email' | 'push')[];
  priority: Priority;
  active: boolean;
}

export interface NotificationItem {
  id: string;
  alertId: string | null;
  channel: 'email' | 'push' | 'inapp';
  recipient: string;
  subject: string;
  body: string;
  status: string;
  createdAt: string;
}

export interface Trip {
  id: string;
  vehicleId: string;
  vehiclePlate?: string;
  vehicleType?: string;
  driverId: string | null;
  driverName?: string | null;
  startedAt: string;
  endedAt: string | null;
  distanceKm: number;
  maxSpeed: number;
  avgSpeed: number;
  movingMinutes: number;
  stoppedMinutes: number;
  points: number;
  status: 'open' | 'closed';
  alerts?: number;
}

export interface Report {
  id: string;
  name: string;
  type: 'trips' | 'alerts' | 'usage' | 'full';
  typeLabel: string;
  format: 'pdf' | 'xlsx';
  vehicleId: string | null;
  vehiclePlate: string | null;
  driverId: string | null;
  driverName: string | null;
  periodStart: string;
  periodEnd: string;
  summary: {
    trips?: number;
    km?: number;
    alerts?: number;
    movingHours?: number;
    vehicles?: number;
    maxSpeed?: number;
  };
  sizeBytes: number;
  version: number;
  generatedAt: string;
  createdBy: string | null;
  activeShares: number;
}

export interface Plan {
  id: string;
  code: 'basico' | 'pro' | 'flota';
  name: string;
  description: string;
  priceCop: number;
  maxVehicles: number;
  maxUsers: number;
  features: string[];
}

export interface Subscription {
  id: string;
  status: 'trialing' | 'active' | 'past_due' | 'canceled';
  startedAt: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  canceledAt: string | null;
  cancelReason: string | null;
  plan: Plan;
  usage: { vehicles: number; users: number; devices: number };
}

export interface Invoice {
  id: string;
  number: string;
  planName: string;
  amountCop: number;
  taxCop: number;
  totalCop: number;
  status: 'paid' | 'pending' | 'void';
  periodStart: string;
  periodEnd: string;
  issuedAt: string;
  dueAt: string;
  paidAt: string | null;
}

export interface Ticket {
  id: string;
  number: number;
  companyId: string;
  companyName: string;
  subject: string;
  description: string;
  category: string;
  priority: Priority;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  createdBy: string;
  assignedTo: string | null;
  comments: number;
  createdAt: string;
  updatedAt: string;
  thread?: { id: string; author: string; isAgent: boolean; body: string; createdAt: string }[];
}

/** Ubicación del celular del conductor (Geolocation API del navegador). */
export interface DriverLocation {
  lat: number;
  lng: number;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  sharing: boolean;
  ts: string;
}

/** Marcador de conductor en el mapa del administrador. */
export interface DriverMarker extends DriverLocation {
  driverId: string;
  name: string;
  phone: string;
  status: string;
  shiftActive: boolean;
  vehiclePlate: string | null;
}

export interface LivePosition extends LiveState {
  vehicleId: string;
  plate: string;
  type: VehicleType;
  deviceId: string;
  driverName: string | null;
  connection: 'online' | 'offline';
}
