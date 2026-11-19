/**
 * Silos de demostracion (R10, demos desde la consola). Dos verbos, solo para
 * slugs de EJECUTOR_DEMOS (lista del .env del host B, nunca desde el plano de
 * control):
 *
 *   cargar_demo(slug, { cuentasMadre, profesionales, pacientes, nombre })
 *     corre el generador del ERP (dist/demo/generador-demo.js) en el servicio
 *     backend del silo. La contrasena de las cuentas la genera el ejecutor y,
 *     junto con correos y roles, queda en silos/<slug>/demo-cuentas.txt (600).
 *     Al agente vuelven conteos y el acceso del demo (correos ficticios, rol y
 *     contrasena) para que el operador lo comparta desde la consola (decision
 *     del usuario 2026-11-19; solo demos: cuentas ficticias de un silo de 24 h).
 *     eliminar lo borra con el resto de silos/<slug>/.
 *   resembrar_demo(slug)
 *     corre prisma/scripts/demo_resembrar.js en el servicio migrate: agenda las
 *     proximas horas, sin borrar nada ni tocar llaves.
 *
 * Los dos exigen ademas la marca de la BD (identidad_silo.es_demo, que pone
 * preparar con ES_DEMO=true para estos slugs): el script del ERP se niega sin
 * ella. Ninguno borra datos ni volumenes.
 */
import { randomBytes } from 'node:crypto';

import { argsCompose, type Compose, type Config, leerVariables, MARCA } from './aprovisionar';
import { ErrorVerbo, esSlugDemo, SLUG } from './verbos';

export interface PedidoDemo {
  cuentasMadre: number;
  profesionales: number;
  pacientes: number;
  nombre: string;
}

export interface DiscoDemo {
  leerEnv(slug: string): Promise<string | null>;
  leerCuentas(slug: string): Promise<string | null>;
  /** silos/<slug>/demo-cuentas.txt con modo 600. */
  escribirCuentas(slug: string, contenido: string): Promise<void>;
}

/** Acceso de un demo: correos ficticios con su rol y la contrasena comun. Solo slugs de EJECUTOR_DEMOS con ES_DEMO=true. */
export interface AccesoDemo {
  clave: string;
  cuentas: { rol: string; email: string }[];
}

/** Lee demo-cuentas.txt (lo escribe cargarDemo): linea de contrasena y una linea rol<TAB>correo por cuenta. */
export function leerAcceso(texto: string): AccesoDemo | null {
  const clave = /^# Contrasena de todas las cuentas: (\S+)$/m.exec(texto)?.[1];
  if (!clave) return null;
  const cuentas = texto
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.split('\t'))
    .filter((c): c is [string, string] => c.length === 2 && /^[A-Z_]{2,30}$/.test(c[0]!) && /^[^\s@]+@[^\s@]+$/.test(c[1]!))
    .map(([rol, email]) => ({ rol, email }));
  return { clave, cuentas };
}

const NOMBRE = /^[\p{L}\p{N} .,'&()-]{2,80}$/u;
const RESULTADO = /^DEMO_RESULTADO (\{.*\})$/m;

/** Prefijo con comodin: "demo-*" (letras, numeros y guiones, termina en guion, 3+ caracteres antes del *). */
const PREFIJO = /^[a-z][a-z0-9-]{1,30}-\*$/;

/**
 * Lista del .env del host B (EJECUTOR_DEMOS): slugs exactos o un prefijo con
 * comodin ("demo-*", decision del usuario 2026-11-19; el plano de control
 * reserva ese prefijo para los demos). Nunca un "*" solo.
 */
export function slugsDemo(valor: string | undefined): string[] {
  const lista = (valor ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  for (const s of lista) if (!SLUG.test(s) && !PREFIJO.test(s)) throw new Error(`EJECUTOR_DEMOS: slug o prefijo invalido (${s}; ej. demo-kibou o demo-*)`);
  return lista;
}

export { esSlugDemo } from './verbos';

export function validarPedidoDemo(p: unknown): PedidoDemo {
  const o = (p ?? {}) as Record<string, unknown>;
  if (Object.keys(o).sort().join(',') !== 'cuentasMadre,nombre,pacientes,profesionales') {
    throw new ErrorVerbo(400, 'se espera { cuentasMadre, profesionales, pacientes, nombre }');
  }
  const entero = (v: unknown, min: number, max: number, campo: string) => {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new ErrorVerbo(400, `${campo} debe ser un entero entre ${min} y ${max}`);
    return v;
  };
  if (typeof o.nombre !== 'string' || !NOMBRE.test(o.nombre)) throw new ErrorVerbo(400, 'nombre invalido');
  return {
    cuentasMadre: entero(o.cuentasMadre, 1, 3, 'cuentasMadre'),
    profesionales: entero(o.profesionales, 1, 20, 'profesionales'),
    pacientes: entero(o.pacientes, 0, 300, 'pacientes'),
    nombre: o.nombre,
  };
}

async function exigirDemo(disco: DiscoDemo, demos: string[], slug: string) {
  if (!SLUG.test(slug)) throw new ErrorVerbo(400, 'slug invalido');
  if (!esSlugDemo(demos, slug)) throw new ErrorVerbo(403, `${slug} no esta en EJECUTOR_DEMOS del host B: no es un silo de demostracion`);
  const env = await disco.leerEnv(slug);
  if (env === null || !env.startsWith(MARCA)) throw new ErrorVerbo(409, `erp-${slug} no lo aprovisiono el ejecutor`);
  const v = leerVariables(env);
  if (v.ES_DEMO !== 'true') throw new ErrorVerbo(409, `silos/${slug}/.env sin ES_DEMO=true: aprovisionar de nuevo (preparar) con el slug en EJECUTOR_DEMOS`);
  return v;
}

/** Contrasena de las cuentas del demo: 18 caracteres sin ambiguos (no sale del host B). */
const contrasena = () =>
  randomBytes(18)
    .toString('base64')
    .replace(/[+/=Il0O]/g, '')
    .slice(0, 18)
    .padEnd(18, 'x');

export async function cargarDemo(disco: DiscoDemo, c: Compose, cfg: Config, demos: string[], slug: string, pedido: PedidoDemo, ahora = new Date()) {
  const v = await exigirDemo(disco, demos, slug);
  if (!/^[0-9a-f]{48,64}$/.test(v.OWNER_DB_PASSWORD ?? '')) throw new ErrorVerbo(500, '.env del silo sin OWNER_DB_PASSWORD valida');
  const clave = contrasena();
  // Secretos por el entorno del proceso de compose (-e NOMBRE sin valor): no quedan en los argumentos.
  const env = {
    MIGRATION_DATABASE_URL: `postgresql://vinculos_owner:${v.OWNER_DB_PASSWORD}@db:5432/${v.POSTGRES_DB || 'app'}?schema=public&application_name=erp-${slug}-demo`,
    SEED_PASSWORD: clave,
    DEMO_CUENTAS_MADRE: String(pedido.cuentasMadre),
    DEMO_PROFESIONALES: String(pedido.profesionales),
    DEMO_PACIENTES: String(pedido.pacientes),
    DEMO_NOMBRE_CENTRO: pedido.nombre,
    DEMO_DOMINIO_CORREO: `${slug}.demo.vinculos.cl`,
  };
  const pasar = Object.keys(env).flatMap((k) => ['-e', k]);
  const r = await c.correr([...argsCompose(cfg, slug), 'run', '--rm', '--no-deps', '-T', ...pasar, 'backend', 'node', 'dist/demo/generador-demo.js'], 15 * 60_000, env);
  const m = RESULTADO.exec(r.salida);
  if (r.codigo !== 0 || !m) {
    // Solo la ultima linea de error del generador (sin cuerpos de la API ni la contrasena).
    const ultima = r.salida.split('\n').filter((l) => /ERROR|Error/.test(l)).at(-1) ?? `codigo ${r.codigo}`;
    throw new ErrorVerbo(500, `generador de demo fallido: ${ultima.replaceAll(clave, '***').slice(-300)}`);
  }
  const res = JSON.parse(m[1]) as { yaCargado: boolean; cuentas: { email: string; rol: string }[]; conteos?: Record<string, number> };
  const porRol: Record<string, number> = {};
  for (const x of res.cuentas) porRol[x.rol] = (porRol[x.rol] ?? 0) + 1;
  let acceso: AccesoDemo | null;
  if (!res.yaCargado) {
    await disco.escribirCuentas(
      slug,
      [
        `# Cuentas del demo erp-${slug} (${ahora.toISOString()}). Datos ficticios; eliminar lo borra con el silo.`,
        `# Contrasena de todas las cuentas: ${clave}`,
        '# Cada cuenta entra con un codigo por correo (Mailpit o SES del silo).',
        ...res.cuentas.map((x) => `${x.rol}\t${x.email}`),
        '',
      ].join('\n'),
    );
    acceso = { clave, cuentas: res.cuentas.map((x) => ({ rol: x.rol, email: x.email })) };
  } else {
    const previo = await disco.leerCuentas(slug);
    if (previo === null) throw new ErrorVerbo(409, `erp-${slug} ya tiene datos de demo pero no hay demo-cuentas.txt: no se conoce la contrasena (reconstruir el demo)`);
    // Reintento de P10: el acceso es el del archivo (la contrasena de esta corrida no se uso).
    acceso = leerAcceso(previo);
  }
  const roles = Object.entries(porRol).map(([rol, n]) => `${n} ${rol}`);
  return {
    log: [
      res.yaCargado ? 'datos de demo ya cargados (sin cambios)' : 'datos de demo generados',
      `cuentas: ${roles.join(', ')} (acceso en Demos de la consola y en silos/${slug}/demo-cuentas.txt del host B)`,
      ...(res.conteos ? [`horas ${res.conteos.horas ?? 0}, evoluciones ${res.conteos.evoluciones ?? 0}, pacientes ${res.conteos.pacientes ?? 0}`] : []),
    ],
    demo: { yaCargado: res.yaCargado, porRol, conteos: res.conteos ?? null },
    acceso,
  };
}

export async function resembrarDemo(disco: DiscoDemo, c: Compose, cfg: Config, demos: string[], slug: string) {
  await exigirDemo(disco, demos, slug);
  const r = await c.correr([...argsCompose(cfg, slug), 'run', '--rm', '--no-deps', '-T', 'migrate', 'node', 'prisma/scripts/demo_resembrar.js'], 10 * 60_000);
  const lineas = r.salida
    .split('\n')
    .map((l) => l.replace(/\x1b\[[0-9;]*m/g, '').trim())
    .filter((l) => l.includes('DemoResembrar'));
  const ultima = (lineas.at(-1) ?? '').replace(/^.*\[DemoResembrar\]\s*/, '');
  if (r.codigo !== 0) throw new ErrorVerbo(500, `resembrar fallido: ${ultima || `codigo ${r.codigo}`}`.slice(0, 400));
  return { log: [ultima || 'resembrado'] };
}

/** Custodios fijos de un demo: nadie recibe partes (se borran al terminar). */
export const CUSTODIOS_DEMO = 'Operador:proveedor,Demo:centro,Sobre:caja';

/**
 * P5 de un demo sin operador (decision del usuario 2026-11-19: los demos se
 * muestran fuera del entorno del host B y no pueden esperar un comando por SSH).
 * Corre la MISMA CLI de llaves del ERP que usa infra/scripts/llaves/aprovisionar.sh
 * con MODO=docker (dist/common/crypto/cli-llaves.js en el servicio migrate, con
 * secrets/<slug>/ montado en /llaves), con custodios de prueba, y borra las
 * partes (como --prueba). El ejecutor no lee la KEK ni las partes: solo lanza
 * contenedores que montan secrets/<slug>/ de ese demo. Solo slugs de
 * EJECUTOR_DEMOS, aprovisionados por el ejecutor y con ES_DEMO=true. Un centro
 * real sigue con P5 manual.
 *
 * Idempotente: si ya hay KEK y publica, solo asegura que no queden partes.
 */
export async function llavesDemo(disco: DiscoDemo, c: Compose, cfg: Config, demos: string[], slug: string, o: { uid: number; imagenAyudante: string }) {
  await exigirDemo(disco, demos, slug);
  if (!Number.isInteger(o.uid) || o.uid < 0) throw new ErrorVerbo(500, 'EJECUTOR_UID_OPERADOR invalido');
  const dir = `${cfg.erpInfra}/secrets/${slug}`;
  // Auxiliar sin red que monta solo secrets/<slug>/ (la imagen del ejecutor, como en respaldar).
  const ayudante = (usuario: string, cmd: string) =>
    c.correr(
      [
        'run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
        ...(usuario === '0' ? ['--cap-add', 'CHOWN', '--cap-add', 'DAC_OVERRIDE', '--cap-add', 'FOWNER'] : []),
        '--security-opt', 'no-new-privileges:true', '--user', usuario,
        '--label', `cl.vinculos.silo=${slug}`, '--label', 'cl.vinculos.servicio=llaves-demo',
        '-v', `${dir}:/llaves`, '--entrypoint', 'sh', o.imagenAyudante, '-c', cmd,
      ],
      2 * 60_000,
    );
  const borrarPartes = () => ayudante(String(o.uid), 'rm -rf /llaves/partes_entregar && if [ -f /llaves/kek ] && [ -f /llaves/recuperacion.pub ]; then echo LLAVES_OK; fi');
  const log: string[] = [];

  // La carpeta la crea el daemon como root al montarla: queda del operador y 700 (como comun.sh del ERP).
  const prep = await ayudante('0', `chown ${o.uid} /llaves && chmod 700 /llaves && if [ -f /llaves/kek ] && [ -f /llaves/recuperacion.pub ]; then echo LLAVES_EXISTEN; fi`);
  if (prep.codigo !== 0) throw new ErrorVerbo(500, `no se pudo preparar secrets/${slug}/: ${ultimaLinea(prep.salida)}`);

  if (!prep.salida.includes('LLAVES_EXISTEN')) {
    const r = await c.correr(
      [
        ...argsCompose(cfg, slug), 'run', '--rm', '--no-deps', '-T', '--user', String(o.uid), '-v', `${dir}:/llaves`,
        'migrate', 'node', 'dist/common/crypto/cli-llaves.js', 'aprovisionar',
        '--kek', '/llaves/kek', '--publica', '/llaves/recuperacion.pub', '--partes', '/llaves/partes_entregar',
        '--custodios', CUSTODIOS_DEMO, '--actor', 'ejecutor:demo',
      ],
      5 * 60_000,
    );
    if (r.codigo !== 0) {
      await borrarPartes();
      throw new ErrorVerbo(500, `cli-llaves del ERP fallo: ${ultimaLinea(r.salida)}`);
    }
    log.push(`llaves de prueba generadas con cli-llaves del ERP (custodios ${CUSTODIOS_DEMO})`);
  } else {
    log.push('las llaves del demo ya existian (sin cambios)');
  }

  const fin = await borrarPartes();
  if (fin.codigo !== 0 || !fin.salida.includes('LLAVES_OK')) throw new ErrorVerbo(500, `faltan kek o recuperacion.pub en secrets/${slug}/ despues de generarlas: ${ultimaLinea(fin.salida)}`);
  log.push('partes de recuperacion borradas (demo: nadie las recibe)');
  return { log };
}

/** Ultima linea util de una salida (sin colores), para los errores. */
function ultimaLinea(salida: string): string {
  const l = salida
    .split('\n')
    .map((x) => x.replace(/\x1b\[[0-9;]*m/g, '').trim())
    .filter(Boolean)
    .at(-1);
  return (l ?? 'sin salida').slice(0, 300);
}
