import { Body, Controller, Get, HttpCode, Injectable, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsISO8601, IsOptional, IsUUID, Matches, Min, ValidateNested } from 'class-validator';

import { SesionGuard } from '../acceso/sesion.guard';
import { AgenteGuard } from '../agente/agente.guard';
import { PrismaService } from '../comun/prisma.service';
import { ConsolaGuard } from '../consola/consola.guard';

const SLUG = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/;
export const ESTADOS_EXPORTE = ['PENDIENTE', 'EN_PROCESO', 'LISTA', 'FALLIDA', 'DESCARGADA', 'VENCIDA'] as const;
/** Un exporte en estos estados bloquea ACTUALIZAR (ERP_REGLAS_Y_DESPLIEGUE.md). */
export const EN_CURSO = ['PENDIENTE', 'EN_PROCESO'];
/** Lectura de R13 vigente: el agente la repite cada minuto. */
export const VIGENCIA_MS = 10 * 60_000;

/* Lo que el agente trae de R13: solo metadatos (sin contenido, clave ni quien la pidio). */
class ExportacionDelSiloDto {
  @IsUUID()
  id!: string;

  @IsIn(ESTADOS_EXPORTE)
  estado!: string;

  @IsISO8601()
  creadaEn!: string;

  @IsOptional()
  @IsISO8601()
  terminadaEn?: string | null;

  @IsOptional()
  @IsISO8601()
  venceEn?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  bytes?: number | null;

  @IsOptional()
  @Matches(/^[0-9a-f]{64}$/)
  huella?: string | null;
}

class SincronizarExportacionesDto {
  @Matches(SLUG)
  slug!: string;

  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ExportacionDelSiloDto)
  exportaciones!: ExportacionDelSiloDto[];
}

/** R13: estado de las exportaciones de cada silo (lo informa el agente). */
@Injectable()
export class ExportacionesService {
  constructor(private readonly prisma: PrismaService) {}

  async sincronizar(slug: string, lista: ExportacionDelSiloDto[]): Promise<{ guardadas: number }> {
    const silo = await this.prisma.silo.findUnique({ where: { slug }, select: { slug: true } });
    if (!silo) return { guardadas: 0 };
    const en = new Date();
    const fecha = (x?: string | null) => (x ? new Date(x) : null);
    await this.prisma.$transaction([
      ...lista.map((e) => {
        const datos = { estado: e.estado, creadaEn: new Date(e.creadaEn), terminadaEn: fecha(e.terminadaEn), venceEn: fecha(e.venceEn), bytes: e.bytes == null ? null : BigInt(e.bytes), huella: e.huella ?? null, vistaEn: en };
        return this.prisma.exportacionSilo.upsert({ where: { siloSlug_id: { siloSlug: slug, id: e.id } }, create: { siloSlug: slug, id: e.id, ...datos }, update: datos });
      }),
      this.prisma.silo.update({ where: { slug }, data: { exportesVistoEn: en } }),
    ]);
    return { guardadas: lista.length };
  }

  /**
   * Si el silo informa R13 (lectura de hace menos de 10 min) y si tiene un
   * exporte en curso. Sin lectura vigente, ACTUALIZAR vuelve a pedir la
   * confirmacion del operador (silo con un ERP anterior a R13).
   */
  async estado(slug: string): Promise<{ informa: boolean; enCurso: { id: string; estado: string; creadaEn: Date } | null }> {
    const silo = await this.prisma.silo.findUnique({ where: { slug }, select: { exportesVistoEn: true } });
    const informa = !!silo?.exportesVistoEn && Date.now() - silo.exportesVistoEn.getTime() < VIGENCIA_MS;
    if (!informa) return { informa, enCurso: null };
    const e = await this.prisma.exportacionSilo.findFirst({ where: { siloSlug: slug, estado: { in: EN_CURSO }, vistaEn: { gte: silo!.exportesVistoEn! } }, orderBy: { creadaEn: 'desc' } });
    return { informa, enCurso: e ? { id: e.id, estado: e.estado, creadaEn: e.creadaEn } : null };
  }

  async listar(slug: string) {
    const silo = await this.prisma.silo.findUnique({ where: { slug }, select: { exportesVistoEn: true } });
    if (!silo) throw new NotFoundException({ mensaje: `No existe el silo ${slug}` });
    const filas = await this.prisma.exportacionSilo.findMany({ where: { siloSlug: slug }, orderBy: { creadaEn: 'desc' }, take: 20 });
    return {
      vistoEn: silo.exportesVistoEn,
      exportaciones: filas.map((e) => ({ id: e.id, estado: e.estado, creadaEn: e.creadaEn, terminadaEn: e.terminadaEn, venceEn: e.venceEn, bytes: e.bytes === null ? null : Number(e.bytes), huella: e.huella })),
    };
  }
}

/** Agente: R13 del silo -> plano de control. */
@Controller('agente/exportaciones')
@UseGuards(AgenteGuard)
export class ExportacionesAgenteController {
  constructor(private readonly exportaciones: ExportacionesService) {}

  @Post()
  @HttpCode(200)
  sincronizar(@Body() b: SincronizarExportacionesDto) {
    return this.exportaciones.sincronizar(b.slug, b.exportaciones);
  }
}

/** Consola: exportaciones informadas por un silo (la salida las usa en S3). */
@Controller('consola/silos')
@UseGuards(ConsolaGuard, SesionGuard)
export class ExportacionesConsolaController {
  constructor(private readonly exportaciones: ExportacionesService) {}

  @Get(':slug/exportaciones')
  listar(@Param('slug') slug: string) {
    if (!SLUG.test(slug)) throw new NotFoundException({ mensaje: 'Slug de silo invalido' });
    return this.exportaciones.listar(slug);
  }
}
