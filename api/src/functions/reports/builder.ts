import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { all, get } from '../../shared/db';
import { ALERT_TYPE_LABELS, AlertType } from '../../shared/repositories/alerts';
import { TripDto, trackingRepo } from '../../shared/repositories/tracking';

export interface ReportParams {
  name: string;
  type: 'trips' | 'alerts' | 'usage' | 'full';
  format: 'pdf' | 'xlsx';
  vehicleId?: string | null;
  driverId?: string | null;
  periodStart: string;
  periodEnd: string;
}

export const REPORT_TYPE_LABELS: Record<ReportParams['type'], string> = {
  trips: 'Recorridos',
  alerts: 'Alertas',
  usage: 'Uso de vehículos',
  full: 'Informe completo',
};

const PRIORITY_LABELS: Record<string, string> = {
  low: 'Baja',
  medium: 'Media',
  high: 'Alta',
  critical: 'Crítica',
};
const TYPE_LABELS: Record<string, string> = {
  moto: 'Moto',
  carro: 'Carro',
  camion: 'Camión',
  furgon: 'Furgón',
};

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString('es-CO', {
    timeZone: 'America/Bogota',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'long' });
const fmtNum = (n: number, d = 1) =>
  n.toLocaleString('es-CO', { maximumFractionDigits: d, minimumFractionDigits: 0 });

/** Reúne los datos del reporte filtrados por tenant, vehículo, conductor y periodo. */
export function collectReportData(tenantId: string, p: ReportParams) {
  const company = get<any>(`SELECT name, nit FROM companies WHERE id=@id`, { id: tenantId });
  const vehicle = p.vehicleId
    ? get<any>(`SELECT plate, type FROM vehicles WHERE id=@id AND company_id=@cid`, {
        id: p.vehicleId,
        cid: tenantId,
      })
    : null;
  const driver = p.driverId
    ? get<any>(`SELECT name FROM users WHERE id=@id AND company_id=@cid`, { id: p.driverId, cid: tenantId })
    : null;

  const trips: TripDto[] = trackingRepo
    .trips(tenantId, {
      vehicleId: p.vehicleId ?? undefined,
      driverId: p.driverId ?? undefined,
      from: p.periodStart,
      to: p.periodEnd,
      limit: 5000,
    })
    .reverse();

  const alerts = all<any>(
    `SELECT a.*, v.plate FROM alerts a LEFT JOIN vehicles v ON v.id = a.vehicle_id
     WHERE a.company_id=@cid AND a.ts BETWEEN @from AND @to
       AND (@vehicle IS NULL OR a.vehicle_id=@vehicle)
       AND (@driver IS NULL OR a.trip_id IN (SELECT id FROM trips WHERE driver_id=@driver))
     ORDER BY a.ts`,
    {
      cid: tenantId,
      from: p.periodStart,
      to: p.periodEnd,
      vehicle: p.vehicleId ?? null,
      driver: p.driverId ?? null,
    },
  ).map((a) => ({
    ts: a.ts,
    plate: a.plate ?? '—',
    type: ALERT_TYPE_LABELS[a.type as AlertType] ?? a.type,
    priority: PRIORITY_LABELS[a.priority] ?? a.priority,
    title: a.title,
    attended: !!a.attended,
  }));

  const usageMap = new Map<
    string,
    {
      plate: string;
      type: string;
      trips: number;
      km: number;
      movingMin: number;
      stoppedMin: number;
      maxSpeed: number;
      alerts: number;
    }
  >();
  for (const t of trips) {
    const u = usageMap.get(t.vehicleId) ?? {
      plate: t.vehiclePlate ?? '',
      type: t.vehicleType ?? '',
      trips: 0,
      km: 0,
      movingMin: 0,
      stoppedMin: 0,
      maxSpeed: 0,
      alerts: 0,
    };
    u.trips++;
    u.km += t.distanceKm;
    u.movingMin += t.movingMinutes;
    u.stoppedMin += t.stoppedMinutes;
    u.maxSpeed = Math.max(u.maxSpeed, t.maxSpeed);
    usageMap.set(t.vehicleId, u);
  }
  for (const a of alerts) {
    for (const u of usageMap.values()) if (u.plate === a.plate) u.alerts++;
  }
  const usage = [...usageMap.values()]
    .map((u) => ({
      ...u,
      km: Math.round(u.km * 10) / 10,
      avgSpeed: u.movingMin > 0 ? Math.round(u.km / (u.movingMin / 60)) : 0,
    }))
    .sort((a, b) => b.km - a.km);

  const summary = {
    trips: trips.length,
    km: Math.round(trips.reduce((s, t) => s + t.distanceKm, 0) * 10) / 10,
    movingHours: Math.round((trips.reduce((s, t) => s + t.movingMinutes, 0) / 60) * 10) / 10,
    alerts: alerts.length,
    criticalAlerts: alerts.filter((a) => a.priority === 'Crítica' || a.priority === 'Alta').length,
    vehicles: usage.length,
    maxSpeed: trips.reduce((m, t) => Math.max(m, t.maxSpeed), 0),
  };

  // Trayecto del recorrido más largo para el mini mapa vectorial del PDF
  const longest = [...trips].sort((a, b) => b.distanceKm - a.distanceKm)[0];
  const sample = longest
    ? trackingRepo.tripPositions(tenantId, longest.id).map((r: any) => [r.lat, r.lng] as [number, number])
    : [];

  return {
    company: company?.name ?? '',
    nit: company?.nit ?? '',
    filters: {
      vehicle: vehicle
        ? `${vehicle.plate} (${TYPE_LABELS[vehicle.type] ?? vehicle.type})`
        : 'Todos los vehículos',
      driver: driver?.name ?? 'Todos los conductores',
      period: `${fmtDay(p.periodStart)} – ${fmtDay(p.periodEnd)}`,
    },
    trips,
    alerts,
    usage,
    summary,
    sample: { plate: longest?.vehiclePlate ?? '', points: sample },
  };
}

export type ReportData = ReturnType<typeof collectReportData>;

/* ------------------------------ PDF ------------------------------ */

const C = {
  ink: '#1D1D1F',
  gray: '#6E6E73',
  light: '#F5F5F7',
  sep: '#E5E5EA',
  blue: '#007AFF',
  green: '#34C759',
  orange: '#FF9500',
  red: '#FF3B30',
  purple: '#AF52DE',
};

export function buildPdf(p: ReportParams, d: ReportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 48,
      bufferPages: true,
      info: { Title: p.name, Author: 'WMS – Monitoreo de flotas', Subject: REPORT_TYPE_LABELS[p.type] },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = doc.page.width - 96;
    const left = 48;

    // Encabezado
    doc.roundedRect(left, 40, 30, 30, 8).fill(C.blue);
    doc
      .fillColor('#FFFFFF')
      .font('Helvetica-Bold')
      .fontSize(13)
      .text('W', left, 49, { width: 30, align: 'center' });
    doc
      .fillColor(C.gray)
      .font('Helvetica')
      .fontSize(9)
      .text('WMS · Monitoreo y gestión de flotas', left + 40, 44);
    doc
      .fillColor(C.gray)
      .fontSize(9)
      .text(`${d.company}${d.nit ? ` · NIT ${d.nit}` : ''}`, left + 40, 57);
    doc
      .fillColor(C.gray)
      .fontSize(8)
      .text(`Generado: ${fmtDate(new Date().toISOString())}`, left, 48, { width: W, align: 'right' });

    doc.moveDown(2.2);
    doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(26).text(p.name, left, 96, { width: W });
    doc
      .fillColor(C.gray)
      .font('Helvetica')
      .fontSize(11)
      .text(`${REPORT_TYPE_LABELS[p.type]} · ${d.filters.period}`, { width: W });
    doc.fontSize(10).text(`${d.filters.vehicle} · ${d.filters.driver}`, { width: W });

    // Tarjetas KPI
    const kpis: [string, string, string][] = [
      ['Kilómetros', fmtNum(d.summary.km), C.blue],
      ['Recorridos', fmtNum(d.summary.trips, 0), C.green],
      ['Horas en movimiento', fmtNum(d.summary.movingHours), C.purple],
      ['Alertas', fmtNum(d.summary.alerts, 0), d.summary.criticalAlerts ? C.red : C.orange],
    ];
    const cardY = doc.y + 18;
    const cw = (W - 3 * 10) / 4;
    kpis.forEach(([label, value, color], i) => {
      const x = left + i * (cw + 10);
      doc.roundedRect(x, cardY, cw, 64, 12).fill(C.light);
      doc.circle(x + 16, cardY + 18, 4).fill(color);
      doc
        .fillColor(C.gray)
        .font('Helvetica')
        .fontSize(8.5)
        .text(label, x + 26, cardY + 14, { width: cw - 30 });
      doc
        .fillColor(C.ink)
        .font('Helvetica-Bold')
        .fontSize(20)
        .text(value, x + 14, cardY + 32, { width: cw - 24 });
    });
    doc.y = cardY + 84;

    // Mini mapa vectorial del recorrido más largo
    if ((p.type === 'trips' || p.type === 'full') && d.sample.points.length > 2) {
      const mapH = 150;
      const y0 = doc.y;
      doc.roundedRect(left, y0, W, mapH, 14).fill(C.light);
      const lats = d.sample.points.map((x) => x[0]);
      const lngs = d.sample.points.map((x) => x[1]);
      const [minLat, maxLat, minLng, maxLng] = [
        Math.min(...lats),
        Math.max(...lats),
        Math.min(...lngs),
        Math.max(...lngs),
      ];
      const pad = 18;
      const sx = (W - 2 * pad) / Math.max(1e-6, maxLng - minLng);
      const sy = (mapH - 2 * pad) / Math.max(1e-6, maxLat - minLat);
      const s = Math.min(sx, sy);
      const ox = left + pad + (W - 2 * pad - (maxLng - minLng) * s) / 2;
      const oy = y0 + pad + (mapH - 2 * pad - (maxLat - minLat) * s) / 2;
      const toXY = ([la, ln]: [number, number]) => [ox + (ln - minLng) * s, oy + (maxLat - la) * s] as const;
      const step = Math.max(1, Math.floor(d.sample.points.length / 600));
      d.sample.points.forEach((pt, i) => {
        if (i % step !== 0) return;
        const [x, y] = toXY(pt);
        if (i === 0) doc.moveTo(x, y);
        else doc.lineTo(x, y);
      });
      doc.lineWidth(3).lineJoin('round').lineCap('round').strokeColor(C.blue).stroke();
      const [sx0, sy0] = toXY(d.sample.points[0]);
      const [sx1, sy1] = toXY(d.sample.points[d.sample.points.length - 1]);
      doc.circle(sx0, sy0, 5).fill(C.green);
      doc.circle(sx1, sy1, 5).fill(C.red);
      doc
        .fillColor(C.gray)
        .font('Helvetica')
        .fontSize(8)
        .text(`Recorrido más largo · ${d.sample.plate} · trazado sobre datos GPS`, left + 12, y0 + mapH - 16);
      doc.y = y0 + mapH + 18;
    }

    const table = (title: string, headers: string[], widths: number[], rows: string[][], empty: string) => {
      if (doc.y > doc.page.height - 140) doc.addPage();
      doc
        .fillColor(C.ink)
        .font('Helvetica-Bold')
        .fontSize(15)
        .text(title, left, doc.y + 6);
      doc.moveDown(0.5);
      const drawHeader = () => {
        let x = left;
        const y = doc.y;
        doc.font('Helvetica-Bold').fontSize(8).fillColor(C.gray);
        headers.forEach((h, i) => {
          doc.text(h.toUpperCase(), x + 4, y, { width: widths[i] - 8 });
          x += widths[i];
        });
        doc.y = y + 14;
        doc
          .moveTo(left, doc.y)
          .lineTo(left + W, doc.y)
          .lineWidth(0.5)
          .strokeColor(C.sep)
          .stroke();
        doc.y += 4;
      };
      drawHeader();
      if (!rows.length) {
        doc
          .font('Helvetica')
          .fontSize(9)
          .fillColor(C.gray)
          .text(empty, left + 4, doc.y + 4);
        doc.moveDown(1.5);
        return;
      }
      rows.forEach((r, ri) => {
        if (doc.y > doc.page.height - 70) {
          doc.addPage();
          drawHeader();
        }
        const y = doc.y;
        if (ri % 2 === 1) doc.rect(left, y - 2, W, 16).fill(C.light);
        let x = left;
        doc.font('Helvetica').fontSize(8.5).fillColor(C.ink);
        r.forEach((cell, i) => {
          doc.text(cell, x + 4, y + 1, {
            width: widths[i] - 8,
            height: 12,
            ellipsis: true,
            lineBreak: false,
          });
          x += widths[i];
        });
        doc.y = y + 16;
      });
      doc.moveDown(1);
    };

    if (p.type === 'usage' || p.type === 'full') {
      table(
        'Uso por vehículo',
        ['Vehículo', 'Tipo', 'Recorridos', 'Km', 'Horas mov.', 'Vel. prom.', 'Vel. máx.', 'Alertas'],
        [70, 60, 60, 55, 60, 60, 60, W - 425],
        d.usage.map((u) => [
          u.plate,
          TYPE_LABELS[u.type] ?? u.type,
          String(u.trips),
          fmtNum(u.km),
          fmtNum(u.movingMin / 60),
          `${u.avgSpeed} km/h`,
          `${u.maxSpeed} km/h`,
          String(u.alerts),
        ]),
        'Sin actividad en el periodo.',
      );
    }
    if (p.type === 'trips' || p.type === 'full') {
      table(
        'Recorridos',
        ['Inicio', 'Fin', 'Vehículo', 'Conductor', 'Km', 'Vel. máx.', 'Alertas'],
        [100, 100, 60, 100, 45, 55, W - 460],
        d.trips
          .slice(0, 400)
          .map((t) => [
            fmtDate(t.startedAt),
            t.endedAt ? fmtDate(t.endedAt) : 'En curso',
            t.vehiclePlate ?? '',
            t.driverName ?? '—',
            fmtNum(t.distanceKm),
            `${t.maxSpeed} km/h`,
            String(t.alerts ?? 0),
          ]),
        'No hay recorridos en el periodo seleccionado.',
      );
    }
    if (p.type === 'alerts' || p.type === 'full') {
      table(
        'Alertas',
        ['Fecha', 'Vehículo', 'Tipo', 'Prioridad', 'Detalle', 'Estado'],
        [100, 60, 95, 55, W - 370, 60],
        d.alerts
          .slice(0, 500)
          .map((a) => [
            fmtDate(a.ts),
            a.plate,
            a.type,
            a.priority,
            a.title,
            a.attended ? 'Atendida' : 'Abierta',
          ]),
        'No se registraron alertas en el periodo.',
      );
    }

    // Pie de página en todas las hojas
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc
        .fillColor(C.gray)
        .font('Helvetica')
        .fontSize(7.5)
        .text(
          `WMS · ${d.company} · Mapas y rutas © colaboradores de OpenStreetMap · Página ${i + 1} de ${range.count}`,
          left,
          doc.page.height - 34,
          { width: W, align: 'center', lineBreak: false },
        );
    }
    doc.end();
  });
}

/* ------------------------------ Excel ------------------------------ */

export async function buildXlsx(p: ReportParams, d: ReportData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'WMS – Monitoreo de flotas';
  wb.created = new Date();
  const header = (ws: ExcelJS.Worksheet) => {
    const row = ws.getRow(1);
    row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF007AFF' } };
    row.alignment = { vertical: 'middle' };
    row.height = 22;
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    if (ws.columnCount > 0)
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
  };

  const s = wb.addWorksheet('Resumen');
  s.columns = [{ width: 32 }, { width: 50 }];
  s.addRow([p.name]).font = { bold: true, size: 18 };
  s.addRow([`${REPORT_TYPE_LABELS[p.type]} · ${d.company}`]).font = { color: { argb: 'FF6E6E73' } };
  s.addRow([]);
  const rows: [string, string | number][] = [
    ['Periodo', d.filters.period],
    ['Vehículo', d.filters.vehicle],
    ['Conductor', d.filters.driver],
    ['Kilómetros recorridos', d.summary.km],
    ['Recorridos', d.summary.trips],
    ['Horas en movimiento', d.summary.movingHours],
    ['Velocidad máxima (km/h)', d.summary.maxSpeed],
    ['Alertas', d.summary.alerts],
    ['Alertas altas/críticas', d.summary.criticalAlerts],
    ['Generado', fmtDate(new Date().toISOString())],
  ];
  rows.forEach(([k, v]) => {
    const r = s.addRow([k, v]);
    r.getCell(1).font = { bold: true };
  });
  s.addRow([]);
  s.addRow(['Mapas y rutas © colaboradores de OpenStreetMap']).font = {
    italic: true,
    color: { argb: 'FF8E8E93' },
  };

  if (p.type === 'usage' || p.type === 'full') {
    const ws = wb.addWorksheet('Uso por vehículo');
    ws.columns = [
      { header: 'Placa', key: 'plate', width: 12 },
      { header: 'Tipo', key: 'type', width: 12 },
      { header: 'Recorridos', key: 'trips', width: 12 },
      { header: 'Km', key: 'km', width: 10, style: { numFmt: '#,##0.0' } },
      { header: 'Horas en movimiento', key: 'hours', width: 20, style: { numFmt: '#,##0.0' } },
      { header: 'Minutos detenido', key: 'stopped', width: 18 },
      { header: 'Vel. promedio (km/h)', key: 'avg', width: 20 },
      { header: 'Vel. máxima (km/h)', key: 'max', width: 18 },
      { header: 'Alertas', key: 'alerts', width: 10 },
    ];
    d.usage.forEach((u) =>
      ws.addRow({
        plate: u.plate,
        type: TYPE_LABELS[u.type] ?? u.type,
        trips: u.trips,
        km: u.km,
        hours: Math.round((u.movingMin / 60) * 10) / 10,
        stopped: u.stoppedMin,
        avg: u.avgSpeed,
        max: u.maxSpeed,
        alerts: u.alerts,
      }),
    );
    header(ws);
  }
  if (p.type === 'trips' || p.type === 'full') {
    const ws = wb.addWorksheet('Recorridos');
    ws.columns = [
      { header: 'Inicio', key: 'start', width: 22 },
      { header: 'Fin', key: 'end', width: 22 },
      { header: 'Placa', key: 'plate', width: 10 },
      { header: 'Conductor', key: 'driver', width: 24 },
      { header: 'Km', key: 'km', width: 10, style: { numFmt: '#,##0.00' } },
      { header: 'Min. movimiento', key: 'moving', width: 16 },
      { header: 'Min. detenido', key: 'stopped', width: 14 },
      { header: 'Vel. máx. (km/h)', key: 'max', width: 16 },
      { header: 'Vel. prom. (km/h)', key: 'avg', width: 16 },
      { header: 'Alertas', key: 'alerts', width: 10 },
    ];
    d.trips.forEach((t) =>
      ws.addRow({
        start: fmtDate(t.startedAt),
        end: t.endedAt ? fmtDate(t.endedAt) : 'En curso',
        plate: t.vehiclePlate,
        driver: t.driverName ?? '—',
        km: t.distanceKm,
        moving: t.movingMinutes,
        stopped: t.stoppedMinutes,
        max: t.maxSpeed,
        avg: t.avgSpeed,
        alerts: t.alerts ?? 0,
      }),
    );
    header(ws);
  }
  if (p.type === 'alerts' || p.type === 'full') {
    const ws = wb.addWorksheet('Alertas');
    ws.columns = [
      { header: 'Fecha', key: 'ts', width: 22 },
      { header: 'Placa', key: 'plate', width: 10 },
      { header: 'Tipo', key: 'type', width: 24 },
      { header: 'Prioridad', key: 'priority', width: 12 },
      { header: 'Detalle', key: 'title', width: 60 },
      { header: 'Estado', key: 'state', width: 12 },
    ];
    d.alerts.forEach((a) =>
      ws.addRow({
        ts: fmtDate(a.ts),
        plate: a.plate,
        type: a.type,
        priority: a.priority,
        title: a.title,
        state: a.attended ? 'Atendida' : 'Abierta',
      }),
    );
    header(ws);
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

export async function buildReport(tenantId: string, p: ReportParams) {
  const data = collectReportData(tenantId, p);
  const content = p.format === 'pdf' ? await buildPdf(p, data) : await buildXlsx(p, data);
  return { content, summary: { ...data.summary, filters: data.filters } };
}
