import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Req, UseGuards } from '@nestjs/common';
import { EstadoPaso, TipoJob } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, Min, ValidateNested } from 'class-validator';
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

// Los DTO van antes de los controladores: Nest lee el tipo de cada parametro al definir la clase.
/** Custodio de una parte de la llave de recuperacion (nunca la parte). Sin ':' ni ',' (formato del script del ERP). */
class CustodioDto {
  @IsString()
  @Matches(/^[^:,\r\n]{2,80}$/)
  nombre: string;

  @IsString()
  @Matches(/^[^:,\r\n]{2,40}$/)
  rol: string;
}

class ConfirmarDto {
  @IsIn(['P5', 'P8'])
  paso: string;

  /** P5: los 3 custodios, uno por parte (2 de 3). */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(3)
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => CustodioDto)
  custodios?: CustodioDto[];

  /** P8: nota opcional. */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  nota?: string;
}

/** Version y digests que preparo el ejecutor (P2 de APROVISIONAR). Solo eso. */
class DatosP2Dto {
  @Matches(/^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z]+(\.[0-9A-Za-z]+)*)?$/)
  version: string;

  @Matches(/^sha256:[0-9a-f]{64}$/)
  apiDigest: string;

  @Matches(/^sha256:[0-9a-f]{64}$/)
  webDigest: string;
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

  /** APROVISIONAR: el operador confirma P5 (llaves, con custodios) o P8 (ruta del dominio). */
  @Post(':id/confirmar')
  @HttpCode(200)
  confirmar(@Param('id', ParseIntPipe) id: number, @Body() b: ConfirmarDto, @Operador() op: OperadorSesion, @IpCliente() ip: string | null) {
    return this.jobs.confirmar(id, b.paso, b.nota ?? '', op, ip, b.custodios);
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

  /** APROVISIONAR: el paso necesita al operador (P6 sin llaves, P8 sin dominio). */
  @IsOptional()
  @IsIn(['LLAVES', 'DOMINIO'])
  espera?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => DatosP2Dto)
  datos?: DatosP2Dto;
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

  /** Renueva la reserva mientras un paso largo corre (sin cambiar el paso). */
  @Post(':id/reserva')
  @HttpCode(200)
  reserva(@Req() req: Request & { agenteId: number }, @Param('id', ParseIntPipe) id: number) {
    return this.jobs.renovarReserva(req.agenteId, id);
  }

  @Post(':id/pasos/:codigo')
  @HttpCode(200)
  paso(@Req() req: Request & { agenteId: number }, @Param('id', ParseIntPipe) id: number, @Param('codigo') codigo: string, @Body() b: ReportePasoDto) {
    return this.jobs.reportarPaso(req.agenteId, id, codigo.slice(0, 8), b.estado, b.log, b.error, { espera: b.espera, datos: b.datos });
  }
}
