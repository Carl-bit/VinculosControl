/**
 * Catalogo de pasos por tipo de job (CONTEXTO.md seccion 5) y reglas puras de
 * la cola (con tests en pasos.spec.ts). El agente solo ejecuta pasos de una
 * lista cerrada: si recibe un codigo que no conoce, lo reporta FALLIDO.
 */
import type { EstadoJob, EstadoPaso, TipoJob } from '@prisma/client';

export interface DefPaso {
  codigo: string;
  nombre: string;
  detalle: string;
  /** control = lo corre la API al crear el job; agente = el agente del host B. */
  ejecutor: 'control' | 'agente';
}

/**
 * VERIFICAR: solo lectura. Prueba la maquinaria (cola, reclamo, reporte por paso,
 * reintento) sin crear nada en el host B. Es el ensayo previo a APROVISIONAR.
 */
const VERIFICAR: DefPaso[] = [
  { codigo: 'P0', nombre: 'Validar', detalle: 'schema v1, dependencias y hash de la revision aprobada', ejecutor: 'control' },
  { codigo: 'V1', nombre: 'Integridad', detalle: 'sha256 del manifiesto recibido = hash aprobado', ejecutor: 'agente' },
  { codigo: 'V2', nombre: 'Red de Traefik', detalle: 'existe la red proxy del host B y Traefik esta en la red de borde de cada silo', ejecutor: 'agente' },
  { codigo: 'V3', nombre: 'Nombre libre', detalle: 'no hay contenedores erp-<slug> en el host B', ejecutor: 'agente' },
  { codigo: 'V4', nombre: 'Imagen', detalle: 'vinculos-api/web en el registro (requisito R1 del ERP)', ejecutor: 'agente' },
  { codigo: 'V5', nombre: 'Capacidad', detalle: 'disco < 80 % y 1 GiB de RAM libre para el silo', ejecutor: 'agente' },
];

/**
 * REINICIAR_SILO: reinicia backend y frontend por el ejecutor del host B
 * (opcion C). No toca db, no borra nada, no toca llaves.
 */
const REINICIAR_SILO: DefPaso[] = [
  { codigo: 'P0', nombre: 'Validar', detalle: 'silo reportado por el agente, sin job activo, fuera de la ventana de respaldo', ejecutor: 'control' },
  { codigo: 'E1', nombre: 'Estado previo', detalle: 'contenedores de erp-<slug> (ejecutor)', ejecutor: 'agente' },
  { codigo: 'E2', nombre: 'Reiniciar', detalle: 'backend y despues frontend (ejecutor); db no se toca', ejecutor: 'agente' },
  { codigo: 'E3', nombre: 'Estado posterior', detalle: 'backend y frontend en marcha', ejecutor: 'agente' },
];

/**
 * RECONFIGURAR (R4): aplica al silo la revision aprobada del manifiesto
 * (modulos y reglas) por /api/internal/config, dentro de la red de borde.
 * Nace de un manifiesto aprobado (por ejemplo, al aprobar una solicitud de
 * modulo). Idempotente: la misma revision ya aplicada da SIN_CAMBIOS.
 */
const RECONFIGURAR: DefPaso[] = [
  { codigo: 'P0', nombre: 'Validar', detalle: 'revision aprobada (schema, dependencias, hash), silo reportado, fuera de la ventana de respaldo', ejecutor: 'control' },
  { codigo: 'C1', nombre: 'Aplicar', detalle: 'POST /api/internal/config con modulos y reglas de la revision', ejecutor: 'agente' },
  { codigo: 'C2', nombre: 'Confirmar', detalle: 'GET /api/internal/config: el silo tiene esa revision y ese hash', ejecutor: 'agente' },
];

/**
 * Salida (opciones B y C, decididas 2026-11-14). Nacen de una salida abierta,
 * nunca a mano desde la vista de jobs. El P0 lee el estado de la salida.
 */
const DETENER_SILO: DefPaso[] = [
  { codigo: 'P0', nombre: 'Validar', detalle: 'salida con acta de recepcion (EXPORTADO), silo reportado, fuera de la ventana de respaldo', ejecutor: 'control' },
  { codigo: 'D1', nombre: 'Estado previo', detalle: 'contenedores de erp-<slug> (ejecutor)', ejecutor: 'agente' },
  { codigo: 'D2', nombre: 'Detener', detalle: 'suelta el borde y para frontend, backend y db; no borra nada (ejecutor)', ejecutor: 'agente' },
  { codigo: 'D3', nombre: 'Comprobar', detalle: 'ningun contenedor en marcha', ejecutor: 'agente' },
];
const REANUDAR_SILO: DefPaso[] = [
  { codigo: 'P0', nombre: 'Validar', detalle: 'reversion pedida con el silo detenido, silo reportado, fuera de la ventana de respaldo', ejecutor: 'control' },
  { codigo: 'A1', nombre: 'Reanudar', detalle: 'arranca db (espera sana), backend y frontend; une el borde (ejecutor)', ejecutor: 'agente' },
  { codigo: 'A2', nombre: 'Comprobar', detalle: 'db, backend y frontend en marcha y sanos', ejecutor: 'agente' },
];
const ELIMINAR: DefPaso[] = [
  { codigo: 'P0', nombre: 'Validar', detalle: 'GRACIA vencida, confirmacion escrita, silo detenido, sin reversion, hash del acta de recepcion', ejecutor: 'control' },
  { codigo: 'X1', nombre: 'Detenido', detalle: 'ningun contenedor de erp-<slug> en marcha', ejecutor: 'agente' },
  { codigo: 'X2', nombre: 'Eliminar', detalle: 'contenedores, volumenes, redes y respaldos/<slug>/ (ejecutor; exige bajas/<slug> en el host B)', ejecutor: 'agente' },
  { codigo: 'X3', nombre: 'Comprobar', detalle: 'sin contenedores de erp-<slug>', ejecutor: 'agente' },
];

/** Pasos de aprovisionar (para mostrarlos y documentar el bloqueo; aun no se encolan). */
export const PASOS_APROVISIONAR: DefPaso[] = [
  { codigo: 'P0', nombre: 'Validar', detalle: 'schema, dependencias, dominio, imagen', ejecutor: 'control' },
  { codigo: 'P1', nombre: 'Reservar', detalle: 'registro del silo y red', ejecutor: 'agente' },
  { codigo: 'P2', nombre: 'Secretos generables', detalle: 'contrasenas de BD y JWT en silos/<slug>/.env (600)', ejecutor: 'agente' },
  { codigo: 'P3', nombre: 'Compose', detalle: 'render de silo.compose.tpl y docker compose config', ejecutor: 'agente' },
  { codigo: 'P4', nombre: 'BD y migraciones', detalle: 'up db migrate', ejecutor: 'agente' },
  { codigo: 'P5', nombre: 'Llaves (manual)', detalle: 'el operador corre infra/scripts/llaves/aprovisionar.sh', ejecutor: 'agente' },
  { codigo: 'P6', nombre: 'Levantar', detalle: 'up -d y /api/salud 200', ejecutor: 'agente' },
  { codigo: 'P7', nombre: 'Carga inicial', detalle: '/api/internal/config (requisito R4)', ejecutor: 'agente' },
  { codigo: 'P8', nombre: 'Dominio', detalle: 'ruta en el tunel y certificado', ejecutor: 'agente' },
  { codigo: 'P9', nombre: 'Continuidad', detalle: 'instalar.sh, primer respaldo y restauracion de prueba', ejecutor: 'agente' },
  { codigo: 'P10', nombre: 'Admin y cierre', detalle: '/api/internal/admin-inicial (requisito R5) y ACTIVO', ejecutor: 'agente' },
];

/** Tipos que hoy se pueden encolar, con sus pasos. El resto responde por que no. */
export const EJECUTABLES: Partial<Record<TipoJob, DefPaso[]>> = { VERIFICAR, REINICIAR_SILO, RECONFIGURAR, DETENER_SILO, REANUDAR_SILO, ELIMINAR };

/** Jobs sobre un silo existente (no nacen de un manifiesto aprobado). */
export const SOBRE_SILO: readonly TipoJob[] = ['REINICIAR_SILO'];

/** Jobs que nacen de una salida (Salidas en la consola), con su propio P0. */
export const DE_SALIDA: readonly TipoJob[] = ['DETENER_SILO', 'REANUDAR_SILO', 'ELIMINAR'];

/** Ventana del respaldo diario (02:00 Chile): no se tocan silos entre 01:45 y 02:30. Igual que el ejecutor. */
export function enVentanaRespaldo(ahora: Date): boolean {
  const [h, m] = new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(ahora)
    .split(':')
    .map(Number);
  const min = h * 60 + m;
  return min >= 105 && min < 150;
}

export const BLOQUEO: Partial<Record<TipoJob, string>> = {
  APROVISIONAR: 'Bloqueado: requiere imagenes unicas (R1), /api/internal/* (R4, R5) y escritura en el docker-socket-proxy',
  ACTUALIZAR: 'Bloqueado: requiere imagenes unicas y registro de releases (R1)',
  REINICIAR_DEMO: 'Bloqueado: requiere demo:resembrar en el ERP (R10: resembrar datos ficticios conservando llaves). Para reiniciar contenedores sin tocar datos: REINICIAR_SILO',
  EXPORTAR: 'No aplica como job: el exporte lo genera el ADMIN en su silo (S3-S4) y la consola registra el acta en Salidas. Traer la huella sola requiere R13 en el ERP',
};

export const ACTIVOS: readonly EstadoJob[] = ['PENDIENTE', 'EN_CURSO', 'ESPERANDO_LLAVES'];
export const FINALES_PASO: readonly EstadoPaso[] = ['OK', 'FALLIDO', 'OMITIDO'];

/** Reserva del agente sobre un job: se renueva con cada reporte de paso. */
export const RESERVA_MS = 120_000;

/** Estado del job tras un reporte de paso: un FALLIDO lo detiene; si todo termino bien, OK. */
export function estadoTrasPasos(pasos: { estado: EstadoPaso }[]): EstadoJob {
  if (pasos.some((p) => p.estado === 'FALLIDO')) return 'FALLIDO';
  if (pasos.every((p) => p.estado === 'OK' || p.estado === 'OMITIDO')) return 'OK';
  return 'EN_CURSO';
}

/** Reintentar: solo un job FALLIDO; vuelven a PENDIENTE los pasos que no terminaron bien (los OK no se repiten). */
export function pasosAReintentar(pasos: { codigo: string; estado: EstadoPaso }[]): string[] {
  return pasos.filter((p) => p.estado === 'FALLIDO' || p.estado === 'EN_CURSO').map((p) => p.codigo);
}

export const puedeCancelar = (e: EstadoJob) => ACTIVOS.includes(e) || e === 'FALLIDO';

/** Recorta el log que manda el agente (lineas cortas, sin saltos). */
export const limpiarLog = (lineas: unknown): string[] =>
  Array.isArray(lineas) ? lineas.filter((l): l is string => typeof l === 'string').slice(0, 30).map((l) => l.replace(/[\r\n]+/g, ' ').slice(0, 300)) : [];
