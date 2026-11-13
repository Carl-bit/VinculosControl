import { Controller, Get, HttpCode, NotFoundException, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';

import type { OperadorSesion } from '../acceso/acceso.service';
import { IpCliente, Operador, SesionGuard } from '../acceso/sesion.guard';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { num, PrismaService } from '../comun/prisma.service';
import { AlertasService } from '../alertas/alertas.service';
import { SaludService } from '../salud/salud.service';
import { ConsolaGuard } from './consola.guard';

const SLUG = /^[a-z0-9-]{1,40}$/;

@Controller('consola')
@UseGuards(ConsolaGuard, SesionGuard)
export class ConsolaController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alertas: AlertasService,
    private readonly salud: SaludService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /** Vista principal: agente, host, cada silo con su ultimo estado y las alertas abiertas. */
  @Get('resumen')
  async resumen() {
    const [agente, host, silos, alertas, solicitudesNuevas, jobsActivos, incidentesAbiertos, eventos] = await Promise.all([
      this.prisma.agente.findFirst({ orderBy: { id: 'asc' }, select: { nombre: true, version: true, ultimoLatido: true } }),
      this.prisma.metricaHost.findFirst({ orderBy: { en: 'desc' } }),
      this.prisma.silo.findMany({ orderBy: [{ adoptado: 'desc' }, { slug: 'asc' }] }),
      this.prisma.alerta.findMany({ where: { cerradaEn: null }, orderBy: [{ severidad: 'asc' }, { abiertaEn: 'desc' }] }),
      this.prisma.centro.count({ where: { estado: 'SOLICITUD' } }),
      this.prisma.job.count({ where: { estado: { in: ['PENDIENTE', 'EN_CURSO', 'ESPERANDO_LLAVES'] } } }),
      this.prisma.incidente.count({ where: { cerradoEn: null } }),
      // Eventos recientes para el Resumen (sin los de acceso, que son ruido aqui).
      this.prisma.eventoAuditoria.findMany({ where: { NOT: { accion: { startsWith: 'auth.' } } }, orderBy: { id: 'desc' }, take: 6 }),
    ]);
    return {
      agente,
      host: host && { en: host.en, discoPct: host.discoPct, memUsada: num(host.memUsada), memTotal: num(host.memTotal), carga1: host.carga1, cpus: host.cpus },
      silos: await Promise.all(silos.map((s) => this.fila(s))),
      alertas,
      solicitudesNuevas,
      jobsActivos,
      incidentesAbiertos,
      eventos: eventos.map((e) => ({ ...e, id: e.id.toString() })),
    };
  }

  /** Detalle con series: salud y contenedores de las ultimas `horas` (1 a 168), latencias del ultimo reporte. */
  @Get('silos/:slug')
  async detalle(@Param('slug') slug: string, @Query('horas', new ParseIntPipe({ optional: true })) horas = 24) {
    const silo = SLUG.test(slug) ? await this.prisma.silo.findUnique({ where: { slug } }) : null;
    if (!silo) throw new NotFoundException();
    const desde = new Date(Date.now() - Math.min(Math.max(horas, 1), 168) * 3_600_000);
    const [salud, contenedores, ultimo, alertas, centro, jobs] = await Promise.all([
      this.prisma.muestraSalud.findMany({ where: { slug, en: { gte: desde } }, orderBy: { en: 'asc' }, select: { en: true, ok: true, http: true, latenciaMs: true } }),
      this.prisma.metricaContenedor.findMany({ where: { slug, en: { gte: desde } }, orderBy: { en: 'asc' } }),
      this.prisma.latenciaRuta.findFirst({ where: { slug }, orderBy: { en: 'desc' }, select: { en: true } }),
      this.prisma.alerta.findMany({ where: { slug }, orderBy: { abiertaEn: 'desc' }, take: 50 }),
      // Centro y manifiesto aprobado del silo (si nacio de una solicitud) y sus ultimos jobs.
      this.prisma.centro.findUnique({ where: { slug }, select: { id: true, nombre: true, estado: true, revisionAprobada: true, hashAprobado: true } }),
      this.prisma.job.findMany({ where: { siloSlug: slug }, orderBy: { creadoEn: 'desc' }, take: 8, select: { id: true, tipo: true, estado: true, creadoEn: true, creadoPor: true } }),
    ]);
    const latencias = ultimo ? await this.prisma.latenciaRuta.findMany({ where: { slug, en: ultimo.en }, orderBy: { p95: 'desc' } }) : [];
    return {
      ...(await this.fila(silo)),
      salud,
      contenedores: contenedores.map((c) => ({ en: c.en, servicio: c.servicio, cpuPct: c.cpuPct, memBytes: num(c.memBytes), memLimite: num(c.memLimite) })),
      latencias: latencias.map(({ ruta, n, p50, p95, max }) => ({ ruta, n, p50, p95, max })),
      alertas,
      centro,
      jobs,
    };
  }

  /** Empieza a vigilar un stack descubierto: sondeo de /api/salud y reglas de alerta. */
  @Post('silos/:slug/adoptar')
  @HttpCode(204)
  async adoptar(@Param('slug') slug: string, @Operador() op: OperadorSesion, @IpCliente() ip: string | null): Promise<void> {
    const silo = await this.cambiar(slug, { adoptado: true, adoptadoEn: new Date() });
    await this.auditoria.registrar(op.correo, 'silo.adoptado', slug, ip);
    if (silo.dominio) await this.salud.sondear(slug, silo.dominio);
    await this.alertas.revisar();
  }

  @Post('silos/:slug/soltar')
  @HttpCode(204)
  async soltar(@Param('slug') slug: string, @Operador() op: OperadorSesion, @IpCliente() ip: string | null): Promise<void> {
    await this.cambiar(slug, { adoptado: false, adoptadoEn: null });
    await this.auditoria.registrar(op.correo, 'silo.soltado', slug, ip);
    await this.alertas.revisar();
  }

  @Get('alertas')
  async historial(@Query('limite', new ParseIntPipe({ optional: true })) limite = 100) {
    return this.prisma.alerta.findMany({ orderBy: { abiertaEn: 'desc' }, take: Math.min(Math.max(limite, 1), 500) });
  }

  private async cambiar(slug: string, data: { adoptado: boolean; adoptadoEn: Date | null }) {
    if (!SLUG.test(slug)) throw new NotFoundException();
    return this.prisma.silo.update({ where: { slug }, data }).catch(() => {
      throw new NotFoundException();
    });
  }

  private async fila(s: { slug: string; dominio: string | null; adoptado: boolean; vistoEn: Date | null }) {
    const [salud, ultimo, respaldo] = await Promise.all([
      this.prisma.muestraSalud.findFirst({ where: { slug: s.slug }, orderBy: { en: 'desc' } }),
      this.prisma.metricaContenedor.findFirst({ where: { slug: s.slug }, orderBy: { en: 'desc' }, select: { en: true } }),
      this.prisma.respaldo.findUnique({ where: { slug: s.slug } }),
    ]);
    const [contenedores, p95] = ultimo
      ? await Promise.all([
          this.prisma.metricaContenedor.findMany({ where: { slug: s.slug, en: ultimo.en }, orderBy: { servicio: 'asc' } }),
          this.prisma.latenciaRuta.aggregate({ where: { slug: s.slug, en: ultimo.en }, _max: { p95: true } }),
        ])
      : [[], null];
    return {
      ...s,
      salud: salud && { en: salud.en, ok: salud.ok, http: salud.http, bd: salud.bd, canarios: salud.canarios, latenciaMs: salud.latenciaMs, error: salud.error },
      contenedores: contenedores.map((c) => ({
        servicio: c.servicio,
        estado: c.estado,
        cpuPct: c.cpuPct,
        memBytes: num(c.memBytes),
        memLimite: num(c.memLimite),
        reinicios: c.reinicios,
        oom: c.oom,
      })),
      p95Max: p95?._max.p95 ?? null,
      respaldo: respaldo && { archivo: respaldo.archivo, fecha: respaldo.fecha, bytes: num(respaldo.bytes), sha256: respaldo.sha256 },
    };
  }
}
