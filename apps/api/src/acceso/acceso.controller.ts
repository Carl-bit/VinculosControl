import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { IsEmail, IsString, Length, Matches, MaxLength } from 'class-validator';

import { ConsolaGuard } from '../consola/consola.guard';
import { AccesoService, type OperadorSesion } from './acceso.service';
import { IpCliente, Operador, SesionGuard } from './sesion.guard';

class CredencialesDto {
  @IsEmail()
  @MaxLength(200)
  correo: string;

  @IsString()
  @Length(1, 200)
  clave: string;
}

class CodigoDto {
  @Matches(/^[\w-]{32}$/)
  desafio: string;

  @Matches(/^\d{6}$/, { message: 'El codigo tiene 6 digitos' })
  codigo: string;
}

class DesafioDto {
  @Matches(/^[\w-]{32}$/)
  desafio: string;
}

/** Login de la consola en dos pasos. Solo lo llama la web (ConsolaGuard); las rutas de sesion exigen ademas SesionGuard. */
@Controller('consola/acceso')
@UseGuards(ConsolaGuard)
export class AccesoController {
  constructor(private readonly acceso: AccesoService) {}

  @Post('credenciales')
  @HttpCode(200)
  credenciales(@Body() b: CredencialesDto, @IpCliente() ip: string | null) {
    return this.acceso.credenciales(b.correo, b.clave, ip);
  }

  @Post('codigo')
  @HttpCode(200)
  codigo(@Body() b: CodigoDto, @IpCliente() ip: string | null) {
    return this.acceso.verificar(b.desafio, b.codigo, ip);
  }

  @Post('reenviar')
  @HttpCode(200)
  reenviar(@Body() b: DesafioDto, @IpCliente() ip: string | null) {
    return this.acceso.reenviar(b.desafio, ip);
  }

  @Get('yo')
  @UseGuards(SesionGuard)
  yo(@Operador() op: OperadorSesion) {
    return this.acceso.yo(op);
  }

  @Post('salir')
  @HttpCode(204)
  @UseGuards(SesionGuard)
  salir(@Operador() op: OperadorSesion, @IpCliente() ip: string | null) {
    return this.acceso.salir(op, ip);
  }
}
