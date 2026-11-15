import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsISO8601, IsString, Matches, MaxLength, ValidateNested } from 'class-validator';
import type { Request } from 'express';

import type { OperadorSesion } from '../acceso/acceso.service';
import { IpCliente, Operador, SesionGuard } from '../acceso/sesion.guard';
import { AgenteGuard } from '../agente/agente.guard';
import { ConsolaGuard } from '../consola/consola.guard';
import { ActualizarService } from '../jobs/actualizar.service';
import { JobsService } from '../jobs/jobs.service';
import { ReleasesService } from './releases.service';
import { type Canal, CANALES } from './semver';

const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z]+(\.[0-9A-Za-z]+)*)?$/;

// Los DTO van antes de los controladores: Nest lee el tipo de cada parametro al definir la clase.
class PromoverDto {
  @IsIn([...CANALES])
  canal: Canal;
}

class CascadaDto {
  @IsIn([...CANALES])
  canal: Canal;

  /** El operador revisa que ningun centro del canal tenga una exportacion en curso (R13 pendiente). */
  @IsBoolean()
  sinExporte: boolean;
}

/** Lo que informa el agente desde infra/imagenes/<version>.env: solo version, digests, commit y fecha. */
class ReleaseAgenteDto {
  @Matches(VERSION)
  version: string;

  @Matches(/^sha256:[0-9a-f]{64}$/)
  apiDigest: string;

  @Matches(/^sha256:[0-9a-f]{64}$/)
  webDigest: string;

  @IsString()
  @Matches(/^[0-9a-f]{7,40}(-sucio)?$/)
  @MaxLength(60)
  commit: string;

  @IsISO8601()
  publicada: string;
}

class ReleasesAgenteDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ReleaseAgenteDto)
  releases: ReleaseAgenteDto[];
}

/** Vista Releases de la consola (seccion 7). */
@Controller('consola/releases')
@UseGuards(ConsolaGuard, SesionGuard)
export class ReleasesConsolaController {
  constructor(
    private readonly releases: ReleasesService,
    private readonly jobs: JobsService,
    private readonly actualizar: ActualizarService,
  ) {}

  @Get()
  async listar() {
    const [releases, cascadas] = await Promise.all([this.releases.listar(), this.jobs.listarCascadas()]);
    return { releases, cascadas };
  }

  /** Version del silo, su canal y a que versiones puede subir (detalle del silo). */
  @Get('silo/:slug')
  silo(@Param('slug') slug: string) {
    return this.actualizar.opciones(slug.slice(0, 40));
  }

  @Post(':version/promover')
  @HttpCode(200)
  promover(@Param('version') version: string, @Body() b: PromoverDto, @Operador() op: OperadorSesion, @IpCliente() ip: string | null) {
    return this.releases.promover(version.slice(0, 40), b.canal, op, ip);
  }

  @Post(':version/cascada')
  @HttpCode(201)
  cascada(@Param('version') version: string, @Body() b: CascadaDto, @Operador() op: OperadorSesion, @IpCliente() ip: string | null) {
    return this.jobs.crearCascada(version.slice(0, 40), b.canal, b.sinExporte, op, ip);
  }
}

/** El agente informa las versiones publicadas en el host B (modelo pull: el agente llama). */
@Controller('agente/releases')
@UseGuards(AgenteGuard)
export class ReleasesAgenteController {
  constructor(private readonly releases: ReleasesService) {}

  @Post()
  @HttpCode(200)
  registrar(@Req() req: Request & { agenteId: number }, @Body() b: ReleasesAgenteDto) {
    return this.releases.registrar(req.agenteId, b.releases);
  }
}
