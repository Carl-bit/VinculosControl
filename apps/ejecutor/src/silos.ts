/**
 * Disco y CLI reales de los verbos de aprovisionamiento (ver aprovisionar.ts).
 *
 *   silos/<slug>/.env y docker-compose.yml   EJECUTOR_SILOS_DIR (lectura y escritura)
 *   imagenes/<version>.env                   EJECUTOR_IMAGENES_DIR (solo lectura, del ERP)
 *   tokens/<slug>.token                      EJECUTOR_TOKENS_DIR (el agente la monta en solo lectura)
 *   plantilla del silo                       dentro de la imagen del ejecutor
 */
import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';

import { type Compose, type DiscoSilos, VERSION } from './aprovisionar';
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

export function discoSilosReal(o: { silosDir: string; imagenesDir: string; tokensDir: string; plantilla: string; uidAgente?: number }): DiscoSilos {
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
