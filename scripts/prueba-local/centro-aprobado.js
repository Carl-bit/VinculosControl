// Uso: docker cp scripts/prueba-local/centro-aprobado.js vinculos-control-api-1:/tmp/c.js && docker exec -e NODE_PATH=/app/node_modules vinculos-control-api-1 node /tmp/c.js
// Dato de prueba local: centro ACTIVO con manifiesto aprobado para el silo de
// desarrollo `centro-prueba` (BD control), para probar RECONFIGURAR (R4).
// Reglas vacias: no cambia las reglas del centro de desarrollo.
const { PrismaClient } = require('@prisma/client');
const { manifiestoSchema } = require('@vinculos/manifest');
const { hashManifiesto } = require('@vinculos/manifest/hash');

(async () => {
  const p = new PrismaClient();
  const m = manifiestoSchema.parse({
    schema: 1,
    tipo_cliente: 'centro',
    centro: {
      id: 'centro-prueba',
      nombre: 'Centro de Prueba (local)',
      razon_social: 'Centro de Prueba SpA',
      rut: '76.086.428-5',
      tipo_entidad: 'spa',
      admin: { nombre: 'Admin Prueba', correo: 'admin@centro-prueba.cl' },
      responsable_datos: { nombre: 'Admin Prueba', correo: 'admin@centro-prueba.cl' },
    },
    dominio: { tipo: 'subdominio', valor: 'centro-prueba.vinculos.cl' },
    version: { canal: 'estable' },
    estilo: { tema: 'moderno' },
    modulos: ['PAGINA_PUBLICA', 'FICHAS', 'AGENDA', 'EQUIPO', 'MATCH'],
  });
  const existe = await p.centro.findUnique({ where: { slug: 'centro-prueba' } });
  if (existe) {
    console.log(`ya existe centro ${existe.id} rev ${existe.revisionAprobada}`);
    return p.$disconnect();
  }
  const hash = hashManifiesto(m);
  const c = await p.centro.create({
    data: {
      slug: 'centro-prueba', nombre: 'Centro de Prueba (local)', estado: 'ACTIVO', contactoNombre: 'Admin Prueba',
      contactoCorreo: 'admin@centro-prueba.cl', comuna: 'Valparaiso', origen: 'prueba-local',
      revisiones: { create: { numero: 1, fase: 3, contenido: m, hash, autor: 'prueba-local' } },
    },
  });
  await p.centro.update({ where: { id: c.id }, data: { revisionAprobada: 1, hashAprobado: hash, aprobadoEn: new Date() } });
  console.log(`centro ${c.id} ACTIVO rev 1 sha ${hash.slice(0, 12)} reglas=${JSON.stringify(m.reglas)}`);
  await p.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
