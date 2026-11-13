import { timingSafeEqual } from 'node:crypto';

import { type CanActivate, type ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';

/**
 * Las rutas /consola solo las llama apps/web (su proxy agrega el secreto).
 * La API queda alcanzable desde la red para el agente; la consola no. La web
 * se publica solo en 127.0.0.1 o detras de Cloudflare Access (decision de la
 * primera entrega; el 2FA propio viene despues).
 */
@Injectable()
export class ConsolaGuard implements CanActivate {
  private readonly secreto = Buffer.from(process.env.CONSOLA_SECRETO ?? '');

  canActivate(ctx: ExecutionContext): boolean {
    const recibido = Buffer.from(String(ctx.switchToHttp().getRequest<Request>().headers['x-consola-secreto'] ?? ''));
    const valido = this.secreto.length >= 16 && recibido.length === this.secreto.length && timingSafeEqual(recibido, this.secreto);
    if (!valido) throw new ForbiddenException();
    return true;
  }
}
