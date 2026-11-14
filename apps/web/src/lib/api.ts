'use client';

import { useCallback, useEffect, useState } from 'react';

/* Tipos de las respuestas de /consola (apps/api/src/consola/consola.controller.ts). */
export interface Contenedor {
  servicio: string;
  estado: string;
  cpuPct: number;
  memBytes: number;
  memLimite: number;
  reinicios: number;
  oom: boolean;
}
export interface Alerta {
  id: number;
  clave: string;
  tipo: string;
  severidad: 'S1' | 'S2' | 'S3';
  slug: string | null;
  mensaje: string;
  abiertaEn: string;
  cerradaEn: string | null;
}
export interface FilaSilo {
  slug: string;
  dominio: string | null;
  adoptado: boolean;
  vistoEn: string | null;
  salud: { en: string; ok: boolean; http: number | null; bd: boolean | null; canarios: boolean | null; latenciaMs: number | null; error: string | null } | null;
  contenedores: Contenedor[];
  p95Max: number | null;
  respaldo: { archivo: string; fecha: string; bytes: number; sha256: string | null } | null;
}
export interface Resumen {
  agente: { nombre: string; version: string | null; ultimoLatido: string | null } | null;
  host: { en: string; discoPct: number; memUsada: number; memTotal: number; carga1: number; cpus: number } | null;
  silos: FilaSilo[];
  alertas: Alerta[];
  solicitudesNuevas: number;
  jobsActivos: number;
  incidentesAbiertos: number;
  eventos: EventoAuditoria[];
}
export interface Detalle extends Omit<FilaSilo, 'salud' | 'contenedores'> {
  salud: { en: string; ok: boolean; http: number | null; latenciaMs: number | null }[];
  contenedores: { en: string; servicio: string; cpuPct: number; memBytes: number; memLimite: number }[];
  latencias: { ruta: string; n: number; p50: number; p95: number; max: number }[];
  alertas: Alerta[];
  centro: { id: number; nombre: string; estado: string; revisionAprobada: number | null; hashAprobado: string | null } | null;
  jobs: { id: number; tipo: string; estado: string; creadoEn: string; creadoPor: string }[];
}

export interface Yo {
  nombre: string;
  correo: string;
  sesion: { desde: string; ip: string | null; inactividadMin: number };
}
export interface EventoAuditoria {
  id: string;
  en: string;
  actor: string;
  accion: string;
  objeto: string | null;
  detalle: string | null;
}

export type EstadoCentro =
  | 'SOLICITUD'
  | 'CONTACTADO'
  | 'REUNION'
  | 'DATOS_COMPLETOS'
  | 'APROBADO'
  | 'APROVISIONANDO'
  | 'ACTIVO'
  | 'ACTIVO_SIN_DOMINIO'
  | 'SUSPENDIDO'
  | 'EN_SALIDA'
  | 'EXPORTADO'
  | 'GRACIA'
  | 'ELIMINADO'
  | 'DESCARTADO';
export interface FilaCentro {
  id: number;
  slug: string | null;
  nombre: string;
  estado: EstadoCentro;
  contactoNombre: string;
  contactoCorreo: string;
  contactoTelefono: string | null;
  comuna: string;
  origen: string;
  creadoEn: string;
  tamanoEquipo: string | null;
  modulosInteres: string[];
}
export interface CentroDetalle extends Omit<FilaCentro, 'tamanoEquipo' | 'modulosInteres'> {
  transiciones: { id: number; desde: EstadoCentro | null; hacia: EstadoCentro; actor: string; motivo: string | null; en: string }[];
  revisiones: { numero: number; fase: number; hash: string; autor: string; creadaEn: string }[];
  revisionAprobada: number | null;
  hashAprobado: string | null;
  aprobadoEn: string | null;
  fase1: Record<string, unknown> | null;
  fase2: {
    borrador: import('@vinculos/manifest').Borrador;
    revisionBorrador: { numero: number; hash: string } | null;
    p0: { ok: boolean; errores: string[] };
    datosCentroCompletos: boolean;
    faltanCentro: string[];
    slugSugerido: string;
    dominioBase: string;
    enlace: { enviadoA: string; creadoEn: string; venceEn: string; ultimoUsoEn: string | null; activo: boolean; revocado: boolean } | null;
  };
  siguiente: { hacia: EstadoCentro; accion: string } | null;
  puedeDescartar: boolean;
}

export type EstadoJob = 'PENDIENTE' | 'EN_CURSO' | 'ESPERANDO_LLAVES' | 'FALLIDO' | 'OK' | 'CANCELADO';
export type EstadoPaso = 'PENDIENTE' | 'EN_CURSO' | 'OK' | 'FALLIDO' | 'OMITIDO';
export interface PasoJob {
  id: number;
  orden: number;
  codigo: string;
  nombre: string;
  detalle: string;
  ejecutor: 'control' | 'agente';
  estado: EstadoPaso;
  intentos: number;
  inicioEn: string | null;
  finEn: string | null;
  log: string[];
  error: string | null;
}
export interface FilaJob {
  id: number;
  tipo: string;
  estado: EstadoJob;
  centroId: number | null;
  siloSlug: string | null;
  revision: number | null;
  hashManifiesto: string | null;
  creadoPor: string;
  creadoEn: string;
  terminadoEn: string | null;
  error: string | null;
  pasos: { codigo: string; estado: EstadoPaso }[];
}
export interface DetalleJob extends Omit<FilaJob, 'pasos'> {
  pasos: PasoJob[];
  centro: { id: number; nombre: string; slug: string | null; estado: string } | null;
  agente: string | null;
  intentos: number;
  reclamadoEn: string | null;
  puedeCancelar: boolean;
}

export type EstadoHito = 'cumplido' | 'cumplido_tarde' | 'pendiente' | 'por_vencer' | 'vencido' | 'no_aplica';
export interface Incidente {
  id: number;
  severidad: 'S1' | 'S2' | 'S3';
  titulo: string;
  siloSlug: string | null;
  alertaId: number | null;
  detectadoEn: string;
  contenidoEn: string | null;
  avisoCentroEn: string | null;
  ultimaActualizacionEn: string | null;
  informeFinalEn: string | null;
  cerradoEn: string | null;
  creadoPor: string;
  hitos: { clave: string; l: string; venceEn: string | null; cumplidoEn: string | null; estado: EstadoHito }[];
  semaforo: 'vencido' | 'por_vencer' | 'al_dia' | 'cerrado';
  eventos?: { id: number; tipo: string; texto: string; actor: string; en: string }[];
}
export interface SolicitudSoporte {
  id: number;
  siloSlug: string;
  motivo: string;
  alcance: 'DIAGNOSTICO' | 'CONFIGURACION';
  autorizadaEn: string;
  venceEn: string;
  estado: 'ABIERTA' | 'CERRADA' | 'VENCIDA';
  resultado: string | null;
  creadoPor: string;
  creadoEn: string;
}
/* Salidas (apps/api/src/salidas): expediente y actas, sin contenido del exporte. */
export type ExpedienteSalida = 'abierta' | 'reversion_pendiente' | 'revertida' | 'eliminada';
export interface FilaSalida {
  id: number;
  expediente: ExpedienteSalida;
  revertidaEn: string | null;
  centroId: number;
  siloSlug: string;
  nombre: string;
  estado: EstadoCentro;
  fechaCorte: string;
  iniciadaEn: string;
  graciaHasta: string | null;
  diasGracia: number | null;
  eliminadoEn: string | null;
}
export interface DetalleSalida {
  id: number;
  expediente: ExpedienteSalida;
  puedeRevertir: boolean;
  detencionJobId: number | null;
  eliminacionJobId: number | null;
  /** Items del checklist S7 que probo el job ELIMINAR. */
  porJob: string[];
  evidenciaEliminacion: string[];
  jobs: { id: number; tipo: string; estado: EstadoJob; creadoEn: string; error: string | null }[];
  reversionMotivo: string | null;
  reversionSolicitudEn: string | null;
  reversionMedio: string | null;
  reversionRef: string | null;
  reversionPedidaPor: string | null;
  reversionPedidaEn: string | null;
  reversionJobId: number | null;
  actaReversion: { texto: string; vuelveA: string; siloReanudado: string } | null;
  actaReversionHash: string | null;
  revertidaEn: string | null;
  centroId: number;
  siloSlug: string;
  nombre: string;
  estado: EstadoCentro;
  fechaCorte: string;
  motivo: string;
  desde: EstadoCentro;
  iniciadaPor: string;
  iniciadaEn: string;
  exporteEn: string | null;
  exporteBytes: number | null;
  exporteHuella: string | null;
  actaRecepcionFirmadaEn: string | null;
  recibeNombre: string | null;
  recibeCargo: string | null;
  conteoPacientes: number | null;
  conteoFichas: number | null;
  actaRecepcionHash: string | null;
  actaRecepcionPor: string | null;
  graciaDias: number;
  graciaHasta: string | null;
  diasGracia: number | null;
  siloDetenidoEn: string | null;
  siloDetenidoPor: string | null;
  confirmacionEn: string | null;
  confirmacionMedio: 'CORREO' | 'DOCUMENTO' | 'OTRO' | null;
  confirmacionRef: string | null;
  confirmacionPor: string | null;
  actaEliminacion: { texto: string; items: Record<string, string | boolean>; nota: string | null; eliminadoPor: string; evidencia?: string[] | null } | null;
  actaEliminacionHash: string | null;
  eliminadoEn: string | null;
  eliminadoPor: string | null;
  pasos: { codigo: string; l: string; estado: 'hecho' | 'actual' | 'pendiente' }[];
  bloqueosEliminar: string[];
  checklist: { clave: string; l: string }[];
  /** Copias de actas (eliminacion o reversion) enviadas al centro (de la auditoria). */
  envios: { en: string; ok: boolean; tipo: string; para: string | null }[];
}

export interface Configuracion {
  plazos: { k: string; v: string }[];
  seguridad: { k: string; v: string }[];
  correo: { k: string; v: string }[];
  operadores: { id: number; correo: string; nombre: string; activo: boolean; bloqueada: boolean; creadoEn: string }[];
  sesiones: { id: number; operador: string; desde: string; ultimaActividad: string; ip: string | null; actual: boolean }[];
}

/** 401 de una ruta con sesion = sesion vencida o revocada: el proxy ya borro la cookie; vuelta al login. */
function sinSesion(r: Response): boolean {
  if (r.status !== 401) return false;
  window.location.assign('/ingreso');
  return true;
}

/** GET con refresco periodico (la consola no usa websockets: polling cada `ms`). */
export function useDatos<T>(ruta: string, ms = 15_000) {
  const [datos, setDatos] = useState<T>();
  const [error, setError] = useState<string>();
  const cargar = useCallback(async () => {
    try {
      const r = await fetch(`/api/${ruta}`, { cache: 'no-store' });
      if (sinSesion(r)) return;
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setDatos((await r.json()) as T);
      setError(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'sin conexion');
    }
  }, [ruta]);
  useEffect(() => {
    void cargar();
    const t = setInterval(() => void cargar(), ms);
    return () => clearInterval(t);
  }, [cargar, ms]);
  return { datos, error, recargar: cargar };
}

export async function accion(ruta: string): Promise<void> {
  const r = await fetch(`/api/${ruta}`, { method: 'POST' });
  if (sinSesion(r)) return;
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
}

/** POST con cuerpo JSON en una ruta con sesion: si la sesion vencio, vuelve al login. */
export async function enviarConSesion<T>(ruta: string, cuerpo?: unknown) {
  const r = await enviar<T>(ruta, cuerpo);
  if (r.status === 401) window.location.assign('/ingreso');
  return r;
}

/** POST con cuerpo JSON para el login: devuelve status y cuerpo (los errores traen { mensaje }). */
export async function enviar<T>(ruta: string, cuerpo?: unknown): Promise<{ ok: boolean; status: number; datos: T & { mensaje?: string | string[] } }> {
  const r = await fetch(`/api/${ruta}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const texto = await r.text();
  let datos = {} as T & { mensaje?: string | string[] };
  try {
    datos = texto ? JSON.parse(texto) : datos;
  } catch {
    /* respuesta sin JSON */
  }
  return { ok: r.ok, status: r.status, datos };
}

/** Mensaje de error legible: la API manda { mensaje } o, desde el ValidationPipe, { message: [...] }. */
export function mensajeDe(d: { mensaje?: string | string[]; message?: string | string[] }, porDefecto: string): string {
  const m = d.mensaje ?? d.message;
  return (Array.isArray(m) ? m[0] : m) ?? porDefecto;
}

export const mib = (b: number) => `${Math.round(b / 1024 / 1024)}`;
export const gib = (b: number) => (b / 1024 ** 3).toFixed(1);

/** "hace 12 s", "hace 3 min", "hace 2 h". */
export function hace(iso: string | null | undefined): string {
  if (!iso) return 'nunca';
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `hace ${s} s`;
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 172_800) return `hace ${Math.round(s / 3600)} h`;
  return `hace ${Math.round(s / 86_400)} d`;
}
