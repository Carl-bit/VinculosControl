import { timingSafeEqual } from 'node:crypto';

import { BadRequestException, type Logger } from '@nestjs/common';
import { type Fase1, fase1Schema } from '@vinculos/manifest';

/** Campo oculto del formulario: una persona no lo ve ni lo llena; un bot suele llenarlo. */
export const CAMPO_TRAMPA = 'sitio_web_alternativo';

/**
 * Cuerpo de una solicitud de fase 1 (landing o formulario compartido):
 * null si el campo trampa vino lleno (se responde como exito sin guardar).
 * Valida con el schema compartido (@vinculos/manifest). `origen` lo lee quien
 * llama; aqui se descarta para que no llegue al schema.
 */
export function leerSolicitud(cuerpo: unknown, log: Logger): { datos: Fase1; origen: unknown } | null {
  if (typeof cuerpo !== 'object' || cuerpo === null || Array.isArray(cuerpo)) throw new BadRequestException({ mensaje: 'Formulario vacio' });
  const { [CAMPO_TRAMPA]: trampa, origen, ...datos } = cuerpo as Record<string, unknown>;
  if (typeof trampa === 'string' && trampa.trim()) {
    log.warn('solicitud descartada por el campo trampa');
    return null;
  }
  const r = fase1Schema.safeParse(datos);
  if (!r.success) {
    const i = r.error.issues[0];
    throw new BadRequestException({ mensaje: `Revisa ${i.path.join('.') || 'el formulario'}: ${i.message}`, campos: r.error.issues.map((x) => x.path.join('.')) });
  }
  return { datos: r.data, origen };
}

/** Compara el secreto de un proxy en tiempo constante. Sin secreto configurado (o corto), nada pasa. */
export function secretoValido(recibido: unknown, configurado: string | undefined): boolean {
  const s = Buffer.from(configurado ?? '');
  const r = Buffer.from(String(recibido ?? ''));
  return s.length >= 16 && r.length === s.length && timingSafeEqual(r, s);
}
