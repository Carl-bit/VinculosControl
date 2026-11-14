/**
 * Postgres efimero para los tests de integracion.
 *
 * - Sin TEST_DATABASE_URL: levanta postgres:18-alpine desechable (datos en
 *   tmpfs, puerto libre en 127.0.0.1, etiqueta vc.test=api) y lo borra el
 *   teardown. No toca la BD `control` (5440) ni la del ERP (5432).
 * - Con TEST_DATABASE_URL (CI): usa esa base, que debe estar vacia.
 *
 * En ambos casos aplica todas las migraciones desde cero con
 * `prisma migrate deploy`: si una migracion no aplica sobre una base limpia,
 * la corrida falla aqui.
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

const API = path.resolve(__dirname, '../..');
const docker = (...args: string[]) => execFileSync('docker', args, { encoding: 'utf8' }).trim();

function esperar(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function levantarPostgres(): string {
  const clave = randomBytes(12).toString('hex');
  const nombre = `vc-api-test-${process.pid}`;
  docker(
    'run', '-d', '--rm',
    '--name', nombre,
    '--label', 'vc.test=api',
    '--tmpfs', '/var/lib/postgresql:rw',
    '-e', 'POSTGRES_USER=control',
    '-e', `POSTGRES_PASSWORD=${clave}`,
    '-e', 'POSTGRES_DB=control_test',
    '-p', '127.0.0.1::5432',
    'postgres:18-alpine',
  );
  process.env.VC_TEST_CONTENEDOR = nombre;
  const puerto = docker('port', nombre, '5432/tcp').split('\n')[0].split(':').pop();
  // pg_isready por TCP: el socket local responde antes de que el init termine.
  for (let i = 0; i < 60; i++) {
    try {
      docker('exec', nombre, 'pg_isready', '-h', '127.0.0.1', '-U', 'control', '-d', 'control_test');
      return `postgresql://control:${clave}@127.0.0.1:${puerto}/control_test`;
    } catch {
      esperar(500);
    }
  }
  docker('rm', '-f', nombre);
  throw new Error('El Postgres de prueba no respondio en 30 s');
}

export default function globalSetup() {
  const url = process.env.TEST_DATABASE_URL || levantarPostgres();
  process.env.DATABASE_URL = url;
  execFileSync(process.execPath, [require.resolve('prisma/build/index.js', { paths: [API] }), 'migrate', 'deploy'], {
    cwd: API,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
}
