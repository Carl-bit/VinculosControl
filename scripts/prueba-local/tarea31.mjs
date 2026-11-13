// Prueba local de la tarea 31 (solicitudes de modulos, R2/R3) de punta a punta,
// sin navegador: hace lo mismo que el ADMIN en el ERP y el operador en la consola.
// Guia completa: docs/entorno-local.md, seccion 7.
//
//   node scripts/prueba-local/tarea31.mjs erp-modulos
//   node scripts/prueba-local/tarea31.mjs erp-solicitar <MODULO> <ACTIVAR|DESACTIVAR>
//   node scripts/prueba-local/tarea31.mjs erp-listar
//   node scripts/prueba-local/tarea31.mjs consola-listar [slug]
//   node scripts/prueba-local/tarea31.mjs consola-decidir <APROBADA|RECHAZADA|APLICADA> "<texto>" [slug]
//
// Variables (con valores por defecto de desarrollo):
//   ERP_API=http://127.0.0.1:3001/api  ERP_MAILPIT=http://127.0.0.1:8025
//   ERP_ADMIN=admin@centro-prueba.cl   ERP_CLAVE=dev-password (SEED_PASSWORD si se cambio)
//   CONSOLA=http://127.0.0.1:3100      CONSOLA_MAILPIT=http://127.0.0.1:8026
//   OPERADOR=<correo>  OPERADOR_CLAVE=<contrasena>   (obligatorias para consola-*)
// El codigo de 6 digitos de cada login se lee de su Mailpit.
const env = (k, d) => process.env[k] || d;
const ERP = env('ERP_API', 'http://127.0.0.1:3001/api');
const ERP_MAILPIT = env('ERP_MAILPIT', 'http://127.0.0.1:8025');
const CONSOLA = env('CONSOLA', 'http://127.0.0.1:3100');
const CONSOLA_MAILPIT = env('CONSOLA_MAILPIT', 'http://127.0.0.1:8026');

async function cuerpo(r) {
  const t = await r.text();
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}

/** Ultimo codigo de 6 digitos enviado a `para` despues de `desde`. */
async function codigo(mailpit, para, desde) {
  for (let i = 0; i < 30; i++) {
    const m = await (await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${para}`)}&limit=5`)).json();
    const nuevo = (m.messages ?? []).find((x) => new Date(x.Created) >= desde);
    if (nuevo) {
      const d = await (await fetch(`${mailpit}/api/v1/message/${nuevo.ID}`)).json();
      const c = /\b(\d{6})\b/.exec(d.Text ?? '')?.[1];
      if (c) return c;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`no llego el codigo para ${para} a ${mailpit}`);
}

async function tokenErp() {
  const email = env('ERP_ADMIN', 'admin@centro-prueba.cl');
  const desde = new Date(Date.now() - 2000);
  const json = { 'content-type': 'application/json' };
  let r = await fetch(`${ERP}/auth/login`, { method: 'POST', headers: json, body: JSON.stringify({ email, password: env('ERP_CLAVE', 'dev-password'), rol: 'ADMIN' }) });
  let b = await cuerpo(r);
  if (r.status !== 200) throw new Error(`login ERP ${r.status} ${JSON.stringify(b)}`);
  if (b.requiereSegundoFactor) {
    r = await fetch(`${ERP}/auth/segundo-factor`, { method: 'POST', headers: json, body: JSON.stringify({ desafio: b.desafio, codigo: await codigo(ERP_MAILPIT, email, desde) }) });
    b = await cuerpo(r);
    if (r.status !== 200) throw new Error(`segundo factor ERP ${r.status} ${JSON.stringify(b)}`);
  }
  return { authorization: `Bearer ${b.accessToken}`, 'content-type': 'application/json' };
}

/** Sesion de la consola por el mismo proxy que usa el navegador (cookie + Origin). */
async function sesionConsola() {
  const correo = process.env.OPERADOR;
  const clave = process.env.OPERADOR_CLAVE;
  if (!correo || !clave) throw new Error('Faltan OPERADOR y OPERADOR_CLAVE (crear-operador muestra la contrasena una vez)');
  const h = { 'content-type': 'application/json', origin: CONSOLA };
  const desde = new Date(Date.now() - 2000);
  let r = await fetch(`${CONSOLA}/api/consola/acceso/credenciales`, { method: 'POST', headers: h, body: JSON.stringify({ correo, clave }) });
  const paso1 = await cuerpo(r);
  if (!r.ok) throw new Error(`credenciales ${r.status} ${JSON.stringify(paso1)}`);
  r = await fetch(`${CONSOLA}/api/consola/acceso/codigo`, { method: 'POST', headers: h, body: JSON.stringify({ desafio: paso1.desafio, codigo: await codigo(CONSOLA_MAILPIT, correo, desde) }) });
  if (!r.ok) throw new Error(`codigo ${r.status} ${JSON.stringify(await cuerpo(r))}`);
  return { ...h, cookie: (r.headers.get('set-cookie') ?? '').split(';')[0] };
}

const [accion, ...args] = process.argv.slice(2);
const mostrar = (x) => console.log(typeof x === 'string' ? x : JSON.stringify(x, null, 1));

switch (accion) {
  case 'erp-modulos':
    mostrar(await cuerpo(await fetch(`${ERP}/modulos`, { headers: await tokenErp() })));
    break;
  case 'erp-listar':
    mostrar(await cuerpo(await fetch(`${ERP}/configuracion/solicitudes-modulo`, { headers: await tokenErp() })));
    break;
  case 'erp-solicitar': {
    const [modulo, tipo = 'ACTIVAR'] = args;
    const r = await fetch(`${ERP}/configuracion/solicitudes-modulo`, {
      method: 'POST',
      headers: await tokenErp(),
      body: JSON.stringify({ modulo, accion: tipo, motivo: 'Prueba local de la tarea 31' }),
    });
    console.log(r.status);
    mostrar(await cuerpo(r));
    break;
  }
  case 'consola-listar': {
    const slug = args[0] ?? 'centro-prueba';
    mostrar(await cuerpo(await fetch(`${CONSOLA}/api/consola/solicitudes-modulo?silo=${slug}`, { headers: await sesionConsola() })));
    break;
  }
  case 'consola-decidir': {
    const [estado, respuesta, slug = 'centro-prueba'] = args;
    const h = await sesionConsola();
    const lista = await cuerpo(await fetch(`${CONSOLA}/api/consola/solicitudes-modulo?silo=${slug}`, { headers: h }));
    const s = lista.find((x) => x.estado === 'PENDIENTE' || x.estado === 'APROBADA');
    if (!s) throw new Error(`sin solicitudes abiertas en ${slug}`);
    const r = await fetch(`${CONSOLA}/api/consola/solicitudes-modulo/${s.siloSlug}/${s.id}/decision`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify({ estado, ...(respuesta ? { respuesta } : {}) }),
    });
    console.log(r.status);
    mostrar(await cuerpo(r));
    break;
  }
  default:
    console.log('Uso: node scripts/prueba-local/tarea31.mjs erp-modulos | erp-solicitar <MODULO> <ACCION> | erp-listar | consola-listar [slug] | consola-decidir <ESTADO> "<texto>" [slug]');
    process.exitCode = 1;
}
