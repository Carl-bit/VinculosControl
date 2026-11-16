/**
 * R13 del ERP: estado de las exportaciones del centro, sin contenido.
 *
 * Por cada silo con token: GET http://erp-<slug>-backend-1:3001/api/internal/exportaciones
 * (red de borde) -> POST /agente/exportaciones al plano de control. Un silo con
 * un ERP anterior a R13 responde 404: se omite y la consola sigue pidiendo la
 * confirmacion del operador. U1 de ACTUALIZAR vuelve a consultarlo en vivo
 * (exporteEnCurso) justo antes del respaldo.
 */
import { llamarSilo, silosConToken } from './solicitudes';

export interface ExportacionR13 {
  id: string;
  estado: string;
  creadaEn: string;
  terminadaEn: string | null;
  venceEn: string | null;
  bytes: number | null;
  huella: string | null;
}

type Post = (ruta: string, cuerpo: unknown) => Promise<Response>;

const EN_CURSO = new Set(['PENDIENTE', 'EN_PROCESO']);
const sinR13 = (e: unknown) => e instanceof Error && /^HTTP 404\b/.test(e.message);

/** Lista del silo, o null si su ERP no tiene R13 (404). */
export async function leerExportaciones(slug: string, token: string): Promise<ExportacionR13[] | null> {
  try {
    return (await llamarSilo<{ exportaciones: ExportacionR13[] }>(slug, token, 'GET', '/exportaciones')).exportaciones;
  } catch (e) {
    if (sinR13(e)) return null;
    throw e;
  }
}

/** U1: un exporte pendiente o en proceso, la nota de que el silo no informa R13, o nada. */
export async function exporteEnCurso(slug: string, token: string): Promise<{ enCurso: ExportacionR13 | null; sinR13: boolean }> {
  const lista = await leerExportaciones(slug, token);
  if (!lista) return { enCurso: null, sinR13: true };
  return { enCurso: lista.find((e) => EN_CURSO.has(e.estado)) ?? null, sinR13: false };
}

export async function sincronizarExportaciones(post: Post): Promise<string> {
  const silos = await silosConToken();
  if (!silos.length) return 'sin silos con token interno';
  const partes: string[] = [];
  for (const { slug, token } of silos) {
    try {
      const lista = await leerExportaciones(slug, token);
      if (!lista) {
        partes.push(`${slug} sin R13`);
        continue;
      }
      // Lista explicita: solo lo que acepta el plano de control.
      const exportaciones = lista.slice(0, 20).map(({ id, estado, creadaEn, terminadaEn, venceEn, bytes, huella }) => ({ id, estado, creadaEn, terminadaEn, venceEn, bytes, huella }));
      const r = await post('exportaciones', { slug, exportaciones });
      if (!r.ok) throw new Error(`plano de control: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
      const curso = exportaciones.filter((e) => EN_CURSO.has(e.estado)).length;
      partes.push(`${slug} ${exportaciones.length}${curso ? ` (${curso} en curso)` : ''}`);
    } catch (e) {
      partes.push(`${slug} error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return partes.join('; ');
}
