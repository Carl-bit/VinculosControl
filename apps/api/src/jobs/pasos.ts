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
  /**
   * control = lo corre la API al crear el job; agente = el agente del host B;
   * operador = accion manual que el operador confirma en la consola (el job
   * espera en ESPERANDO_LLAVES u ESPERANDO_OPERADOR).
   */
  ejecutor: 'control' | 'agente' | 'operador';
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
/** R12: S2 automatico. No para contenedores ni borra nada; un ERP anterior a R12 responde 404 y el paso falla sin bloquear la salida. */
const SOLO_LECTURA: DefPaso[] = [
  { codigo: 'P0', nombre: 'Validar', detalle: 'ACTIVAR: salida abierta sin reversion; QUITAR: reversion pedida en la ultima salida; silo reportado', ejecutor: 'control' },
  { codigo: 'L1', nombre: 'Solo lectura', detalle: 'POST /api/internal/salida por la red de borde (token del silo) y comprueba el estado con GET', ejecutor: 'agente' },
];
const ELIMINAR: DefPaso[] = [
  { codigo: 'P0', nombre: 'Validar', detalle: 'GRACIA vencida, confirmacion escrita, silo detenido, sin reversion, hash del acta de recepcion', ejecutor: 'control' },
  { codigo: 'X1', nombre: 'Detenido', detalle: 'ningun contenedor de erp-<slug> en marcha', ejecutor: 'agente' },
  { codigo: 'X2', nombre: 'Eliminar', detalle: 'contenedores, volumenes, redes y respaldos/<slug>/ (ejecutor; exige bajas/<slug> en el host B)', ejecutor: 'agente' },
  { codigo: 'X3', nombre: 'Comprobar', detalle: 'sin contenedores de erp-<slug>', ejecutor: 'agente' },
];

/**
 * APROVISIONAR (CONTEXTO.md seccion 5; habilitado 2026-11-15 con R1, R4 y R5).
 * P3 (compose) va dentro de P2: el verbo preparar del ejecutor renderiza y
 * valida el compose en la misma llamada. P5 es manual (llaves: solo el
 * operador). P8 lo verifica el agente; si el dominio no responde, el job espera
 * al operador (ESPERANDO_OPERADOR) y nunca queda ACTIVO_SIN_DOMINIO.
 */
export const PASOS_APROVISIONAR: DefPaso[] = [
  { codigo: 'P0', nombre: 'Validar', detalle: 'manifiesto (schema, dependencias, hash), version fija, slug y dominio libres, nombre y tema aceptados por el ejecutor', ejecutor: 'control' },
  { codigo: 'P1', nombre: 'Reservar', detalle: 'centro APROVISIONANDO y registro del silo', ejecutor: 'control' },
  { codigo: 'P2', nombre: 'Preparar', detalle: 'capacidad del host; imagen por digest en el registro; .env (600) con secretos generados en el host B; compose renderizado y validado (ejecutor: preparar)', ejecutor: 'agente' },
  { codigo: 'P4', nombre: 'BD y migraciones', detalle: 'up db migrate; migrate termina en 0 (ejecutor: levantar bd)', ejecutor: 'agente' },
  { codigo: 'P5', nombre: 'Llaves (manual)', detalle: 'el operador corre infra/scripts/llaves/aprovisionar.sh del ERP y lo confirma aqui', ejecutor: 'operador' },
  { codigo: 'P6', nombre: 'Levantar', detalle: 'up del silo completo, borde unido y /api/salud 200 (ejecutor: levantar todo)', ejecutor: 'agente' },
  { codigo: 'P7', nombre: 'Carga inicial', detalle: 'POST /api/internal/config con modulos y reglas de la revision (R4) y confirmacion', ejecutor: 'agente' },
  { codigo: 'P8', nombre: 'Dominio', detalle: 'https://<dominio>/api/salud 200 por el tunel; si no responde, espera al operador', ejecutor: 'agente' },
  { codigo: 'P9', nombre: 'Continuidad', detalle: 'respaldos/<slug>/ con un respaldo y su .sha256 (instalar.sh del ERP)', ejecutor: 'agente' },
  { codigo: 'P10', nombre: 'Admin y cierre', detalle: 'invitacion del ADMIN inicial por /api/internal/admin-inicial (R5); centro ACTIVO', ejecutor: 'agente' },
];

/**
 * ACTUALIZAR (CONTEXTO.md seccion 7; decisiones del usuario 2026-11-15): un
 * silo a la vez. UC (confirmar un minor) es manual y queda OMITIDO en un patch.
 * Si U3, U4 o U5 fallan, el agente vuelve a la imagen anterior (revertir) antes
 * de reportar el fallo: el silo nunca queda a medio actualizar.
 */
export const PASOS_ACTUALIZAR: DefPaso[] = [
  { codigo: 'U0', nombre: 'Validar', detalle: 'version promovida al canal del silo y posterior a la actual, sin conflicto; silo reportado; fuera de la ventana de respaldo', ejecutor: 'control' },
  { codigo: 'UC', nombre: 'Confirmar minor', detalle: 'un minor (0.x) puede traer cambios incompatibles: el operador lo confirma para este silo', ejecutor: 'operador' },
  { codigo: 'U1', nombre: 'Respaldo', detalle: 'pg_dump cifrado en respaldos/<slug>/ con su .sha256 (ejecutor: respaldar; la llave solo la monta un auxiliar sin red)', ejecutor: 'agente' },
  { codigo: 'U2', nombre: 'Imagen nueva', detalle: 'lineas de imagen del .env a la version nueva; las anteriores en anterior.env (ejecutor: actualizar)', ejecutor: 'agente' },
  { codigo: 'U3', nombre: 'Migraciones', detalle: 'migrate con la imagen nueva termina en 0 (ejecutor: levantar bd); si falla, vuelve a la imagen anterior', ejecutor: 'agente' },
  { codigo: 'U4', nombre: 'Recrear', detalle: 'backend y frontend con la imagen nueva y borde unido (ejecutor: levantar todo)', ejecutor: 'agente' },
  { codigo: 'U5', nombre: 'Salud', detalle: '/api/salud 200; si no responde, vuelve a la imagen anterior (ejecutor: revertir)', ejecutor: 'agente' },
  { codigo: 'U6', nombre: 'Notas de version', detalle: 'entrega al silo las notas de la version para su ADMIN (/api/internal/notas-version, R6); si no se pueden entregar no falla', ejecutor: 'agente' },
];

/** Tipos que hoy se pueden encolar, con sus pasos. El resto responde por que no. */
export const EJECUTABLES: Partial<Record<TipoJob, DefPaso[]>> = {
  VERIFICAR,
  REINICIAR_SILO,
  RECONFIGURAR,
  DETENER_SILO,
  REANUDAR_SILO,
  SOLO_LECTURA,
  ELIMINAR,
  APROVISIONAR: PASOS_APROVISIONAR,
  ACTUALIZAR: PASOS_ACTUALIZAR,
};

/** Estado de espera de un paso manual: P5 (llaves) tiene el suyo; el resto espera al operador. */
export const esperaManual = (codigo: string): EstadoJob => (codigo === 'P5' ? 'ESPERANDO_LLAVES' : 'ESPERANDO_OPERADOR');

/** Pasos manuales que el operador confirma en la consola, por tipo de job, con el estado en que se espera. */
export const CONFIRMABLES: Partial<Record<TipoJob, Record<string, EstadoJob>>> = {
  APROVISIONAR: { P5: 'ESPERANDO_LLAVES', P8: 'ESPERANDO_OPERADOR' },
  ACTUALIZAR: { UC: 'ESPERANDO_OPERADOR' },
};

/** Esperas que el agente puede pedir en un paso (y solo en ese paso) de APROVISIONAR. */
export const ESPERAS: Record<string, { paso: string; estado: EstadoJob; reabre: string }> = {
  /** P6 sin KEK: el ejecutor no crea backend ni frontend. Vuelve a P5 (manual). */
  LLAVES: { paso: 'P6', estado: 'ESPERANDO_LLAVES', reabre: 'P5' },
  /** P8 sin respuesta del dominio: el operador configura la ruta del tunel. */
  DOMINIO: { paso: 'P8', estado: 'ESPERANDO_OPERADOR', reabre: 'P8' },
};

/** Siguiente paso sin terminar, en orden. */
export function siguientePaso<T extends { orden: number; estado: EstadoPaso }>(pasos: T[]): T | undefined {
  return [...pasos].sort((a, b) => a.orden - b.orden).find((p) => p.estado !== 'OK' && p.estado !== 'OMITIDO');
}

/** Un paso solo se reporta cuando todos los anteriores terminaron bien (el orden lo impone la API). */
export function anterioresListos(pasos: { orden: number; estado: EstadoPaso }[], orden: number): boolean {
  return pasos.filter((p) => p.orden < orden).every((p) => p.estado === 'OK' || p.estado === 'OMITIDO');
}

/** Jobs sobre un silo existente (no nacen de un manifiesto aprobado). */
export const SOBRE_SILO: readonly TipoJob[] = ['REINICIAR_SILO'];

/** Jobs que nacen de una salida (Salidas en la consola), con su propio P0. */
export const DE_SALIDA: readonly TipoJob[] = ['DETENER_SILO', 'REANUDAR_SILO', 'SOLO_LECTURA', 'ELIMINAR'];

/** Ventana del respaldo diario (02:00 Chile): no se tocan silos entre 01:45 y 02:30. Igual que el ejecutor. */
export function enVentanaRespaldo(ahora: Date): boolean {
  const [h, m] = new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(ahora)
    .split(':')
    .map(Number);
  const min = h * 60 + m;
  return min >= 105 && min < 150;
}

/** Jobs que se encolan desde su propia vista (no desde la lista de jobs con un centro). */
export const CON_VISTA_PROPIA: Partial<Record<TipoJob, string>> = {
  ACTUALIZAR: 'ACTUALIZAR se encola desde el silo o desde Releases (cascada)',
};

export const BLOQUEO: Partial<Record<TipoJob, string>> = {
  REINICIAR_DEMO: 'Bloqueado: requiere demo:resembrar en el ERP (R10: resembrar datos ficticios conservando llaves). Para reiniciar contenedores sin tocar datos: REINICIAR_SILO',
  EXPORTAR: 'No aplica como job: el exporte lo genera el ADMIN en su silo (S3-S4) y la consola registra el acta en Salidas. Traer la huella sola requiere R13 en el ERP',
};

export const ACTIVOS: readonly EstadoJob[] = ['PENDIENTE', 'EN_CURSO', 'ESPERANDO_LLAVES', 'ESPERANDO_OPERADOR'];
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

/**
 * ACTUALIZAR: un fallo en U3, U4 o U5 ya volvio el silo a la imagen anterior
 * (revertir). Reintentar solo el paso fallido correria la imagen vieja y el job
 * terminaria OK sin actualizar: se rehace desde U2 (cambio de imagen) en adelante.
 */
export function reintentoActualizar(pasos: { codigo: string; estado: EstadoPaso }[]): string[] {
  const fallido = pasos.find((p) => p.estado === 'FALLIDO' || p.estado === 'EN_CURSO');
  if (!fallido || !['U3', 'U4', 'U5'].includes(fallido.codigo)) return pasosAReintentar(pasos);
  return ['U2', 'U3', 'U4', 'U5'];
}

export const puedeCancelar =(e: EstadoJob) => ACTIVOS.includes(e) || e === 'FALLIDO';

/** Recorta el log que manda el agente (lineas cortas, sin saltos). */
export const limpiarLog = (lineas: unknown): string[] =>
  Array.isArray(lineas) ? lineas.filter((l): l is string => typeof l === 'string').slice(0, 30).map((l) => l.replace(/[\r\n]+/g, ' ').slice(0, 300)) : [];
