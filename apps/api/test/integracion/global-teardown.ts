import { execFileSync } from 'node:child_process';

/** Borra el Postgres efimero (si lo levanto el setup; con TEST_DATABASE_URL no hay nada que borrar). */
export default function globalTeardown() {
  const nombre = process.env.VC_TEST_CONTENEDOR;
  if (nombre) execFileSync('docker', ['rm', '-f', nombre], { stdio: 'ignore' });
}
