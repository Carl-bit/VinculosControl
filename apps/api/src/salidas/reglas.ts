/**
 * Reglas puras del protocolo de salida (CONTEXTO.md seccion 8; ERP
 * docs/cumplimiento/baja_centro.md). Con tests en reglas.spec.ts.
 *
 * S1 iniciar (EN_SALIDA) -> S3-S5 exporte + acta de recepcion (EXPORTADO)
 * -> S6 silo detenido (GRACIA) + confirmacion escrita -> S7 acta de
 * eliminacion (ELIMINADO) -> S8 solo quedan metadatos.
 *
 * Los pasos fisicos (exporte en el silo, down, borrar volumenes, respaldos y
 * llaves) siguen el procedimiento manual del ERP: la consola lleva el
 * expediente y las actas. El agente no exporta ni borra (sin verbos para eso).
 */
import type { EstadoCentro } from '@prisma/client';

/** Desde donde se inicia una salida. */
export const ORIGENES: readonly EstadoCentro[] = ['ACTIVO', 'ACTIVO_SIN_DOMINIO', 'SUSPENDIDO'];

export const GRACIA_DIAS = { defecto: 30, min: 1, max: 365 } as const;

/** Huella SHA-256 en hex (la de registro_exportaciones del silo). */
export const HUELLA = /^[0-9a-f]{64}$/;
export const normalizarHuella = (h: string) => h.trim().toLowerCase();

export const MEDIOS_CONFIRMACION = ['CORREO', 'DOCUMENTO', 'OTRO'] as const;
export type MedioConfirmacion = (typeof MEDIOS_CONFIRMACION)[number];

/** Checklist del acta de eliminacion: los pasos de baja_centro.md seccion 2. */
export const CHECKLIST = [
  { clave: 'detenido', l: 'Silo detenido (docker compose down)' },
  { clave: 'volumenes', l: 'Volumenes del silo borrados (db_data, exportaciones)' },
  { clave: 'respaldosHost', l: 'Respaldos borrados en el host (respaldos/<slug>/)' },
  { clave: 'respaldosBucket', l: 'Respaldos borrados en el bucket (prefijo <slug>/, incluidas versiones)' },
  { clave: 'llaves', l: 'Llaves destruidas (shred -u de infra/secrets/<slug>/)' },
  { clave: 'custodios', l: 'Custodios avisados para destruir su parte de recuperacion' },
  { clave: 'dominio', l: 'Dominio quitado de Traefik, del tunel y del DNS' },
  { clave: 'crontab', l: 'Lineas # vinculos:<slug> quitadas del crontab' },
] as const;
export type ClaveChecklist = (typeof CHECKLIST)[number]['clave'];
export type Checklist = Record<ClaveChecklist, boolean>;

export const faltanEnChecklist = (c: Partial<Record<string, unknown>>): string[] => CHECKLIST.filter((i) => c[i.clave] !== true).map((i) => i.l);

const DIA = 86_400_000;

/** S6: la gracia corre desde la firma del acta de recepcion. */
export const graciaHasta = (actaFirmadaEn: Date, dias: number) => new Date(actaFirmadaEn.getTime() + dias * DIA);

/** Dias que faltan (redondeado hacia arriba; 0 = vencida). */
export const diasRestantes = (hasta: Date | null, ahora: Date) => (hasta ? Math.max(0, Math.ceil((hasta.getTime() - ahora.getTime()) / DIA)) : null);

export interface DatosRecepcion {
  exporteEn: Date;
  exporteHuella: string;
  firmadaEn: Date;
  huellaActa: string;
}

/** S3-S5: errores del acta de recepcion (vacio = valida). */
export function erroresRecepcion(d: DatosRecepcion, iniciadaEn: Date, ahora: Date): string[] {
  const e: string[] = [];
  const hx = normalizarHuella(d.exporteHuella);
  const ha = normalizarHuella(d.huellaActa);
  if (!HUELLA.test(hx)) e.push('La huella del exporte debe ser un SHA-256 (64 caracteres hex)');
  if (!HUELLA.test(ha)) e.push('La huella del acta debe ser un SHA-256 (64 caracteres hex)');
  if (HUELLA.test(hx) && HUELLA.test(ha) && hx !== ha) e.push('La huella que firmo el centro no coincide con la del exporte: revisar antes de registrar el acta');
  if (d.exporteEn > ahora) e.push('La fecha del exporte esta en el futuro');
  if (d.firmadaEn > ahora) e.push('La fecha de firma del acta esta en el futuro');
  if (d.firmadaEn < d.exporteEn) e.push('El acta no puede firmarse antes de generar el exporte');
  // Un exporte anterior al inicio de la salida no es el de la baja (pudo ser un exporte rutinario).
  if (d.exporteEn.getTime() < iniciadaEn.getTime() - DIA) e.push('El exporte es anterior al inicio de la salida: el centro debe generar uno nuevo');
  return e;
}

export interface EstadoSalida {
  graciaHasta: Date | null;
  siloDetenidoEn: Date | null;
  confirmacionEn: Date | null;
  reversionPedidaEn?: Date | null;
}

/** Desde donde se revierte una salida (baja por error o arrepentimiento). Despues de eliminar no hay vuelta. */
export const REVERTIBLES: readonly EstadoCentro[] = ['EN_SALIDA', 'EXPORTADO', 'GRACIA'];

export type Expediente = 'abierta' | 'reversion_pendiente' | 'revertida' | 'eliminada';
export function expediente(s: { revertidaEn: Date | null; reversionPedidaEn: Date | null; eliminadoEn: Date | null }): Expediente {
  if (s.revertidaEn) return 'revertida';
  if (s.eliminadoEn) return 'eliminada';
  return s.reversionPedidaEn ? 'reversion_pendiente' : 'abierta';
}

/** S7: que falta para poder eliminar (vacio = se puede). */
export function bloqueosEliminar(s: EstadoSalida, estado: EstadoCentro, ahora: Date): string[] {
  const e: string[] = [];
  if (s.reversionPedidaEn) e.push('Hay una reversion pedida: no se elimina');
  if (estado !== 'GRACIA') e.push(`El centro debe estar en GRACIA (esta en ${estado})`);
  if (!s.siloDetenidoEn) e.push('Falta confirmar que el silo esta detenido');
  if (!s.confirmacionEn) e.push('Falta la confirmacion escrita del centro antes de borrar');
  if (!s.graciaHasta || s.graciaHasta > ahora) e.push(`La gracia vence ${s.graciaHasta ? s.graciaHasta.toISOString().slice(0, 10) : '(sin acta)'}`);
  return e;
}

export type EstadoPasoSalida = 'hecho' | 'actual' | 'pendiente';

/** Linea de tiempo S1..S8 para la consola. */
export function pasos(estado: EstadoCentro, s: EstadoSalida & { actaRecepcionHash: string | null; eliminadoEn: Date | null }) {
  const orden: EstadoCentro[] = ['EN_SALIDA', 'EXPORTADO', 'GRACIA', 'ELIMINADO'];
  const i = orden.indexOf(estado);
  const p = (hecho: boolean, actual: boolean): EstadoPasoSalida => (hecho ? 'hecho' : actual ? 'actual' : 'pendiente');
  return [
    { codigo: 'S1', l: 'Solicitud y fecha de corte', estado: p(i >= 0, false) },
    { codigo: 'S2', l: 'Solo lectura (lo avisa el centro; R12 en el ERP)', estado: p(i >= 0, false) },
    { codigo: 'S3-S4', l: 'Exporte cifrado generado por el ADMIN', estado: p(!!s.actaRecepcionHash, i === 0) },
    { codigo: 'S5', l: 'Acta de recepcion', estado: p(!!s.actaRecepcionHash, i === 0) },
    { codigo: 'S6', l: 'Silo detenido y gracia', estado: p(!!s.siloDetenidoEn, i === 1) },
    { codigo: 'S6b', l: 'Confirmacion escrita antes de borrar', estado: p(!!s.confirmacionEn, i === 1 || i === 2) },
    { codigo: 'S7', l: 'Eliminacion y acta', estado: p(!!s.eliminadoEn, i === 2) },
    { codigo: 'S8', l: 'Cierre: solo metadatos', estado: p(!!s.eliminadoEn, false) },
  ];
}
