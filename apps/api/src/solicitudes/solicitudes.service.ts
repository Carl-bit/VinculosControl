import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import type { OperadorSesion } from '../acceso/acceso.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { PrismaService } from '../comun/prisma.service';
import { type Decision, type EstadoSolicitud, fusionar, porEntregar, transicionValida } from './reglas';

export interface SolicitudDelSilo {
  id: string;
  modulo: string;
  accion: string;
  pedidaPorRol: string;
  pedidaEn: string;
  estado: EstadoSolicitud;
}

/**
 * Tarea 31 (R2/R3). El agente trae lo que el silo expone en R2; el operador
 * decide en la consola; el agente devuelve la decision con R3. Aplicar el
 * cambio de modulos es del operador: hoy a mano (ERP_REGLAS_Y_DESPLIEGUE.md,
 * seccion 5); con R4, un job `reconfigurar` desde una revision del manifiesto.
 */
@Injectable()
export class SolicitudesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /** Agente: guarda lo que reporto el silo y devuelve las decisiones por entregar. */
  async sincronizar(slug: string, solicitudes: SolicitudDelSilo[], fallidas: { id: string; error: string }[]) {
    if (!(await this.prisma.silo.findUnique({ where: { slug }, select: { slug: true } }))) {
      throw new NotFoundException(`silo ${slug} desconocido (falta su reporte)`);
    }
    const ahora = new Date();
    const existentes = new Map(
      (await this.prisma.solicitudModulo.findMany({ where: { siloSlug: slug, id: { in: solicitudes.map((s) => s.id) } } })).map((s) => [s.id, s]),
    );
    await this.prisma.$transaction([
      ...solicitudes.map((s) => {
        const previa = existentes.get(s.id);
        const r = fusionar(previa ? { estado: previa.estado as EstadoSolicitud, estadoSilo: previa.estadoSilo as EstadoSolicitud } : null, s.estado);
        const base = { modulo: s.modulo, accion: s.accion, pedidaPorRol: s.pedidaPorRol, pedidaEn: new Date(s.pedidaEn), vistaEn: ahora };
        return this.prisma.solicitudModulo.upsert({
          where: { siloSlug_id: { siloSlug: slug, id: s.id } },
          create: { siloSlug: slug, id: s.id, ...base, ...r },
          update: { ...base, ...r, ...(r.estado === r.estadoSilo ? { errorEntrega: null } : {}) },
        });
      }),
      ...fallidas.map((f) =>
        this.prisma.solicitudModulo.updateMany({ where: { siloSlug: slug, id: f.id }, data: { errorEntrega: f.error.slice(0, 300) } }),
      ),
    ]);
    const abiertas = await this.prisma.solicitudModulo.findMany({ where: { siloSlug: slug, estado: { not: 'PENDIENTE' } } });
    return {
      respuestas: abiertas
        .filter((s) => porEntregar({ estado: s.estado as EstadoSolicitud, estadoSilo: s.estadoSilo as EstadoSolicitud }))
        .map((s) => ({ id: s.id, estado: s.estado, respuesta: s.respuesta })),
    };
  }

  listar(silo?: string) {
    return this.prisma.solicitudModulo.findMany({
      where: silo ? { siloSlug: silo } : {},
      orderBy: [{ pedidaEn: 'desc' }],
      take: 200,
    });
  }

  /** Consola: decision del operador. Valida la transicion; la entrega la hace el agente (R3). */
  async decidir(slug: string, id: string, estado: Decision, respuesta: string | undefined, o: OperadorSesion) {
    const s = await this.prisma.solicitudModulo.findUnique({ where: { siloSlug_id: { siloSlug: slug, id } } });
    if (!s) throw new NotFoundException('solicitud inexistente');
    if (s.estado === estado) return s;
    if (!transicionValida(s.estado as EstadoSolicitud, estado)) {
      throw new ConflictException({ mensaje: `No se puede pasar de ${s.estado} a ${estado}` });
    }
    if (s.estadoSilo !== s.estado) {
      throw new BadRequestException({ mensaje: `La decision anterior (${s.estado}) aun no llega al silo: espera el siguiente ciclo del agente` });
    }
    const texto = respuesta?.trim() || null;
    const r = await this.prisma.solicitudModulo.update({
      where: { siloSlug_id: { siloSlug: slug, id } },
      data: { estado, respuesta: texto, decididaPor: o.correo, decididaEn: new Date(), errorEntrega: null },
    });
    await this.auditoria.registrar(o.correo, 'modulo.solicitud_decidida', `${slug}/${s.modulo}`, `${s.accion} ${s.estado} -> ${estado}`);
    return r;
  }
}
