/**
 * Helpers de los tests de integracion: modulo de Nest con los services reales
 * y Prisma real, correo falso que captura lo enviado, limpieza entre tests y
 * semillas (operador, agente, silo, centro aprobado).
 */
import { Test } from '@nestjs/testing';
import type { Prisma } from '@prisma/client';
import { hashManifiesto } from '@vinculos/manifest/hash';

import { AccesoService, type OperadorSesion } from '../../src/acceso/acceso.service';
import { CorreoService } from '../../src/acceso/correo.service';
import { hashClave } from '../../src/acceso/reglas';
import { hashToken } from '../../src/agente/agente.guard';
import { AuditoriaService } from '../../src/auditoria/auditoria.service';
import { CentrosService } from '../../src/centros/centros.service';
import { Fase2Service } from '../../src/centros/fase2.service';
import { PrismaService } from '../../src/comun/prisma.service';
import { JobsService } from '../../src/jobs/jobs.service';
import { SolicitudesService } from '../../src/solicitudes/solicitudes.service';

export interface Enviado {
  para: string;
  tipo: 'codigo' | 'fase2' | 'aviso' | 'prueba';
  codigo?: string;
}

/** Reemplaza CorreoService: guarda lo enviado; `fallar` simula un SMTP caido. */
export class CorreoFalso {
  enviados: Enviado[] = [];
  fallar = false;
  private registrar(e: Enviado) {
    if (this.fallar) return Promise.reject(new Error('smtp caido'));
    this.enviados.push(e);
    return Promise.resolve();
  }
  enviarCodigo(para: string, codigo: string) {
    return this.registrar({ para, tipo: 'codigo', codigo });
  }
  enviarEnlaceFase2(para: string) {
    return this.registrar({ para, tipo: 'fase2' });
  }
  avisarSolicitud(para: string) {
    return this.registrar({ para, tipo: 'aviso' });
  }
  enviarPrueba(para: string) {
    return this.registrar({ para, tipo: 'prueba' });
  }
  ultimoCodigo(): string {
    const c = [...this.enviados].reverse().find((e) => e.tipo === 'codigo');
    if (!c?.codigo) throw new Error('no se envio ningun codigo');
    return c.codigo;
  }
}

export interface Entorno {
  prisma: PrismaService;
  correo: CorreoFalso;
  acceso: AccesoService;
  centros: CentrosService;
  jobs: JobsService;
  solicitudes: SolicitudesService;
  cerrar: () => Promise<void>;
}

export async function crearEntorno(): Promise<Entorno> {
  const correo = new CorreoFalso();
  const mod = await Test.createTestingModule({
    providers: [PrismaService, AuditoriaService, AccesoService, Fase2Service, CentrosService, JobsService, SolicitudesService, { provide: CorreoService, useValue: correo }],
  }).compile();
  const prisma = mod.get(PrismaService);
  await prisma.$connect();
  return {
    prisma,
    correo,
    acceso: mod.get(AccesoService),
    centros: mod.get(CentrosService),
    jobs: mod.get(JobsService),
    solicitudes: mod.get(SolicitudesService),
    cerrar: () => mod.close(),
  };
}

/** Vacia todas las tablas (salvo la de migraciones) y reinicia los ids. */
export async function limpiar(prisma: PrismaService, correo?: CorreoFalso): Promise<void> {
  const tablas = await prisma.$queryRaw<{ t: string }[]>`
    SELECT tablename AS t FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tablas.map((x) => `"${x.t}"`).join(', ')} RESTART IDENTITY CASCADE`);
  if (correo) {
    correo.enviados = [];
    correo.fallar = false;
  }
}

export const CLAVE = 'clave-de-prueba-larga-123';

export async function crearOperador(prisma: PrismaService, correo = 'ops@vinculos.cl') {
  return prisma.operador.create({ data: { correo, nombre: 'Operador de prueba', claveHash: hashClave(CLAVE) } });
}

/** Operador ya autenticado, como lo entrega SesionGuard (para las acciones de la consola). */
export async function sesionDeOperador(prisma: PrismaService): Promise<OperadorSesion> {
  const op = await crearOperador(prisma);
  const s = await prisma.sesion.create({ data: { tokenHash: hashToken(`token-${op.id}`), operadorId: op.id } });
  return { sesionId: s.id, operadorId: op.id, correo: op.correo, nombre: op.nombre };
}

export async function crearAgente(prisma: PrismaService, nombre = 'host-b') {
  return prisma.agente.create({ data: { nombre, tokenHash: hashToken(`agente-${nombre}`) } });
}

/** Silo reportado por el agente ahora (P0 de los jobs sobre silo pide < 10 min). */
export async function crearSilo(prisma: PrismaService, slug = 'kibou', vistoEn = new Date()) {
  return prisma.silo.create({ data: { slug, vistoEn } });
}

/** Manifiesto completo valido (mismo ejemplo de packages/manifest), solo modulos del MVP. */
export function manifiestoValido(slug = 'kibou', modulos = ['AGENDA', 'EQUIPO', 'FICHAS', 'MATCH']) {
  return {
    schema: 1,
    tipo_cliente: 'centro',
    centro: {
      id: slug,
      nombre: 'Centro Kibou',
      razon_social: 'Kibou Psicologia SpA',
      rut: '76.086.428-5',
      tipo_entidad: 'spa',
      admin: { nombre: 'Ana Perez', correo: 'admin@kibou.cl' },
      responsable_datos: { nombre: 'Ana Perez', correo: 'direccion@kibou.cl' },
    },
    dominio: { tipo: 'subdominio', valor: `${slug}.vinculos.cl` },
    version: { canal: 'estable' },
    estilo: { tema: 'moderno' },
    modulos,
  };
}

/**
 * Centro APROBADO con su revision fase 3 y el hash aprobado, como lo deja la
 * consola al aprobar. `contenido` permite sembrar un manifiesto invalido.
 */
export async function crearCentroAprobado(prisma: PrismaService, slug = 'kibou', contenido: unknown = manifiestoValido(slug)) {
  const hash = hashManifiesto(contenido);
  const c = await prisma.centro.create({
    data: {
      slug,
      nombre: 'Centro Kibou',
      estado: 'APROBADO',
      contactoNombre: 'Ana Perez',
      contactoCorreo: 'ana@kibou.cl',
      comuna: 'Providencia',
      origen: 'formulario',
      revisionAprobada: 1,
      hashAprobado: hash,
    },
  });
  await prisma.revisionManifiesto.create({ data: { centroId: c.id, numero: 1, fase: 3, contenido: contenido as Prisma.InputJsonValue, hash, autor: 'test' } });
  return c;
}

/** Captura la respuesta de una HttpException de Nest (status + cuerpo). */
export async function errorDe(p: Promise<unknown>): Promise<{ status: number; cuerpo: Record<string, unknown> }> {
  try {
    await p;
  } catch (e) {
    const h = e as { getStatus?: () => number; getResponse?: () => unknown };
    if (h.getStatus && h.getResponse) return { status: h.getStatus(), cuerpo: h.getResponse() as Record<string, unknown> };
    throw e;
  }
  throw new Error('se esperaba un error y la promesa se cumplio');
}

export const contarAuditoria = (prisma: PrismaService, accion: string) => prisma.eventoAuditoria.count({ where: { accion } });
