import { ConflictException, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { type EstadoCentro, Prisma } from '@prisma/client';
import { type Fase1 } from '@vinculos/manifest';
import { hashManifiesto } from '@vinculos/manifest/hash';

import type { OperadorSesion } from '../acceso/acceso.service';
import { CorreoService } from '../acceso/correo.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { PrismaService } from '../comun/prisma.service';
import { SIGUIENTE, TRANSICIONES, validarTransicionManual } from './estados';
import { Fase2Service } from './fase2.service';

const ESTADOS = Object.keys(TRANSICIONES) as EstadoCentro[];

@Injectable()
export class CentrosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly fase2: Fase2Service,
    private readonly correo: CorreoService,
  ) {}

  private readonly logger = new Logger(CentrosService.name);

  /**
   * Aviso por correo a los operadores activos. Nunca hace fallar la solicitud
   * del sitio: si el correo falla, queda en el log y la consola la muestra igual.
   */
  private async avisarOperadores(centro: string, tamano: string | null, modulos: string[]): Promise<void> {
    const operadores = await this.prisma.operador.findMany({ where: { activo: true }, select: { correo: true } });
    for (const o of operadores) {
      await this.correo.avisarSolicitud(o.correo, centro, tamano, modulos).catch((e: unknown) => {
        this.logger.warn(`aviso de solicitud a ${o.correo} fallo: ${e instanceof Error ? e.message : String(e)}`);
      });
    }
  }

  /** Fase 1 desde el sitio: centro en SOLICITUD + revision 1 del manifiesto (solo la fase 1). */
  async crearSolicitud(f: Fase1, origen = 'landing'): Promise<void> {
    const centro = await this.prisma.$transaction(async (tx) => {
      const c = await tx.centro.create({
        data: {
          nombre: f.nombre_centro,
          contactoNombre: f.contacto.nombre,
          contactoCorreo: f.contacto.correo,
          contactoTelefono: f.contacto.telefono ?? null,
          comuna: f.comuna,
          origen,
        },
      });
      await tx.transicionCentro.create({ data: { centroId: c.id, desde: null, hacia: 'SOLICITUD', actor: 'landing' } });
      await tx.revisionManifiesto.create({
        data: { centroId: c.id, numero: 1, fase: 1, contenido: f as unknown as Prisma.InputJsonValue, hash: hashManifiesto(f), autor: 'centro:fase1' },
      });
      return c;
    });
    await this.auditoria.registrar('landing', 'centro.solicitud', `centro:${centro.id}`, centro.nombre);
    await this.avisarOperadores(centro.nombre, f.tamano_equipo ?? null, f.modulos_interes ?? []);
  }

  async listar(estado?: string) {
    const filtro = ESTADOS.find((e) => e === estado);
    const centros = await this.prisma.centro.findMany({
      where: filtro ? { estado: filtro } : undefined,
      orderBy: { creadoEn: 'desc' },
      take: 500,
      include: { revisiones: { where: { numero: 1 }, select: { contenido: true } } },
    });
    return centros.map(({ revisiones, ...c }) => {
      const f1 = revisiones[0]?.contenido as Partial<Fase1> | undefined;
      return { ...c, tamanoEquipo: f1?.tamano_equipo ?? null, modulosInteres: f1?.modulos_interes ?? [] };
    });
  }

  async detalle(id: number) {
    const c = await this.prisma.centro.findUnique({
      where: { id },
      include: {
        transiciones: { orderBy: { en: 'desc' } },
        revisiones: { orderBy: { numero: 'desc' }, select: { numero: true, fase: true, hash: true, autor: true, creadaEn: true } },
      },
    });
    if (!c) throw new NotFoundException();
    const fase1 = await this.prisma.revisionManifiesto.findFirst({ where: { centroId: id, fase: 1 }, select: { contenido: true } });
    return {
      ...c,
      fase1: fase1?.contenido ?? null,
      fase2: await this.fase2.resumen(id, c.slug, c.nombre),
      siguiente: SIGUIENTE[c.estado] ?? null,
      puedeDescartar: TRANSICIONES[c.estado].includes('DESCARTADO'),
    };
  }

  /** Transicion manual del operador. Optimista: si otro la movio antes, 409. */
  async transitar(id: number, hacia: EstadoCentro, motivo: string | undefined, op: OperadorSesion, ip: string | null) {
    const c = await this.prisma.centro.findUnique({ where: { id }, select: { estado: true, nombre: true } });
    if (!c) throw new NotFoundException();
    const error = validarTransicionManual(c.estado, hacia, motivo) ?? (hacia === 'DATOS_COMPLETOS' ? await this.fase2.datosCentroCompletos(id) : null);
    if (error) throw new UnprocessableEntityException({ mensaje: error });
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.centro.updateMany({ where: { id, estado: c.estado }, data: { estado: hacia } });
      if (r.count !== 1) throw new ConflictException({ mensaje: 'El centro cambio de estado mientras tanto. Recarga.' });
      await tx.transicionCentro.create({ data: { centroId: id, desde: c.estado, hacia, actor: op.correo, motivo: motivo?.trim() || null } });
    });
    await this.auditoria.registrar(op.correo, 'centro.transicion', `centro:${id}`, `${c.estado} -> ${hacia}${motivo?.trim() ? ` · ${motivo.trim().slice(0, 200)}` : ''}${ip ? ` · ${ip}` : ''}`);
  }
}
