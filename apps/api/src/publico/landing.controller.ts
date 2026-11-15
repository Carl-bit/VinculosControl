import {
  Body,
  type CanActivate,
  Controller,
  createParamDecorator,
  type ExecutionContext,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';

import { ipValida } from '../acceso/reglas';
import { CentrosService } from '../centros/centros.service';
import { Fase2Service } from '../centros/fase2.service';
import { LimitePorIp } from './limite';
import { leerSolicitud, secretoValido } from './solicitud';

/**
 * Landing publica (apps/landing): unico sitio publico del plano de control
 * (2026-11-15: el formulario compartido y la fase 2 se juntaron aqui). Su
 * proxy agrega LANDING_SECRETO (distinto del de la consola) y solo llega a
 * estas rutas; la consola, la base y los jobs quedan fuera de su alcance.
 */
@Injectable()
export class LandingGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    if (!secretoValido(ctx.switchToHttp().getRequest<Request>().headers['x-landing-secreto'], process.env.LANDING_SECRETO)) throw new ForbiddenException();
    return true;
  }
}

/** IP del visitante que reenvia el proxy de la landing (cf-connecting-ip o x-forwarded-for). */
const IpVisitante = createParamDecorator((_: unknown, ctx: ExecutionContext) => ipValida(ctx.switchToHttp().getRequest<Request>().headers['x-landing-ip']));

@Controller('landing')
@UseGuards(LandingGuard)
export class LandingController {
  private readonly log = new Logger(LandingController.name);
  /** Solicitudes: 5 por hora por IP. */
  private readonly limite = new LimitePorIp(5, 3_600_000);
  /** Enlace de fase 2: holgado (se guarda varias veces), pero corta la fuerza bruta sobre tokens. */
  private readonly limiteEnlace = new LimitePorIp(120, 3_600_000);

  constructor(
    private readonly centros: CentrosService,
    private readonly fase2: Fase2Service,
  ) {}

  /**
   * Fase 1. origen "landing" = el centro llego solo; "enlace" = abrio el
   * enlace que compartio el operador desde la consola (?via=enlace). Cualquier
   * otro valor que mande el cliente cuenta como "landing".
   */
  @Post('solicitudes')
  @HttpCode(202)
  async solicitud(@Body() cuerpo: unknown, @IpVisitante() ip: string | null): Promise<{ recibida: true }> {
    if (!this.limite.permitir(ip ?? 'sin-ip')) throw new HttpException({ mensaje: 'Demasiadas solicitudes desde tu red. Intenta de nuevo en una hora.' }, HttpStatus.TOO_MANY_REQUESTS);
    const s = leerSolicitud(cuerpo, this.log);
    if (s) await this.centros.crearSolicitud(s.datos, s.origen === 'enlace' ? 'enlace' : 'landing');
    return { recibida: true };
  }

  private token(ip: string | null, token: string): string {
    if (!this.limiteEnlace.permitir(ip ?? 'sin-ip')) throw new HttpException({ mensaje: 'Demasiados intentos. Espera un rato.' }, HttpStatus.TOO_MANY_REQUESTS);
    if (!/^[\w-]{43}$/.test(token)) throw new NotFoundException({ mensaje: 'Enlace invalido' });
    return token;
  }

  /** Fase 2: lo que el centro ve por su enlace privado (solo sus campos). */
  @Get('manifiesto/:token')
  abrir(@Param('token') token: string, @IpVisitante() ip: string | null) {
    return this.fase2.abrir(this.token(ip, token));
  }

  @Put('manifiesto/:token')
  guardar(@Param('token') token: string, @Body() cuerpo: unknown, @IpVisitante() ip: string | null) {
    return this.fase2.guardarPorCentro(this.token(ip, token), cuerpo);
  }

  @Post('manifiesto/:token/enviar')
  @HttpCode(200)
  enviar(@Param('token') token: string, @IpVisitante() ip: string | null) {
    return this.fase2.enviarPorCentro(this.token(ip, token));
  }
}
