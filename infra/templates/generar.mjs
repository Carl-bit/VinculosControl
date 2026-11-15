// Regenera infra/templates/silo.compose.tpl desde el compose del ERP (R11, R1).
// Uso (desde la raiz de este repo):
//   node infra/templates/generar.mjs "<repo del ERP>/infra/docker-compose.yml"
// Desde R1 (2026-11-15) el compose del ERP ya no tiene `build` y corre las
// imagenes por digest: la plantilla es el original con esta cabecera. El
// generador solo comprueba que siga siendo asi (si el ERP cambia de forma,
// falla en vez de producir una plantilla que construya o use tags).
import { readFileSync, writeFileSync } from 'node:fs';

const origen = process.argv[2];
if (!origen) {
  console.error('Uso: node infra/templates/generar.mjs "<repo del ERP>/infra/docker-compose.yml"');
  process.exit(1);
}
const src = readFileSync(origen, 'utf8').replace(/\r\n/g, '\n');

const cuenta = (texto) => src.split(texto).length - 1;
const errores = [];
if (/^\s+build:/m.test(src)) errores.push('tiene `build`');
if (cuenta('image: ${REGISTRO}/vinculos-api@${API_DIGEST}') !== 2) errores.push('migrate y backend no usan vinculos-api por digest');
if (cuenta('image: ${REGISTRO}/vinculos-web@${WEB_DIGEST}') !== 1) errores.push('frontend no usa vinculos-web por digest');
if (/image: vinculos-(api|web):/.test(src)) errores.push('quedan imagenes por tag');
if (errores.length) {
  console.error(`El compose del ERP cambio de forma (${errores.join('; ')}): revisar este generador antes de usar la plantilla`);
  process.exit(1);
}

const cabecera = `# =============================================================================
# silo.compose.tpl: plantilla del stack erp-<slug> que usara el job
# \`aprovisionar\` (P3). GENERADA por infra/templates/generar.mjs desde
# infra/docker-compose.yml del ERP (R11, R1). No editar a mano: regenerar.
# Es el compose del ERP sin cambios: imagenes por digest del registro del
# host B (\${REGISTRO}/vinculos-api@\${API_DIGEST}, \${REGISTRO}/vinculos-web@\${WEB_DIGEST}),
# sin \`build\`. VINCULOS_VERSION es el tag de esos digests (label informativa).
# Se renderiza dentro de infra/ del repo del ERP en el host B (mismas rutas
# relativas: ./postgres/init, ./secrets/<slug>/).
# Variables del .env del silo: las de infra/.env.example del ERP; REGISTRO,
# API_DIGEST y WEB_DIGEST salen de infra/imagenes/<version>.env (publicar.sh).
# =============================================================================
`;
writeFileSync(new URL('./silo.compose.tpl', import.meta.url), cabecera + src, 'utf8');
console.log('silo.compose.tpl regenerada');
