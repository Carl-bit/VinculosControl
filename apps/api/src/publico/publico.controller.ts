import { timingSafeEqual } from 'node:crypto';

import {
  BadRequestException,
  Body,
  type CanActivate,
  Controller,
  createParamDecorator,
  type ExecutionContext,
  ForbiddenException,
  HttpCode,
  HttpException,
  Get,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { fase1Schema } from '@vinculos/manifest';
import type { Request } from 'express';

import { ipValida } from '../acceso/reglas';
import { CentrosService } from '../centros/centros.service';
import { Fase2Service } from '../centros/fase2.service';
import { LimitePorIp } from './limite';

/**
 * Rutas publicas: solo las llama apps/sitio (su proxy agrega SITIO_SECRETO,
 * distinto al de la consola). Sin SITIO_SECRETO configurado, quedan cerradas.
 */
@Injectable()
export class SitioGuard implements CanActivate {
  private readonly secreto = Buffer.from(process.env.SITIO_SECRETO ?? '');

  canActivate(ctx: ExecutionContext): boolean {
    const recibido = Buffer.from(String(ctx.switchToHttp().getRequest<Request>().headers['x-sitio-secreto'] ?? ''));
    const valido = this.secreto.length >= 16 && recibido.length === this.secreto.length && timingSafeEqual(recibido, this.secreto);
    if (!valido) throw new ForbiddenException();
    return true;
  }
}

/** IP del visitante que reenvia el proxy del sitio (cf-connecting-ip o x-forwarded-for). */
const IpVisitante = createParamDecorator((_: unknown, ctx: ExecutionContext) => ipValida(ctx.switchToHttp().getRequest<Request>().headers['x-sitio-ip']));

/** Campo oculto del formulario: una persona no lo ve ni lo llena; un bot suele llenarlo. */
export const CAMPO_TRAMPA = 'sitio_web_alternativo';

@Controller('publico')
@UseGuards(SitioGuard)
export class PublicoController {
  private readonly log = new Logger(PublicoController.name);
  private readonly limite = new LimitePorIp(5, 3_600_000);
  /** Enlace de fase 2: holgado (se guarda varias veces), pero corta la fuerza bruta sobre tokens. */
  private readonly limiteEnlace = new LimitePorIp(120, 3_600_000);

  constructor(
    private readonly centros: CentrosService,
    private readonly fase2: Fase2Service,
  ) {}

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

  /**
   * Fase 1 del manifiesto (formulario del sitio). Valida con el schema
   * compartido (@vinculos/manifest). Si el campo trampa viene lleno responde
   * igual que un exito, sin guardar nada.
   */
  @Post('solicitudes')
  @HttpCode(202)
  async solicitud(@Body() cuerpo: unknown, @IpVisitante() ip: string | null): Promise<{ recibida: true }> {
    if (!this.limite.permitir(ip ?? 'sin-ip')) throw new HttpException({ mensaje: 'Demasiadas solicitudes desde tu red. Intenta de nuevo en una hora.' }, HttpStatus.TOO_MANY_REQUESTS);
    if (typeof cuerpo !== 'object' || cuerpo === null || Array.isArray(cuerpo)) throw new BadRequestException({ mensaje: 'Formulario vacio' });
    const { [CAMPO_TRAMPA]: trampa, origen, ...datos } = cuerpo as Record<string, unknown>;
    if (typeof trampa === 'string' && trampa.trim()) {
      this.log.warn('solicitud descartada por el campo trampa');
      return { recibida: true };
    }
    const r = fase1Schema.safeParse(datos);
    if (!r.success) {
      const i = r.error.issues[0];
      throw new BadRequestException({ mensaje: `Revisa ${i.path.join('.') || 'el formulario'}: ${i.message}`, campos: r.error.issues.map((x) => x.path.join('.')) });
    }
    // formulario = llego desde el sitio; enlace = desde el enlace que compartio el operador.
    await this.centros.crearSolicitud(r.data, origen === 'enlace' ? 'enlace' : 'formulario');
    return { recibida: true };
  }
}
