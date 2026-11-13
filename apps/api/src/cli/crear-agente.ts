/**
 * Registra un agente y muestra su token UNA vez (aca solo queda el sha256).
 *   pnpm api agente:crear host-b
 * Con un nombre ya existente, rota el token (el anterior deja de servir).
 */
import { randomBytes } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

import { hashToken } from '../agente/agente.guard';

async function main() {
  const nombre = process.argv[2];
  if (!nombre || !/^[a-z0-9-]{2,40}$/.test(nombre)) throw new Error('Uso: pnpm api agente:crear <nombre> (minusculas, numeros y guiones)');
  const token = randomBytes(32).toString('base64url');
  const prisma = new PrismaClient();
  await prisma.agente.upsert({ where: { nombre }, create: { nombre, tokenHash: hashToken(token) }, update: { tokenHash: hashToken(token) } });
  await prisma.$disconnect();
  process.stdout.write(`Agente ${nombre}. Token (copiar al .env del host B como AGENTE_TOKEN; no se vuelve a mostrar):\n${token}\n`);
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
