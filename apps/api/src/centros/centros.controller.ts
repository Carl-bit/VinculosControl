import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import type { EstadoCentro } from '@prisma/client';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import type { OperadorSesion } from '../acceso/acceso.service';
import { IpCliente, Operador, SesionGuard } from '../acceso/sesion.guard';
import { ConsolaGuard } from '../consola/consola.guard';
import { CentrosService } from './centros.service';
import { Fase2Service } from './fase2.service';
import { MANUALES } from './estados';

class SlugDto {
  @IsString()
  @MaxLength(40)
  slug: string;
}

class TransicionDto {
  @IsIn(MANUALES)
  hacia: EstadoCentro;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  motivo?: string;
}

/** Vista Solicitudes de la consola: centros y su pipeline comercial. */
@Controller('consola/centros')
@UseGuards(ConsolaGuard, SesionGuard)
export class CentrosController {
  constructor(
    private readonly centros: CentrosService,
    private readonly fase2: Fase2Service,
  ) {}

  @Get()
  listar(@Query('estado') estado?: string) {
    return this.centros.listar(estado);
  }

  @Get(':id')
  detalle(@Param('id', ParseIntPipe) id: number) {
    return this.centros.detalle(id);
  }

  @Post(':id/transicion')
  @HttpCode(204)
  transitar(@Param('id', ParseIntPipe) id: number, @Body() b: TransicionDto, @Operador() op: OperadorSesion, @IpCliente() ip: string | null) {
    return this.centros.transitar(id, b.hacia, b.motivo, op, ip);
  }

  @Post(':id/slug')
  @HttpCode(204)
  slug(@Param('id', ParseIntPipe) id: number, @Body() b: SlugDto, @Operador() op: OperadorSesion, @IpCliente() ip: string | null) {
    return this.fase2.definirSlug(id, b.slug.trim().toLowerCase(), op, ip);
  }

  /** Crea o rota el enlace de fase 2 y lo manda al contacto. Devuelve la URL una vez. */
  @Post(':id/enlace')
  @HttpCode(200)
  enlace(@Param('id', ParseIntPipe) id: number, @Operador() op: OperadorSesion, @IpCliente() ip: string | null) {
    return this.fase2.enviarEnlace(id, op, ip);
  }

  @Post(':id/enlace/revocar')
  @HttpCode(204)
  revocar(@Param('id', ParseIntPipe) id: number, @Operador() op: OperadorSesion, @IpCliente() ip: string | null) {
    return this.fase2.revocarEnlace(id, op, ip);
  }

  /** Borrador completo del manifiesto (lo valida borradorSchema del paquete compartido). */
  @Put(':id/manifiesto')
  @HttpCode(200)
  manifiesto(@Param('id', ParseIntPipe) id: number, @Body() cuerpo: unknown, @Operador() op: OperadorSesion, @IpCliente() ip: string | null) {
    return this.fase2.guardarPorOperador(id, cuerpo, op, ip);
  }

  @Post(':id/aprobar')
  @HttpCode(200)
  aprobar(@Param('id', ParseIntPipe) id: number, @Operador() op: OperadorSesion, @IpCliente() ip: string | null) {
    return this.fase2.aprobar(id, op, ip);
  }
}
