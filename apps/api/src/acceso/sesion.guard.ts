import { type CanActivate, createParamDecorator, type ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

import { ipValida } from './reglas';
import { AccesoService, type OperadorSesion } from './acceso.service';

type ReqConsola = Request & { operador?: OperadorSesion };

/**
 * Sesion del operador. Va despues de ConsolaGuard (secreto de la web): la web
 * lee la cookie httpOnly y manda el token en x-consola-sesion. Sin sesion
 * vigente responde 401 y la web vuelve a /ingreso.
 */
@Injectable()
export class SesionGuard implements CanActivate {
  constructor(private readonly acceso: AccesoService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<ReqConsola>();
    const token = req.headers['x-consola-sesion'];
    const op = typeof token === 'string' && /^[\w-]{40,64}$/.test(token) ? await this.acceso.validarSesion(token) : null;
    if (!op) throw new UnauthorizedException({ mensaje: 'Sesion vencida o inexistente', sesion: false });
    req.operador = op;
    return true;
  }
}

/** Operador de la sesion (solo en rutas con SesionGuard). */
export const Operador = createParamDecorator((_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<ReqConsola>().operador as OperadorSesion);

/** IP del navegador que reenvia el proxy de la web (cf-connecting-ip o x-forwarded-for). */
export const IpCliente = createParamDecorator((_: unknown, ctx: ExecutionContext) => ipValida(ctx.switchToHttp().getRequest<Request>().headers['x-consola-ip']));
