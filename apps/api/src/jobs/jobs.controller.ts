import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Req, UseGuards } from '@nestjs/common';
import { EstadoPaso, TipoJob } from '@prisma/client';
import { ArrayMaxSize, IsArray, IsEnum, IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import type { Request } from 'express';

import type { OperadorSesion } from '../acceso/acceso.service';
import { IpCliente, Operador, SesionGuard } from '../acceso/sesion.guard';
import { AgenteGuard } from '../agente/agente.guard';
import { ConsolaGuard } from '../consola/consola.guard';
import { JobsService } from './jobs.service';

class CrearJobDto {
  @IsEnum(TipoJob)
  tipo: TipoJob;

  /** Jobs que nacen de un manifiesto aprobado (VERIFICAR, APROVISIONAR...). */
  @IsOptional()
  @IsInt()
  @Min(1)
  centroId?: number;

  /** Jobs sobre un silo existente (REINICIAR_SILO). */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  siloSlug?: string;
}

/** Vista Aprovisionamiento de la consola. */
@Controller('consola/jobs')
@UseGuards(ConsolaGuard, SesionGuard)
export class JobsConsolaController {
  constructor(private readonly jobs: JobsService) {}

  @Get()
  listar() {
    return this.jobs.listar();
  }

  @Get(':id')
  detalle(@Param('id', ParseIntPipe) id: number) {
    return this.jobs.detalle(id);
  }

  @Post()
  @HttpCode(201)
  crear(@Body() b: CrearJobDto, @Operador() op: OperadorSesion, @IpCliente() ip: string | null) {
    return this.jobs.crear(b.tipo, { centroId: b.centroId, siloSlug: b.siloSlug }, op, ip);
  }

  @Post(':id/reintentar')
  @HttpCode(200)
  reintentar(@Param('id', ParseIntPipe) id: number, @Operador() op: OperadorSesion, @IpCliente() ip: string | null) {
    return this.jobs.reintentar(id, op, ip);
  }

  @Post(':id/cancelar')
  @HttpCode(204)
  cancelar(@Param('id', ParseIntPipe) id: number, @Operador() op: OperadorSesion, @IpCliente() ip: string | null) {
    return this.jobs.cancelar(id, op, ip);
  }
}

class ReclamarDto {
  @IsArray()
  @ArrayMaxSize(10)
  @IsEnum(TipoJob, { each: true })
  tipos: TipoJob[];
}

class ReportePasoDto {
  @IsIn(['EN_CURSO', 'OK', 'FALLIDO', 'OMITIDO'])
  estado: EstadoPaso;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  log?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  error?: string;
}

/** Endpoints del agente (modelo pull: reclama y reporta; el host A nunca llama al host B). */
@Controller('agente/jobs')
@UseGuards(AgenteGuard)
export class JobsAgenteController {
  constructor(private readonly jobs: JobsService) {}

  @Post('reclamar')
  @HttpCode(200)
  async reclamar(@Req() req: Request & { agenteId: number }, @Body() b: ReclamarDto) {
    return (await this.jobs.reclamar(req.agenteId, b.tipos)) ?? { job: null };
  }

  @Post(':id/pasos/:codigo')
  @HttpCode(200)
  paso(@Req() req: Request & { agenteId: number }, @Param('id', ParseIntPipe) id: number, @Param('codigo') codigo: string, @Body() b: ReportePasoDto) {
    return this.jobs.reportarPaso(req.agenteId, id, codigo.slice(0, 8), b.estado, b.log, b.error);
  }
}
