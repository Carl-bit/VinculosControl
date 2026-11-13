import { readdir, readFile, stat, statfs } from 'node:fs/promises';
import { cpus } from 'node:os';
import { join } from 'node:path';

/*
 * Host B sin montar nada sensible: dentro de un contenedor (sin lxcfs)
 * /proc/meminfo y /proc/loadavg muestran el host; el disco se mide con
 * statfs sobre el directorio de respaldos (montado de solo lectura, en el
 * mismo disco que Docker).
 */
const RESPALDOS = process.env.RESPALDOS_DIR ?? '/respaldos';

export async function host() {
  const [meminfo, loadavg, fs] = await Promise.all([readFile('/proc/meminfo', 'utf8'), readFile('/proc/loadavg', 'utf8'), statfs(RESPALDOS)]);
  const kb = (campo: string) => Number(new RegExp(`^${campo}:\\s+(\\d+)`, 'm').exec(meminfo)?.[1] ?? 0) * 1024;
  const total = kb('MemTotal');
  return {
    discoPct: Math.round((1 - fs.bavail / fs.blocks) * 1000) / 10,
    memUsada: total - kb('MemAvailable'),
    memTotal: total,
    carga1: Number(loadavg.split(' ')[0]),
    cpus: cpus().length,
  };
}

const ARCHIVO = /^[a-z0-9-]+-\d{8}T\d{6}Z\.dump\.enc$/;

/** Ultimo respaldo de respaldar.sh en <RESPALDOS>/<slug>/ (los nombres llevan la fecha UTC, se ordenan solos). */
export async function ultimoRespaldo(slug: string) {
  const dir = join(RESPALDOS, slug);
  const archivo = (await readdir(dir).catch(() => [] as string[]))
    .filter((a) => ARCHIVO.test(a))
    .sort()
    .at(-1);
  if (!archivo) return undefined;
  const m = /-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.dump\.enc$/.exec(archivo)!;
  const [bytes, sha] = await Promise.all([stat(join(dir, archivo)).then((s) => s.size), readFile(join(dir, `${archivo}.sha256`), 'utf8').catch(() => '')]);
  const sha256 = /^[a-f0-9]{64}/.exec(sha)?.[0];
  return { archivo, fecha: `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`, bytes, ...(sha256 ? { sha256 } : {}) };
}
