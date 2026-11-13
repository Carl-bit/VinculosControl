import { Injectable } from '@nestjs/common';

import { PrismaService } from '../comun/prisma.service';

/**
 * Registro de auditoria de la consola. Solo metadatos: quien (correo del
 * operador, "agente:<nombre>", "cli" o "sistema"), que accion, sobre que objeto
 * (slug, correo del operador) y un detalle corto. Nunca datos clinicos ni personales de pacientes.
 */
@Injectable()
export class AuditoriaService {
  constructor(private readonly prisma: PrismaService) {}

  async registrar(actor: string, accion: string, objeto?: string | null, detalle?: string | null): Promise<void> {
    await this.prisma.eventoAuditoria.create({
      data: { actor: actor.slice(0, 200), accion, objeto: objeto?.slice(0, 200) ?? null, detalle: detalle?.slice(0, 500) ?? null },
    });
  }
}
