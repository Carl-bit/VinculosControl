import { Injectable, Logger } from '@nestjs/common';
import { Cron, Interval } from '@nestjs/schedule';

import { PrismaService } from '../comun/prisma.service';
import { evaluar, type Estado, type EstadoSilo } from './reglas';

/** Dias que se guardan las series (salud, contenedores, host, latencias). */
const RETENCION_DIAS = 7;

@Injectable()
export class AlertasService {
  private readonly log = new Logger(AlertasService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Cada 30 s: arma el ultimo estado, evalua las reglas y abre o cierra alertas. */
  @Interval(30_000)
  async revisar(): Promise<void> {
    const activas = evaluar(await this.estado());
    const abiertas = await this.prisma.alerta.findMany({ where: { cerradaEn: null } });
    const claves = new Set(activas.map((a) => a.clave));
    const yaAbiertas = new Set(abiertas.map((a) => a.clave));
    const cerrar = abiertas.filter((a) => !claves.has(a.clave)).map((a) => a.id);
    const nuevas = activas.filter((a) => !yaAbiertas.has(a.clave));
    if (cerrar.length) await this.prisma.alerta.updateMany({ where: { id: { in: cerrar } }, data: { cerradaEn: new Date() } });
    if (nuevas.length) {
      await this.prisma.alerta.createMany({ data: nuevas });
      for (const a of nuevas) this.log.warn(`${a.severidad} ${a.clave}: ${a.mensaje}`);
    }
  }

  async estado(): Promise<Estado> {
    const [agente, host, silos] = await Promise.all([
      this.prisma.agente.findFirst({ orderBy: { id: 'asc' } }),
      this.prisma.metricaHost.findFirst({ orderBy: { en: 'desc' } }),
      this.prisma.silo.findMany({ where: { adoptado: true } }),
    ]);
    return {
      ahora: new Date(),
      agente: agente && { nombre: agente.nombre, ultimoLatido: agente.ultimoLatido },
      host: host && { discoPct: host.discoPct },
      silos: await Promise.all(silos.map((s) => this.estadoSilo(s.slug))),
    };
  }

  private async estadoSilo(slug: string): Promise<EstadoSilo> {
    const [salud, ultimo, respaldo] = await Promise.all([
      this.prisma.muestraSalud.findMany({ where: { slug }, orderBy: { en: 'desc' }, take: 2 }),
      this.prisma.metricaContenedor.findFirst({ where: { slug }, orderBy: { en: 'desc' }, select: { en: true } }),
      this.prisma.respaldo.findUnique({ where: { slug } }),
    ]);
    if (!ultimo) return { slug, salud, contenedores: [], latencias: [], respaldo };
    const [actuales, previo, latencias] = await Promise.all([
      this.prisma.metricaContenedor.findMany({ where: { slug, en: ultimo.en } }),
      this.prisma.metricaContenedor.findFirst({ where: { slug, en: { lt: ultimo.en } }, orderBy: { en: 'desc' }, select: { en: true } }),
      this.prisma.latenciaRuta.findMany({ where: { slug, en: ultimo.en } }),
    ]);
    const anteriores = previo ? await this.prisma.metricaContenedor.findMany({ where: { slug, en: previo.en } }) : [];
    return {
      slug,
      salud,
      contenedores: actuales.map((c) => ({
        servicio: c.servicio,
        memBytes: Number(c.memBytes),
        memLimite: Number(c.memLimite),
        reinicios: c.reinicios,
        reiniciosPrevios: anteriores.find((a) => a.servicio === c.servicio)?.reinicios ?? null,
        oom: c.oom,
        estado: c.estado,
      })),
      latencias,
      respaldo,
    };
  }

  /** 04:00 de cada dia: borra series viejas y alertas cerradas hace mas de 90 dias. */
  @Cron('0 4 * * *')
  async podar(): Promise<void> {
    const limite = new Date(Date.now() - RETENCION_DIAS * 86_400_000);
    const where = { en: { lt: limite } };
    await this.prisma.$transaction([
      this.prisma.muestraSalud.deleteMany({ where }),
      this.prisma.metricaContenedor.deleteMany({ where }),
      this.prisma.metricaHost.deleteMany({ where }),
      this.prisma.latenciaRuta.deleteMany({ where }),
      this.prisma.alerta.deleteMany({ where: { cerradaEn: { lt: new Date(Date.now() - 90 * 86_400_000) } } }),
    ]);
  }
}
