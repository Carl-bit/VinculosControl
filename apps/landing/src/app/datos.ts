import { DEPENDENCIAS, type ModuloMvp } from '@vinculos/manifest';

/*
 * Contenido de la landing (boceto system-reference/Landing, sin Cobros: el MVP
 * no maneja finanzas). Las dependencias salen de @vinculos/manifest, las mismas
 * que valida P0: la landing no puede ofrecer una combinacion que el manifiesto
 * rechace. Las "capturas" son maquetas con datos ficticios, nunca pantallas
 * reales de un centro.
 */

export type IdBloque = 'NUCLEO' | ModuloMvp;

export interface Bloque {
  id: IdBloque;
  n: string;
  t: string;
  /** Clase de color del bloque (tokens --m-<clase> en globals.css). */
  c: string;
  fijo?: boolean;
  corto: string;
  problema: string;
  quien: string[];
  pasos: string[];
  cap: { t: string; filas: [string, string, string][] };
  nota?: string;
}

export const BLOQUES: Bloque[] = [
  {
    id: 'NUCLEO',
    n: 'Núcleo',
    t: 'Seguridad y accesos',
    c: 'nucleo',
    fijo: true,
    corto: 'Cuentas, roles y verificación en dos pasos. Siempre incluido.',
    problema: 'Claves compartidas, planillas que circulan por correo y nadie sabe quién vio qué.',
    quien: ['Todo el equipo', 'Pacientes'],
    pasos: ['El admin invita al equipo por correo', 'Cada persona crea su contraseña', 'Verificación en dos pasos con código', 'Cada rol ve solo lo que le corresponde'],
    cap: { t: 'Equipo y accesos', filas: [['Ana Pérez', 'Admin', 'Activo'], ['Ps. Camila Rojas', 'Profesional', 'Activo'], ['Diego Muñoz', 'Practicante', 'Invitado']] },
  },
  {
    id: 'FICHAS',
    n: 'Fichas',
    t: 'Fichas y pacientes',
    c: 'fichas',
    corto: 'Ficha clínica que solo ve el profesional tratante.',
    problema: 'Fichas en papel o en documentos sueltos, sin control de acceso ni respaldo.',
    quien: ['Profesionales', 'Practicantes supervisados'],
    pasos: ['El paciente llega por reserva o derivación', 'Se abre su ficha con el tratante asignado', 'Evolución por sesión', 'Derivación o segunda opinión con acceso temporal', 'Se conserva al menos 15 años'],
    cap: { t: 'Mis pacientes', filas: [['F-0142', 'Evolución pendiente', 'Hoy'], ['F-0137', 'Derivación recibida', 'Nuevo'], ['F-0121', 'Al día', 'Ok']] },
  },
  {
    id: 'AGENDA',
    n: 'Agenda',
    t: 'Agenda y boxes',
    c: 'agenda',
    corto: 'Horarios y boxes sin choques, presencial y online.',
    problema: 'Boxes reservados dos veces y horarios cruzados entre profesionales.',
    quien: ['Admin', 'Profesionales', 'Pacientes'],
    pasos: ['El centro configura boxes y horario de atención', 'Cada profesional publica su disponibilidad', 'La reserva bloquea el box mientras se confirma', 'Recordatorio por correo', 'Sesión presencial u online'],
    cap: { t: 'Jueves 12 nov', filas: [['10:00', 'Box 2 · Ps. Rojas', 'Confirmada'], ['11:00', 'Online · Ps. Soto', 'Por confirmar'], ['12:00', 'Box 1 · Ps. Lagos', 'Confirmada']] },
  },
  {
    id: 'EQUIPO',
    n: 'Equipo',
    t: 'Equipo y perfiles',
    c: 'equipo',
    corto: 'Validación de profesionales y practicantes con su supervisor.',
    problema: 'Títulos y registros que nadie revisa, practicantes sin seguimiento.',
    quien: ['Admin', 'Profesionales', 'Practicantes'],
    pasos: ['El admin invita a un profesional', 'El profesional sube su registro RNPI y su título', 'El admin valida los documentos', 'El profesional edita su propio perfil público', 'Practicantes con supervisor y certificado vigente'],
    cap: { t: 'Validaciones', filas: [['Ps. Camila Rojas', 'RNPI verificado', 'Ok'], ['Ps. Tomás Soto', 'Título por revisar', 'Pendiente'], ['Diego Muñoz', 'Certificado vence en 5 días', 'Aviso']] },
  },
  {
    id: 'MATCH',
    n: 'Match',
    t: 'Match terapéutico',
    c: 'match',
    corto: 'Ayuda al paciente a elegir con quién atenderse.',
    problema: 'El paciente no sabe con quién atenderse y escribe a todos por WhatsApp.',
    quien: ['Pacientes'],
    pasos: ['El paciente responde un cuestionario breve', 'Se ordena por motivo, horario y modalidad', 'Ve perfiles con su primera hora disponible', 'Elige y reserva'],
    cap: { t: 'Tu match', filas: [['Ps. Camila Rojas', 'Ansiedad · adultos', 'Mar 10:00'], ['Ps. Tomás Soto', 'Duelo · online', 'Mié 18:00'], ['Ps. Inés Lagos', 'Pareja', 'Jue 12:00']] },
  },
  {
    id: 'PAGINA_PUBLICA',
    n: 'Sitio',
    t: 'Sitio público del centro',
    c: 'sitio',
    corto: 'La web del centro con su equipo y reserva en línea.',
    problema: 'Sin página web, o una que no está conectada con la agenda real.',
    quien: ['Pacientes', 'Admin'],
    pasos: ['El centro define su estilo con nosotros', 'El equipo aparece desde sus perfiles', 'Los pacientes piden hora sin crear cuenta', 'Se integra a una web existente o funciona como sitio nuevo'],
    cap: { t: 'tucentro.vinculos.cl', filas: [['Inicio', 'Equipo y servicios', 'Publicado'], ['Pedir una hora', 'Agenda en vivo', 'Activo'], ['Match terapéutico', 'Cuestionario', 'Activo']] },
  },
];

export const bloque = (id: IdBloque) => BLOQUES.find((b) => b.id === id) ?? BLOQUES[0];
export const requiere = (id: IdBloque): ModuloMvp[] => (id === 'NUCLEO' ? [] : (DEPENDENCIAS[id].requiere as ModuloMvp[]));
export const opcional = (id: IdBloque): ModuloMvp[] => (id === 'NUCLEO' ? [] : (DEPENDENCIAS[id].opcional as ModuloMvp[]).filter((m) => BLOQUES.some((b) => b.id === m)));
const nombres = (ids: IdBloque[]) => ids.map((i) => bloque(i).n).join(' y ');

/** Activa un bloque con sus requisitos. Devuelve la seleccion (orden de BLOQUES) y el aviso de lo agregado. */
export function activar(sel: IdBloque[], id: IdBloque): { sel: IdBloque[]; msg: string } {
  const out = new Set(sel);
  const agregados: IdBloque[] = [];
  const ir = (x: IdBloque) => {
    if (!out.has(x)) {
      out.add(x);
      if (x !== id) agregados.push(x);
    }
    requiere(x).forEach(ir);
  };
  ir(id);
  return { sel: BLOQUES.map((b) => b.id).filter((x) => out.has(x)), msg: agregados.length ? `Agregamos ${nombres(agregados)} porque ${bloque(id).n} lo necesita.` : '' };
}

/** Quita un bloque y los que quedan sin su requisito. */
export function desactivar(sel: IdBloque[], id: IdBloque): { sel: IdBloque[]; msg: string } {
  if (bloque(id).fijo) return { sel, msg: 'El Núcleo siempre está incluido: es la base de seguridad.' };
  let out = sel.filter((x) => x !== id);
  const quitados: IdBloque[] = [];
  let cambio = true;
  while (cambio) {
    cambio = false;
    for (const x of out) {
      if (requiere(x).some((r) => !out.includes(r))) {
        out = out.filter((y) => y !== x);
        quitados.push(x);
        cambio = true;
      }
    }
  }
  return { sel: out, msg: quitados.length ? `También quitamos ${nombres(quitados)} porque necesita${quitados.length > 1 ? 'n' : ''} ${bloque(id).n}.` : '' };
}

export const textoRequisito = (id: IdBloque, corto = false) => {
  if (bloque(id).fijo) return corto ? 'Base de todo, siempre incluido' : 'Es la base de todos los bloques.';
  const r = requiere(id);
  if (!r.length) return corto ? 'Funciona solo' : 'Funciona solo, con el Núcleo.';
  return corto ? `Necesita ${nombres(r)}` : `Necesita: ${nombres(r)}.`;
};

/** Estado de una fila de captura: tono del chip. */
const OK = ['Ok', 'Activo', 'Confirmada', 'Lista', 'Publicado'];
const AVISO = ['Pendiente', 'Por confirmar', 'Invitado', 'Aviso', 'Nuevo', 'Hoy'];
export const tonoChip = (t: string) => (OK.includes(t) ? 'chip-ok' : AVISO.includes(t) ? 'chip-aviso' : 'chip-neutro');

export interface Rol {
  id: 'admin' | 'pro' | 'pac';
  l: string;
  d: string;
  titulo: string;
  icono: string;
  momentos: [string, string, IdBloque][];
}

export const ROLES: Rol[] = [
  {
    id: 'admin',
    l: 'Dirección del centro',
    d: 'Administra el centro, valida al equipo y ordena la agenda.',
    titulo: 'Un día de la dirección del centro',
    icono: 'M3 21h18 M5 21V8l7-5 7 5v13 M9 21v-6h6v6',
    momentos: [
      ['08:30', 'Revisa la agenda del día y la ocupación de boxes', 'AGENDA'],
      ['09:15', 'Valida el título y el RNPI de un profesional nuevo', 'EQUIPO'],
      ['11:00', 'Reasigna una derivación viendo solo el código de ficha', 'FICHAS'],
      ['13:00', 'Revisa qué profesionales recibe el match esta semana', 'MATCH'],
      ['17:30', 'Publica un nuevo servicio en el sitio del centro', 'PAGINA_PUBLICA'],
    ],
  },
  {
    id: 'pro',
    l: 'Profesional',
    d: 'Atiende, registra cada sesión y deriva cuando corresponde.',
    titulo: 'Un día de una profesional',
    icono: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21c0-4 4-6 8-6s8 2 8 6',
    momentos: [
      ['08:45', 'Ve sus pacientes del día y sus boxes', 'AGENDA'],
      ['10:00', 'Escribe la evolución después de la sesión', 'FICHAS'],
      ['12:30', 'Recibe una derivación y la acepta', 'FICHAS'],
      ['15:00', 'Revisa el trabajo de su practicante', 'EQUIPO'],
      ['19:00', 'Actualiza su perfil público', 'PAGINA_PUBLICA'],
    ],
  },
  {
    id: 'pac',
    l: 'Paciente',
    d: 'Busca ayuda, elige con quién atenderse y reserva.',
    titulo: 'El camino de un paciente',
    icono: 'M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.5-7 10-7 10z',
    momentos: [
      ['21:10', 'Busca ayuda desde el celular', 'PAGINA_PUBLICA'],
      ['21:15', 'Responde el match y ve tres opciones', 'MATCH'],
      ['21:20', 'Reserva su primera hora sin crear cuenta', 'AGENDA'],
      ['21:22', 'Recibe la confirmación por correo', 'AGENDA'],
      ['Jueves', 'Entra a su sesión online', 'AGENDA'],
    ],
  },
];

export const ESTILOS = [
  { id: 'moderno', n: 'Moderno', d: 'Superficies translúcidas, trama de puntos y colores tierra.' },
  { id: 'cuaderno', n: 'Cuaderno', d: 'Hojas con líneas, notas y cada profesional como una tapa.' },
  { id: 'editorial', n: 'Editorial', d: 'Tipografía serif, reglas finas y mucho aire. En preparación.' },
] as const;
export type IdEstilo = (typeof ESTILOS)[number]['id'];

/** Acentos de ejemplo para "el estilo de tu centro" (clases .acento-<id> en globals.css). */
export const ACENTOS = [
  { id: 'coral', l: 'Coral' },
  { id: 'ciruela', l: 'Ciruela' },
  { id: 'azul', l: 'Azul' },
] as const;

export const PROCESO: [string, string][] = [
  ['Solicitud', 'Nos cuentas lo básico de tu centro en la conversación de abajo.'],
  ['Reunión', '45 minutos para entender cómo trabajan, qué bloques necesitan y cómo es la identidad de tu centro.'],
  ['Datos formales', 'Un enlace privado para razón social, dominio y responsables.'],
  ['Tu plataforma lista', 'Creamos tu centro con su estilo e invitas a tu equipo.'],
  ['Crece o se va contigo', 'Agregas bloques cuando quieras. Si te vas, te llevas todo exportado y cifrado.'],
];

export const SEGURIDAD: [string, string][] = [
  ['La ficha es del tratante', 'Ni el admin ni Vinculos ven su contenido.'],
  ['Tu centro, tu espacio', 'Servidor y base de datos propios para cada centro.'],
  ['Cumple la ley', 'Ley 21.719 y retención de fichas por 15 años.'],
  ['Respaldos cifrados', 'Copias diarias y exporte completo si decides irte.'],
];

/**
 * Demo publico para centros (silo de demostracion con datos ficticios: el
 * estilo cambia y la plataforma funciona igual). Se fija al compilar; el silo
 * de estres no se enlaza: es solo para pruebas y monitoreo del servidor.
 */
export const DEMO_URL = process.env.NEXT_PUBLIC_DEMO_URL || 'https://demo.charlielearns.work';
