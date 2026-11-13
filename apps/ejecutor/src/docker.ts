/**
 * Cliente minimo de la API de Docker por el socket unix (sin dependencias).
 * Solo las llamadas que necesitan los verbos: listar por proyecto, reiniciar e
 * inspeccionar un contenedor, y unir o separar contenedores de una red de borde.
 */
import { request } from 'node:http';

import type { Contenedor, Docker, Red } from './verbos';

const ID = /^[0-9a-f]{12,64}$/;

const SOCKET = process.env.DOCKER_SOCKET ?? '/var/run/docker.sock';

function llamar(metodo: 'GET' | 'POST', ruta: string, timeoutMs = 60_000, json?: unknown): Promise<{ status: number; cuerpo: string }> {
  return new Promise((ok, falla) => {
    const enviar = json === undefined ? undefined : JSON.stringify(json);
    const headers = enviar ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(enviar) } : undefined;
    const req = request({ socketPath: SOCKET, method: metodo, path: ruta, timeout: timeoutMs, headers }, (res) => {
      let cuerpo = '';
      res.setEncoding('utf8');
      res.on('data', (d: string) => (cuerpo += d));
      res.on('end', () => ok({ status: res.statusCode ?? 0, cuerpo }));
    });
    req.on('timeout', () => req.destroy(new Error(`docker ${ruta.split('?')[0]}: timeout`)));
    req.on('error', falla);
    req.end(enviar);
  });
}

export const docker: Docker = {
  async listar(proyecto) {
    const filtro = encodeURIComponent(JSON.stringify({ label: [`com.docker.compose.project=${proyecto}`] }));
    const r = await llamar('GET', `/containers/json?all=true&filters=${filtro}`);
    if (r.status !== 200) throw new Error(`docker listar: ${r.status}`);
    return JSON.parse(r.cuerpo) as Contenedor[];
  },
  async reiniciar(id, timeoutS) {
    if (!/^[0-9a-f]{12,64}$/.test(id)) throw new Error('id de contenedor invalido');
    const r = await llamar('POST', `/containers/${id}/restart?t=${timeoutS}`, (timeoutS + 30) * 1000);
    if (r.status !== 204) throw new Error(`docker reiniciar: ${r.status} ${r.cuerpo.slice(0, 200)}`);
  },
  async salud(id) {
    const r = await llamar('GET', `/containers/${id}/json`);
    if (r.status !== 200) return null;
    return (JSON.parse(r.cuerpo) as { State?: { Health?: { Status?: string } } }).State?.Health?.Status ?? null;
  },
  async red(nombre) {
    if (!/^[a-z0-9][a-z0-9_.-]{0,127}$/.test(nombre)) throw new Error('nombre de red invalido');
    const r = await llamar('GET', `/networks/${encodeURIComponent(nombre)}`);
    if (r.status === 404) return null;
    if (r.status !== 200) throw new Error(`docker red: ${r.status}`);
    const red = JSON.parse(r.cuerpo) as Red;
    return { ...red, Labels: red.Labels ?? {} };
  },
  async redesBorde() {
    const filtro = encodeURIComponent(JSON.stringify({ label: ['cl.vinculos.red=borde'] }));
    const r = await llamar('GET', `/networks?filters=${filtro}`);
    if (r.status !== 200) throw new Error(`docker redes: ${r.status}`);
    // La lista no trae Containers: se inspecciona cada una.
    const lista = JSON.parse(r.cuerpo) as Red[];
    const redes = await Promise.all(lista.map((x) => docker.red(x.Name)));
    return redes.filter((x): x is Red => x !== null);
  },
  async contenedorId(nombre) {
    const r = await llamar('GET', `/containers/${encodeURIComponent(nombre)}/json`);
    if (r.status === 404) return null;
    if (r.status !== 200) throw new Error(`docker contenedor: ${r.status}`);
    return (JSON.parse(r.cuerpo) as { Id: string }).Id;
  },
  async conectar(redId, contenedorId) {
    if (!ID.test(redId) || !ID.test(contenedorId)) throw new Error('id invalido');
    const r = await llamar('POST', `/networks/${redId}/connect`, 30_000, { Container: contenedorId });
    if (r.status !== 200) throw new Error(`docker conectar: ${r.status} ${r.cuerpo.slice(0, 200)}`);
  },
  async desconectar(redId, contenedorId) {
    if (!ID.test(redId) || !ID.test(contenedorId)) throw new Error('id invalido');
    const r = await llamar('POST', `/networks/${redId}/disconnect`, 30_000, { Container: contenedorId, Force: false });
    if (r.status !== 200) throw new Error(`docker desconectar: ${r.status} ${r.cuerpo.slice(0, 200)}`);
  },
};
