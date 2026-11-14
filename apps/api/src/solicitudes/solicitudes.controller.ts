import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsISO8601, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateNested } from 'class-validator';

import type { OperadorSesion } from '../acceso/acceso.service';
import { Operador, SesionGuard } from '../acceso/sesion.guard';
import { AgenteGuard } from '../agente/agente.guard';
import { ConsolaGuard } from '../consola/consola.guard';
import { DECISIONES, type Decision, ESTADOS, type EstadoSolicitud, MODULOS, ROLES } from './reglas';
import { SolicitudesService } from './solicitudes.service';

const SLUG = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/;

/* Lo que el agente trae de R2: solo metadatos (sin motivo ni quien la pidio). */
class SolicitudDelSiloDto {
  @IsUUID()
  id!: string;

  @IsIn(MODULOS)
  modulo!: string;

  @IsIn(['ACTIVAR', 'DESACTIVAR'])
  accion!: string;

  @IsIn(ROLES)
  pedidaPorRol!: string;

  @IsISO8601()
  pedidaEn!: string;

  @IsIn(ESTADOS)
  estado!: EstadoSolicitud;
}

class FallidaDto {
  @IsUUID()
  id!: string;

  /** Mensaje del silo al entregar R3 (sin datos personales: reglas de estado). */
  @IsString()
  @MaxLength(300)
  error!: string;
}

class SincronizarDto {
  @Matches(SLUG)
  slug!: string;

  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => SolicitudDelSiloDto)
  solicitudes!: SolicitudDelSiloDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => FallidaDto)
  fallidas?: FallidaDto[];
}

class DecisionDto {
  @IsIn(DECISIONES)
  estado!: Decision;

  /** Texto para el ADMIN del centro. Sin datos personales. */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  respuesta?: string;
}

/** Agente: R2 -> plano de control; responde las decisiones que debe entregar con R3. */
@Controller('agente/solicitudes')
@UseGuards(AgenteGuard)
export class SolicitudesAgenteController {
  constructor(private readonly solicitudes: SolicitudesService) {}

  @Post()
  @HttpCode(200)
  sincronizar(@Body() b: SincronizarDto) {
    return this.solicitudes.sincronizar(b.slug, b.solicitudes, b.fallidas ?? []);
  }
}

/** Consola: bandeja de solicitudes de modulos por silo. */
@Controller('consola/solicitudes-modulo')
@UseGuards(ConsolaGuard, SesionGuard)
export class SolicitudesConsolaController {
  constructor(private readonly solicitudes: SolicitudesService) {}

  @Get()
  listar(@Query('silo') silo?: string) {
    return this.solicitudes.listar(silo && SLUG.test(silo) ? silo : undefined);
  }

  @Post(':slug/:id/decision')
  @HttpCode(200)
  decidir(@Param('slug') slug: string, @Param('id') id: string, @Body() b: DecisionDto, @Operador() o: OperadorSesion) {
    return this.solicitudes.decidir(slug, id, b.estado, b.respuesta, o);
  }

  /** Aplicar una solicitud APROBADA con una revision nueva + job RECONFIGURAR (R4). */
  @Post(':slug/:id/aplicar')
  @HttpCode(200)
  aplicar(@Param('slug') slug: string, @Param('id') id: string, @Operador() o: OperadorSesion) {
    if (!SLUG.test(slug)) throw new BadRequestException({ mensaje: 'Slug de silo invalido' });
    return this.solicitudes.aplicar(slug, id, o);
  }
}
