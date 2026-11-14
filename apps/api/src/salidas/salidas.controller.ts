import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, Length, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';

import type { OperadorSesion } from '../acceso/acceso.service';
import { IpCliente, Operador, SesionGuard } from '../acceso/sesion.guard';
import { ConsolaGuard } from '../consola/consola.guard';
import { GRACIA_DIAS, MEDIOS_CONFIRMACION, type MedioConfirmacion } from './reglas';
import { SalidasService } from './salidas.service';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

class InicioDto {
  @IsInt()
  centroId: number;

  /** YYYY-MM-DD. */
  @Matches(FECHA)
  fechaCorte: string;

  /** Motivo del termino (contractual, sin datos de pacientes). */
  @IsString()
  @Length(4, 300)
  motivo: string;

  @IsString()
  @MaxLength(40)
  confirmacion: string;
}

class RecepcionDto {
  @IsISO8601()
  exporteEn: string;

  @IsInt()
  @Min(1)
  exporteBytes: number;

  @IsString()
  @MaxLength(80)
  exporteHuella: string;

  @IsISO8601()
  firmadaEn: string;

  /** Quien recibe por el centro (direccion), nunca un paciente. */
  @IsString()
  @Length(2, 120)
  recibeNombre: string;

  @IsString()
  @Length(2, 120)
  recibeCargo: string;

  @IsInt()
  @Min(0)
  conteoPacientes: number;

  @IsInt()
  @Min(0)
  conteoFichas: number;

  @IsString()
  @MaxLength(80)
  huellaActa: string;

  @IsOptional()
  @IsInt()
  @Min(GRACIA_DIAS.min)
  @Max(GRACIA_DIAS.max)
  graciaDias?: number;
}

class ConfirmacionDto {
  @IsISO8601()
  en: string;

  @IsIn(MEDIOS_CONFIRMACION)
  medio: MedioConfirmacion;

  /** Referencia del documento o correo (asunto, numero), sin datos personales. */
  @IsString()
  @Length(2, 300)
  referencia: string;
}

class ChecklistDto {
  @IsBoolean() detenido: boolean;
  @IsBoolean() volumenes: boolean;
  @IsBoolean() respaldosHost: boolean;
  @IsBoolean() respaldosBucket: boolean;
  @IsBoolean() llaves: boolean;
  @IsBoolean() custodios: boolean;
  @IsBoolean() dominio: boolean;
  @IsBoolean() crontab: boolean;
}

class EliminacionDto {
  @ValidateNested()
  @Type(() => ChecklistDto)
  checklist: ChecklistDto;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  nota?: string;

  @IsString()
  @MaxLength(40)
  confirmacion: string;
}

class SlugDto {
  @IsString()
  @MaxLength(40)
  confirmacion: string;
}

class ReversionDto {
  @IsISO8601()
  solicitudEn: string;

  @IsIn(MEDIOS_CONFIRMACION)
  medio: MedioConfirmacion;

  /** Referencia de la solicitud escrita del centro (asunto, numero), sin datos personales. */
  @IsString()
  @Length(2, 300)
  referencia: string;

  @IsString()
  @Length(4, 300)
  motivo: string;

  @IsString()
  @MaxLength(40)
  confirmacion: string;
}

class EnviarActaDto {
  @IsIn(['eliminacion', 'reversion'])
  tipo: 'eliminacion' | 'reversion';
}

/** Salidas (CONTEXTO.md seccion 8): expediente y actas de la salida de un centro, y su reversion. */
@Controller('consola/salidas')
@UseGuards(ConsolaGuard, SesionGuard)
export class SalidasController {
  constructor(private readonly salidas: SalidasService) {}

  @Get()
  listar() {
    return this.salidas.listar();
  }

  /** Rutas por id de la salida: un centro puede tener varias (las revertidas quedan como historial). */
  @Get(':id')
  detalle(@Param('id', ParseIntPipe) id: number) {
    return this.salidas.detalle(id);
  }

  @Post()
  @HttpCode(200)
  iniciar(@Body() d: InicioDto, @Operador() op: OperadorSesion, @IpCliente() ip: string | null) {
    return this.salidas.iniciar(d, op, ip);
  }

  @Post(':id/acta-recepcion')
  @HttpCode(200)
  recepcion(@Param('id', ParseIntPipe) id: number, @Body() d: RecepcionDto, @Operador() op: OperadorSesion, @IpCliente() ip: string | null) {
    return this.salidas.registrarRecepcion(id, d, op, ip);
  }

  /** S6 por el ejecutor (job DETENER_SILO). */
  @Post(':id/detener')
  @HttpCode(200)
  detener(@Param('id', ParseIntPipe) id: number, @Operador() op: OperadorSesion, @IpCliente() ip: string | null) {
    return this.salidas.detener(id, op, ip);
  }

  /** S6 a mano (sin ejecutor). */
  @Post(':id/silo-detenido')
  @HttpCode(200)
  detenido(@Param('id', ParseIntPipe) id: number, @Operador() op: OperadorSesion) {
    return this.salidas.siloDetenido(id, op);
  }

  @Post(':id/confirmacion')
  @HttpCode(200)
  confirmacion(@Param('id', ParseIntPipe) id: number, @Body() d: ConfirmacionDto, @Operador() op: OperadorSesion, @IpCliente() ip: string | null) {
    return this.salidas.confirmar(id, d, op, ip);
  }

  /** S7 por el ejecutor (job ELIMINAR; exige bajas/<slug> en el host B). */
  @Post(':id/eliminar-silo')
  @HttpCode(200)
  eliminarSilo(@Param('id', ParseIntPipe) id: number, @Body() d: SlugDto, @Operador() op: OperadorSesion, @IpCliente() ip: string | null) {
    return this.salidas.eliminarSilo(id, d, op, ip);
  }

  @Post(':id/acta-eliminacion')
  @HttpCode(200)
  eliminar(@Param('id', ParseIntPipe) id: number, @Body() d: EliminacionDto, @Operador() op: OperadorSesion, @IpCliente() ip: string | null) {
    return this.salidas.eliminar(id, d, op, ip);
  }

  /** Reversion (baja por error o arrepentimiento) con la solicitud escrita del centro. */
  @Post(':id/revertir')
  @HttpCode(200)
  revertir(@Param('id', ParseIntPipe) id: number, @Body() d: ReversionDto, @Operador() op: OperadorSesion, @IpCliente() ip: string | null) {
    return this.salidas.revertir(id, d, op, ip);
  }

  /** Reversion sin ejecutor: el operador levanto el silo a mano. */
  @Post(':id/reanudado')
  @HttpCode(200)
  reanudado(@Param('id', ParseIntPipe) id: number, @Operador() op: OperadorSesion) {
    return this.salidas.confirmarReanudado(id, op);
  }

  /** Reenvio de la copia de un acta (eliminacion o reversion) al centro. */
  @Post(':id/enviar-acta')
  @HttpCode(200)
  enviarActa(@Param('id', ParseIntPipe) id: number, @Body() d: EnviarActaDto, @Operador() op: OperadorSesion) {
    return this.salidas.enviarActa(id, d.tipo, op);
  }
}
