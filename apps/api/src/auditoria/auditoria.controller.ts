import { Controller, Get, ParseIntPipe, Query, UseGuards } from '@nestjs/common';

import { SesionGuard } from '../acceso/sesion.guard';
import { PrismaService } from '../comun/prisma.service';
import { ConsolaGuard } from '../consola/consola.guard';

/** Prefijos de accion que la vista Auditoria ofrece como filtro. */
const TIPOS = ['auth', 'operador', 'silo', 'centro', 'job', 'incidente', 'soporte'] as const;

@Controller('consola/auditoria')
@UseGuards(ConsolaGuard, SesionGuard)
export class AuditoriaController {
  constructor(private readonly prisma: PrismaService) {}

  /** Ultimos eventos (mas nuevos primero). `tipo` filtra por prefijo de accion; `antes` pagina por id. */
  @Get()
  async listar(
    @Query('limite', new ParseIntPipe({ optional: true })) limite = 100,
    @Query('tipo') tipo?: string,
    @Query('antes') antes?: string,
  ) {
    const filtroTipo = TIPOS.find((t) => t === tipo);
    const antesId = antes && /^\d{1,19}$/.test(antes) ? BigInt(antes) : undefined;
    const filas = await this.prisma.eventoAuditoria.findMany({
      where: { ...(filtroTipo && { accion: { startsWith: `${filtroTipo}.` } }), ...(antesId && { id: { lt: antesId } }) },
      orderBy: { id: 'desc' },
      take: Math.min(Math.max(limite, 1), 500),
    });
    return filas.map((e) => ({ ...e, id: e.id.toString() }));
  }
}
