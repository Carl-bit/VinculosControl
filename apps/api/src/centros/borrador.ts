import { type Prisma, type PrismaClient } from '@prisma/client';
import { type Borrador, borradorDesdeFase1, borradorSchema } from '@vinculos/manifest';
import { hashManifiesto } from '@vinculos/manifest/hash';

type Tx = PrismaClient | Prisma.TransactionClient;

/** Borrador vigente de fase 2: la ultima revision fase 2, o el prellenado desde la fase 1. */
export async function leerBorrador(db: Tx, centroId: number): Promise<{ borrador: Borrador; revision: { numero: number; hash: string } | null }> {
  const r2 = await db.revisionManifiesto.findFirst({ where: { centroId, fase: 2 }, orderBy: { numero: 'desc' }, select: { numero: true, hash: true, contenido: true } });
  if (r2) {
    const p = borradorSchema.safeParse(r2.contenido);
    return { borrador: p.success ? p.data : {}, revision: { numero: r2.numero, hash: r2.hash } };
  }
  const r1 = await db.revisionManifiesto.findFirst({ where: { centroId, fase: 1 }, select: { contenido: true } });
  return { borrador: borradorDesdeFase1(r1?.contenido as { nombre_centro?: string; modulos_interes?: string[] } | null), revision: null };
}

/**
 * Nueva revision (inmutable) con su hash. Idempotente: si el contenido es igual
 * al de la ultima revision de la misma fase, no crea otra y devuelve esa.
 */
export async function guardarRevision(db: Tx, centroId: number, fase: number, contenido: unknown, autor: string): Promise<{ numero: number; hash: string; nueva: boolean }> {
  const hash = hashManifiesto(contenido);
  const ultimaFase = await db.revisionManifiesto.findFirst({ where: { centroId, fase }, orderBy: { numero: 'desc' }, select: { numero: true, hash: true } });
  if (ultimaFase?.hash === hash) return { ...ultimaFase, nueva: false };
  const ultima = await db.revisionManifiesto.aggregate({ where: { centroId }, _max: { numero: true } });
  const numero = (ultima._max.numero ?? 0) + 1;
  await db.revisionManifiesto.create({ data: { centroId, numero, fase, contenido: contenido as Prisma.InputJsonValue, hash, autor } });
  return { numero, hash, nueva: true };
}
