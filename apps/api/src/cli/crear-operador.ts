/**
 * Crea un operador de la consola y muestra su contrasena UNA vez (aca solo queda el hash scrypt).
 *   pnpm api operador:crear <correo> "<nombre>"
 *   docker exec vinculos-control-api-1 node dist/cli/crear-operador.js <correo> "<nombre>"
 * Con un correo ya existente: rota la contrasena, quita el bloqueo y cierra sus sesiones.
 */
import { randomBytes } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

import { hashClave, normalizarCorreo } from '../acceso/reglas';

async function main() {
  const correo = normalizarCorreo(process.argv[2] ?? '');
  const nombre = (process.argv[3] ?? '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo) || !nombre) throw new Error('Uso: pnpm api operador:crear <correo> "<nombre>"');
  const clave = randomBytes(15).toString('base64url'); // 20 caracteres
  const claveHash = hashClave(clave);
  const prisma = new PrismaClient();
  try {
    const existe = await prisma.operador.findUnique({ where: { correo }, select: { id: true } });
    if (existe) {
      await prisma.$transaction([
        prisma.operador.update({ where: { id: existe.id }, data: { nombre, claveHash, fallos: 0, bloqueadaHasta: null, activo: true } }),
        prisma.sesion.updateMany({ where: { operadorId: existe.id, revocadaEn: null }, data: { revocadaEn: new Date() } }),
        prisma.eventoAuditoria.create({ data: { actor: 'cli', accion: 'operador.clave_rotada', objeto: correo } }),
      ]);
    } else {
      await prisma.$transaction([
        prisma.operador.create({ data: { correo, nombre, claveHash } }),
        prisma.eventoAuditoria.create({ data: { actor: 'cli', accion: 'operador.creado', objeto: correo } }),
      ]);
    }
    process.stdout.write(`Operador ${correo} ${existe ? '(contrasena rotada, sesiones cerradas)' : 'creado'}. Contrasena (no se vuelve a mostrar):\n${clave}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
