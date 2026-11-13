import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Length, Matches, Max, MaxLength, Min } from 'class-validator';

import type { OperadorSesion } from '../acceso/acceso.service';
import { Operador, SesionGuard } from '../acceso/sesion.guard';
import { ConsolaGuard } from '../consola/consola.guard';
import { OperacionService, TIPOS_EVENTO, type TipoEvento } from './operacion.service';
import { SEVERIDADES, type Severidad } from './plazos';

const SLUG = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/;

class CrearIncidenteDto {
  @IsIn(SEVERIDADES)
  severidad: Severidad;

  /** Hecho tecnico. Sin nombres de pacientes ni del equipo del centro. */
  @IsString()
  @Length(4, 200)
  titulo: string;

  @IsOptional()
  @Matches(SLUG)
  siloSlug?: string;

  @IsOptional()
  @IsInt()
  alertaId?: number;

  @IsOptional()
  @IsISO8601()
  detectadoEn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  nota?: string;
}

class EventoDto {
  @IsIn(TIPOS_EVENTO)
  tipo: TipoEvento;

  @IsString()
  @Length(2, 2000)
  texto: string;
}

class CrearSoporteDto {
  @Matches(SLUG)
  siloSlug: string;

  @IsString()
  @Length(4, 500)
  motivo: string;

  @IsIn(['DIAGNOSTICO', 'CONFIGURACION'])
  alcance: string;

  /** Cuando el ADMIN otorgo la autorizacion en su silo. */
  @IsISO8601()
  autorizadaEn: string;

  /** Vigencia que dio el ADMIN: 1 a 72 h. */
  @IsInt()
  @Min(1)
  @Max(72)
  horas: number;
}

class CerrarSoporteDto {
  /** Resultado sin datos del centro (lo que se hizo y si se resolvio). */
  @IsString()
  @Length(2, 2000)
  resultado: string;
}

@Controller('consola')
@UseGuards(ConsolaGuard, SesionGuard)
export class OperacionController {
  constructor(private readonly op: OperacionService) {}

  @Get('incidentes')
  incidentes(@Query('todos') todos?: string) {
    return this.op.listarIncidentes(todos !== '1');
  }

  @Get('incidentes/:id')
  incidente(@Param('id', ParseIntPipe) id: number) {
    return this.op.detalleIncidente(id);
  }

  @Post('incidentes')
  @HttpCode(201)
  crearIncidente(@Body() b: CrearIncidenteDto, @Operador() o: OperadorSesion) {
    return this.op.crearIncidente(b, o);
  }

  @Post('incidentes/:id/eventos')
  @HttpCode(200)
  evento(@Param('id', ParseIntPipe) id: number, @Body() b: EventoDto, @Operador() o: OperadorSesion) {
    return this.op.registrar(id, b.tipo, b.texto, o);
  }

  @Get('soporte')
  soporte() {
    return this.op.listarSoporte();
  }

  @Post('soporte')
  @HttpCode(201)
  crearSoporte(@Body() b: CrearSoporteDto, @Operador() o: OperadorSesion) {
    return this.op.crearSoporte(b, o);
  }

  @Post('soporte/:id/cerrar')
  @HttpCode(204)
  cerrarSoporte(@Param('id', ParseIntPipe) id: number, @Body() b: CerrarSoporteDto, @Operador() o: OperadorSesion) {
    return this.op.cerrarSoporte(id, b.resultado, o);
  }
}
