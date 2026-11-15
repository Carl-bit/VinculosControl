/**
 * Disco y CLI reales de los verbos de aprovisionamiento (ver aprovisionar.ts).
 *
 *   silos/<slug>/.env y docker-compose.yml   EJECUTOR_SILOS_DIR (lectura y escritura)
 *   imagenes/<version>.env                   EJECUTOR_IMAGENES_DIR (solo lectura, del ERP)
 *   tokens/<slug>.token                      EJECUTOR_TOKENS_DIR (el agente la monta en solo lectura)
 *   plantilla del silo                       dentro de la imagen del ejecutor
 */
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';

import type { DiscoActualizar, Tuberia } from './actualizar';
import { argsCompose, type Compose, type Config, VERSION } from './aprovisionar';
import { validarSlug } from './verbos';

/** Lee un archivo comun (sin enlaces simbolicos) o null si no existe. */
async function leer(ruta: string, max = 64 * 1024): Promise<string | null> {
  let st;
  try {
    st = await fs.lstat(ruta);
  } catch {
    return null;
  }
  if (!st.isFile() || st.size > max) throw new Error(`${ruta}: se esperaba un archivo comun`);
  return fs.readFile(ruta, 'utf8');
}

/** Escribe por archivo temporal + rename (nunca deja un .env a medias). */
async function escribir(ruta: string, contenido: string, modo: number, uid?: number) {
  const tmp = `${ruta}.tmp`;
  await fs.writeFile(tmp, contenido, { mode: modo });
  await fs.chmod(tmp, modo);
  if (uid !== undefined) await fs.chown(tmp, uid, uid).catch(() => undefined);
  await fs.rename(tmp, ruta);
}

export function discoSilosReal(o: { silosDir: string; imagenesDir: string; tokensDir: string; plantilla: string; uidAgente?: number }): DiscoActualizar {
  const dir = async (slug: string) => {
    const d = join(o.silosDir, validarSlug(slug));
    await fs.mkdir(d, { recursive: true, mode: 0o700 });
    const st = await fs.lstat(d);
    if (st.isSymbolicLink() || !st.isDirectory()) throw new Error(`silos/${slug} no es una carpeta comun`);
    return d;
  };
  return {
    plantilla: async () => {
      const t = await leer(o.plantilla, 256 * 1024);
      if (t === null) throw new Error('falta la plantilla del silo en la imagen del ejecutor');
      return t;
    },
    leerImagenes: (version) => {
      if (!VERSION.test(version)) throw new Error('version invalida');
      return leer(join(o.imagenesDir, `${version}.env`));
    },
    leerEnv: (slug) => leer(join(o.silosDir, validarSlug(slug), '.env')),
    escribirEnv: async (slug, contenido) => escribir(join(await dir(slug), '.env'), contenido, 0o600),
    escribirCompose: async (slug, contenido) => escribir(join(await dir(slug), 'docker-compose.yml'), contenido, 0o600),
    existeCompose: async (slug) => (await leer(join(o.silosDir, validarSlug(slug), 'docker-compose.yml'), 256 * 1024)) !== null,
    leerToken: (slug) => leer(join(o.tokensDir, `${validarSlug(slug)}.token`), 200),
    // 600 y del usuario del agente (uid 1000 en su imagen): solo el agente lo lee.
    escribirToken: (slug, token) => escribir(join(o.tokensDir, `${validarSlug(slug)}.token`), token, 0o600, o.uidAgente),
    // ACTUALIZAR: lineas de imagen de antes del cambio (para revertir).
    leerAnterior: (slug) => leer(join(o.silosDir, validarSlug(slug), 'anterior.env')),
    escribirAnterior: async (slug, contenido) => escribir(join(await dir(slug), 'anterior.env'), contenido, 0o600),
  };
}

/**
 * Respaldo del silo: `docker compose exec db pg_dump -Fc` | contenedor auxiliar
 * (la imagen del ejecutor, sin red) que monta SOLO secrets/<slug>/respaldo.key en
 * solo lectura y cifra con los parametros de respaldar.sh del ERP. El ejecutor
 * pasa los bytes ya cifrados a respaldos/<slug>/ y calcula el sha256; nunca lee
 * la llave. Si algo falla, borra el temporal (todo o nada).
 */
export function tuberiaReal(cfg: Config, o: { respaldosDir: string; imagenAyudante: string }): Tuberia {
  return {
    async respaldar(slug, archivo) {
      validarSlug(slug);
      const destinoDir = join(o.respaldosDir, slug);
      await fs.mkdir(destinoDir, { recursive: true, mode: 0o700 });
      const tmp = join(destinoDir, `${archivo}.tmp`);
      const entorno = { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', HOME: '/tmp' };
      const dump = spawn('docker', [...argsCompose(cfg, slug), 'exec', '-T', 'db', 'sh', '-c', 'pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"'], { env: entorno });
      const cifra = spawn(
        'docker',
        [
          'run', '--rm', '-i', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
          '--label', `cl.vinculos.silo=${slug}`, '--label', 'cl.vinculos.servicio=respaldo',
          '-v', `${cfg.erpInfra}/secrets/${slug}/respaldo.key:/llave/respaldo.key:ro`,
          '--entrypoint', 'openssl', o.imagenAyudante,
          'enc', '-aes-256-cbc', '-pbkdf2', '-iter', '200000', '-salt', '-pass', 'file:/llave/respaldo.key',
        ],
        { env: entorno },
      );
      const hash = createHash('sha256');
      let bytes = 0;
      const salida = createWriteStream(tmp, { mode: 0o600 });
      let errores = '';
      dump.stderr.on('data', (d: Buffer) => (errores += `pg_dump: ${d.toString()}`));
      cifra.stderr.on('data', (d: Buffer) => (errores += `openssl: ${d.toString()}`));
      dump.stdout.pipe(cifra.stdin);
      cifra.stdout.on('data', (d: Buffer) => {
        hash.update(d);
        bytes += d.length;
      });
      cifra.stdout.pipe(salida);
      const fin = (p: ReturnType<typeof spawn>) => new Promise<number>((ok) => p.on('close', (c) => ok(c ?? -1)));
      const [cDump, cCifra] = await Promise.all([fin(dump), fin(cifra)]);
      await new Promise<void>((ok) => salida.end(() => ok()));
      if (cDump !== 0 || cCifra !== 0) {
        await fs.rm(tmp, { force: true });
        return { error: `pg_dump ${cDump}, openssl ${cCifra}. ${errores.trim()}` };
      }
      const sha256 = hash.digest('hex');
      await fs.rename(tmp, join(destinoDir, archivo));
      // Mismo formato que sha256sum (lo lee el agente y descifrar_respaldo.sh).
      await fs.writeFile(join(destinoDir, `${archivo}.sha256`), `${sha256}  ${archivo}\n`, { mode: 0o644 });
      return { bytes, sha256 };
    },
  };
}

/** docker compose sin shell; entorno minimo (sin los tokens del ejecutor). */
export const composeReal: Compose = {
  correr(args, timeoutMs) {
    return new Promise((ok) => {
      execFile(
        'docker',
        args,
        { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, env: { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', HOME: '/tmp' } },
        (e, stdout, stderr) => {
          const salida = `${stdout}${stderr ? `\n${stderr}` : ''}`;
          if (!e) return ok({ codigo: 0, salida });
          const codigo = typeof (e as { code?: unknown }).code === 'number' ? ((e as { code: number }).code) : -1;
          ok({ codigo, salida: `${salida}\n${e.killed ? 'timeout' : ''}` });
        },
      );
    });
  },
};
