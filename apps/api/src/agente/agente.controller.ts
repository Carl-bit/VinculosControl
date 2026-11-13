import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';

import { PrismaService } from '../comun/prisma.service';
import { AgenteGuard } from './agente.guard';
import { LatidoDto, ReporteDto } from './reporte.dto';

type ConAgente = Request & { agenteId: number };

@Controller('agente')
@UseGuards(AgenteGuard)
export class AgenteController {
  constructor(private readonly prisma: PrismaService) {}

  @Post('latido')
  @HttpCode(204)
  async latido(@Req() req: ConAgente, @Body() dto: LatidoDto): Promise<void> {
    await this.prisma.agente.update({ where: { id: req.agenteId }, data: { ultimoLatido: new Date(), version: dto.version } });
  }

  /** Un reporte por minuto: todas sus filas llevan la misma marca `en` (asi la consola toma "el ultimo reporte"). */
  @Post('reporte')
  @HttpCode(204)
  async reporte(@Req() req: ConAgente, @Body() dto: ReporteDto): Promise<void> {
    const en = new Date();
    await this.prisma.$transaction([
      this.prisma.agente.update({ where: { id: req.agenteId }, data: { ultimoLatido: en } }),
      this.prisma.metricaHost.create({ data: { en, ...dto.host, memUsada: BigInt(dto.host.memUsada), memTotal: BigInt(dto.host.memTotal) } }),
      ...dto.silos.map((s) =>
        this.prisma.silo.upsert({
          where: { slug: s.slug },
          create: { slug: s.slug, dominio: s.dominio, vistoEn: en },
          update: { dominio: s.dominio, vistoEn: en },
        }),
      ),
      this.prisma.metricaContenedor.createMany({
        data: dto.silos.flatMap((s) =>
          s.contenedores.map((c) => ({ ...c, slug: s.slug, en, memBytes: BigInt(c.memBytes), memLimite: BigInt(c.memLimite) })),
        ),
      }),
      this.prisma.latenciaRuta.createMany({ data: dto.silos.flatMap((s) => s.latencias.map((l) => ({ ...l, slug: s.slug, en }))) }),
      ...dto.silos.flatMap((s) =>
        s.respaldo
          ? [
              this.prisma.respaldo.upsert({
                where: { slug: s.slug },
                create: { slug: s.slug, ...s.respaldo, fecha: new Date(s.respaldo.fecha), bytes: BigInt(s.respaldo.bytes) },
                update: { ...s.respaldo, fecha: new Date(s.respaldo.fecha), bytes: BigInt(s.respaldo.bytes), vistoEn: en },
              }),
            ]
          : [],
      ),
    ]);
  }
}
