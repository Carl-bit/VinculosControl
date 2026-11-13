import { createHash } from 'node:crypto';

import { type CanActivate, type ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

import { PrismaService } from '../comun/prisma.service';

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** Bearer del agente (modelo pull: solo el agente llama). El token vive solo en el host B; aca, su sha256. */
@Injectable()
export class AgenteGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { agenteId?: number }>();
    const token = /^Bearer (\S{32,})$/.exec(req.headers.authorization ?? '')?.[1];
    if (!token) throw new UnauthorizedException();
    const agente = await this.prisma.agente.findUnique({ where: { tokenHash: hashToken(token) }, select: { id: true } });
    if (!agente) throw new UnauthorizedException();
    req.agenteId = agente.id;
    return true;
  }
}
