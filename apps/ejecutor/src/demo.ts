/**
 * Silos de demostracion (R10, demos desde la consola). Dos verbos, solo para
 * slugs de EJECUTOR_DEMOS (lista del .env del host B, nunca desde el plano de
 * control):
 *
 *   cargar_demo(slug, { cuentasMadre, profesionales, pacientes, nombre })
 *     corre el generador del ERP (dist/demo/generador-demo.js) en el servicio
 *     backend del silo. La contrasena de las cuentas la genera el ejecutor y,
 *     junto con correos y roles, queda solo en silos/<slug>/demo-cuentas.txt
 *     (600). Al agente vuelven solo conteos. Pendiente: eliminar aun no borra
 *     silos/<slug>/ (ni este archivo ni el .env).
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
import { ErrorVerbo, SLUG } from './verbos';

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

const NOMBRE = /^[\p{L}\p{N} .,'&()-]{2,80}$/u;
const RESULTADO = /^DEMO_RESULTADO (\{.*\})$/m;

/** Lista fija del .env del host B (EJECUTOR_DEMOS). */
export function slugsDemo(valor: string | undefined): string[] {
  const lista = (valor ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  for (const s of lista) if (!SLUG.test(s)) throw new Error(`EJECUTOR_DEMOS: slug invalido (${s})`);
  return lista;
}

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
  if (!demos.includes(slug)) throw new ErrorVerbo(403, `${slug} no esta en EJECUTOR_DEMOS del host B: no es un silo de demostracion`);
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
  if (!res.yaCargado) {
    await disco.escribirCuentas(
      slug,
      [
        `# Cuentas del demo erp-${slug} (${ahora.toISOString()}). Datos ficticios; borrar al eliminar el silo.`,
        `# Contrasena de todas las cuentas: ${clave}`,
        '# Cada cuenta entra con un codigo por correo (Mailpit o SES del silo).',
        ...res.cuentas.map((x) => `${x.rol}\t${x.email}`),
        '',
      ].join('\n'),
    );
  } else if ((await disco.leerCuentas(slug)) === null) {
    throw new ErrorVerbo(409, `erp-${slug} ya tiene datos de demo pero no hay demo-cuentas.txt: no se conoce la contrasena (reconstruir el demo)`);
  }
  const roles = Object.entries(porRol).map(([rol, n]) => `${n} ${rol}`);
  return {
    log: [
      res.yaCargado ? 'datos de demo ya cargados (sin cambios)' : 'datos de demo generados',
      `cuentas: ${roles.join(', ')} (correos y contrasena en silos/${slug}/demo-cuentas.txt del host B)`,
      ...(res.conteos ? [`horas ${res.conteos.horas ?? 0}, evoluciones ${res.conteos.evoluciones ?? 0}, pacientes ${res.conteos.pacientes ?? 0}`] : []),
    ],
    demo: { yaCargado: res.yaCargado, porRol, conteos: res.conteos ?? null },
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
