import { inject } from '@angular/core';
import { Router, Routes } from '@angular/router';
import { Auth, authGuard, guestGuard, permGuard } from './core/auth.service';
import { ShellComponent } from './layout/shell.component';

/** Rutas con carga diferida por funcionalidad (lazy loading). */
export const routes: Routes = [
  {
    path: 'login',
    canActivate: [guestGuard],
    title: 'Iniciar sesión · WMS',
    loadComponent: () => import('./features/auth/login.page').then((m) => m.LoginPage),
  },
  {
    path: 'registro',
    canActivate: [guestGuard],
    title: 'Crear cuenta · WMS',
    loadComponent: () => import('./features/auth/signup.page').then((m) => m.SignupPage),
  },
  {
    path: 'recuperar',
    title: 'Recuperar contraseña · WMS',
    loadComponent: () => import('./features/auth/forgot.page').then((m) => m.ForgotPage),
  },
  {
    path: 'restablecer',
    title: 'Nueva contraseña · WMS',
    loadComponent: () => import('./features/auth/reset.page').then((m) => m.ResetPage),
  },
  {
    path: 'compartido/:token',
    title: 'Reporte compartido · WMS',
    loadComponent: () =>
      import('./features/reports/shared-report.page').then((m) => m.SharedReportPage),
  },
  {
    path: '',
    component: ShellComponent,
    canActivate: [authGuard],
    children: [
      {
        path: '',
        pathMatch: 'full',
        canActivate: [() => inject(Router).createUrlTree([inject(Auth).home()])],
        children: [],
      },
      {
        path: 'inicio',
        title: 'Inicio · WMS',
        canActivate: [permGuard('dashboard')],
        loadComponent: () =>
          import('./features/dashboard/dashboard.page').then((m) => m.DashboardPage),
      },
      {
        path: 'mapa',
        title: 'Mapa en vivo · WMS',
        canActivate: [permGuard('map')],
        loadComponent: () => import('./features/map/live-map.page').then((m) => m.LiveMapPage),
      },
      {
        path: 'mi-turno',
        title: 'Mi turno · WMS',
        canActivate: [permGuard(null, ['driver'])],
        loadComponent: () => import('./features/driver/my-shift.page').then((m) => m.MyShiftPage),
      },
      {
        path: 'vehiculos',
        title: 'Vehículos · WMS',
        canActivate: [permGuard('vehicles')],
        loadComponent: () =>
          import('./features/vehicles/vehicles.page').then((m) => m.VehiclesPage),
      },
      {
        path: 'conductores',
        title: 'Conductores · WMS',
        canActivate: [permGuard('drivers')],
        loadComponent: () => import('./features/drivers/drivers.page').then((m) => m.DriversPage),
      },
      {
        path: 'dispositivos',
        title: 'Dispositivos GPS · WMS',
        canActivate: [permGuard('devices')],
        loadComponent: () => import('./features/devices/devices.page').then((m) => m.DevicesPage),
      },
      {
        path: 'geocercas',
        title: 'Geocercas · WMS',
        canActivate: [permGuard('geofences')],
        loadComponent: () =>
          import('./features/geofences/geofences.page').then((m) => m.GeofencesPage),
      },
      {
        path: 'alertas',
        title: 'Alertas · WMS',
        canActivate: [permGuard('alerts')],
        loadComponent: () => import('./features/alerts/alerts.page').then((m) => m.AlertsPage),
      },
      {
        path: 'reportes',
        title: 'Reportes · WMS',
        canActivate: [permGuard('reports')],
        loadComponent: () => import('./features/reports/reports.page').then((m) => m.ReportsPage),
      },
      {
        path: 'usuarios',
        title: 'Usuarios y permisos · WMS',
        canActivate: [permGuard('users')],
        loadComponent: () => import('./features/users/users.page').then((m) => m.UsersPage),
      },
      {
        path: 'suscripcion',
        title: 'Suscripción · WMS',
        canActivate: [permGuard('billing')],
        loadComponent: () => import('./features/billing/billing.page').then((m) => m.BillingPage),
      },
      {
        path: 'soporte',
        title: 'Soporte · WMS',
        canActivate: [permGuard('support')],
        loadComponent: () => import('./features/support/support.page').then((m) => m.SupportPage),
      },
      {
        path: 'ajustes',
        title: 'Ajustes · WMS',
        loadComponent: () =>
          import('./features/settings/settings.page').then((m) => m.SettingsPage),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
