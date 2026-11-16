'use client';

import Link from 'next/link';
import { useState } from 'react';

import { useConfirmacion } from '@/componentes/dialogo';
import { Shell } from '@/componentes/piezas';
import { enviarConSesion, hace, mensajeDe, useDatos, type Cascada, type Release, type Resumen } from '@/lib/api';

/*
 * Releases y canales (CONTEXTO.md seccion 7; boceto "Releases"). Las versiones
 * las detecta el agente en el host B (publicar.sh del ERP); aqui se promueven
 * demo -> beta -> estable y se aplican a un canal con la cascada: un silo a la
 * vez, el siguiente cuando el anterior termina OK. Un minor pide confirmacion en
 * cada silo; un patch no.
 */

const CANALES = [
  { canal: 'demo', campo: 'enDemoEn' },
  { canal: 'beta', campo: 'enBetaEn' },
  { canal: 'estable', campo: 'enEstableEn' },
] as const;

const claseCascada: Record<Cascada['estado'], string> = { EN_CURSO: 'info', DETENIDA: 'danger', TERMINADA: 'ok' };
const corto = (d: string) => d.slice(7, 19);

export default function Releases() {
  const { datos: r } = useDatos<Resumen>('consola/resumen', 30_000);
  const { datos, error, recargar } = useDatos<{ releases: Release[]; cascadas: Cascada[] }>('consola/releases', 10_000);
  const [msg, setMsg] = useState<{ t: string; ok: boolean }>();
  const [ocupado, setOcupado] = useState(false);
  const [confirmar, dialogo] = useConfirmacion();

  const hacer = async (ruta: string, cuerpo: unknown, ok: string) => {
    if (ocupado) return;
    setOcupado(true);
    setMsg(undefined);
    try {
      const res = await enviarConSesion(ruta, cuerpo);
      setMsg(res.ok ? { t: ok, ok: true } : { t: mensajeDe(res.datos, `No se pudo (HTTP ${res.status})`), ok: false });
      await recargar();
    } finally {
      setOcupado(false);
    }
  };

  const promover = async (rel: Release, canal: string) => {
    const si = await confirmar({
      etiqueta: `Version ${rel.version}`,
      titulo: `Promover a ${canal}`,
      texto: `La version ${rel.version} queda disponible en el canal ${canal}: los silos de ese canal pueden actualizarse a ella (y los nuevos de ese canal se aprovisionan con ella). No actualiza ningun silo por si sola.`,
      boton: `Promover a ${canal}`,
    });
    if (si !== null) void hacer(`consola/releases/${encodeURIComponent(rel.version)}/promover`, { canal }, `${rel.version} promovida a ${canal}`);
  };

  const cascada = async (rel: Release, canal: string) => {
    const si = await confirmar({
      etiqueta: `Version ${rel.version} · canal ${canal}`,
      titulo: 'Aplicar al canal (cascada)',
      texto: `Actualiza a ${rel.version} los silos del canal ${canal} que estan por debajo, de a uno: respaldo, migraciones, recrear y /api/salud; si un silo falla vuelve a su version y la cascada se detiene. Un minor pide confirmacion en cada silo. Un silo con una exportacion del centro en curso detiene la cascada (lo informa el silo, R13). Para los silos con un ERP anterior a R13, al confirmar declaras que revisaste que no tienen una en curso.`,
      boton: 'Sin exportaciones en curso: aplicar',
    });
    if (si !== null) void hacer(`consola/releases/${encodeURIComponent(rel.version)}/cascada`, { canal, sinExporte: true }, `Cascada de ${rel.version} a ${canal} en curso`);
  };

  return (
    <Shell resumen={r} titulo="releases">
      <div>
        <h1>Releases y canales</h1>
        <span className="sub">
          Versiones publicadas en el registro del host B (las informa el agente). Orden de promocion: demo, beta, estable{error && ` · error: ${error}`}
        </span>
      </div>
      {msg && (
        <p role="status" className={`chip ${msg.ok ? 'ok' : 'danger'}`} style={{ whiteSpace: 'normal' }}>
          {msg.t}
        </p>
      )}

      <section className="panel">
        <h2>Versiones</h2>
        {!datos ? (
          <p className="vacio">Cargando…</p>
        ) : datos.releases.length === 0 ? (
          <p className="vacio">Ninguna version detectada. Publica una en el host B (sh infra/scripts/imagenes/publicar.sh del ERP); el agente la informa en unos minutos.</p>
        ) : (
          <div className="tabla-ancha">
            <table>
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Digests (api / web)</th>
                  <th>Commit</th>
                  {CANALES.map((c) => (
                    <th key={c.canal}>{c.canal}</th>
                  ))}
                  <th>Silos</th>
                </tr>
              </thead>
              <tbody>
                {datos.releases.map((rel) => (
                  <tr key={rel.version}>
                    <td>
                      <b>{rel.version}</b>
                      <span className="mono-corto" style={{ display: 'block' }}>
                        publicada {hace(rel.publicadaEn)}
                      </span>
                      {rel.conflicto && (
                        <span className="chip danger" style={{ whiteSpace: 'normal' }}>
                          {rel.conflicto}
                        </span>
                      )}
                    </td>
                    <td className="mono-corto">
                      {corto(rel.apiDigest)} / {corto(rel.webDigest)}
                    </td>
                    <td className="mono-corto">{rel.commit.slice(0, 10)}</td>
                    {CANALES.map((c, i) => {
                      const en = rel[c.campo];
                      const previo = i === 0 || rel[CANALES[i - 1].campo];
                      return (
                        <td key={c.canal}>
                          {en ? (
                            <>
                              <span className="chip ok">{hace(en)}</span>
                              <button type="button" className="boton" disabled={ocupado || Boolean(rel.conflicto)} onClick={() => void cascada(rel, c.canal)}>
                                Aplicar al canal
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              className="boton"
                              disabled={ocupado || !previo || Boolean(rel.conflicto) || (c.canal === 'estable' && rel.version.includes('-'))}
                              title={!previo ? `Primero en ${CANALES[i - 1].canal}` : c.canal === 'estable' && rel.version.includes('-') ? 'Una version de prueba no llega a estable' : undefined}
                              onClick={() => void promover(rel, c.canal)}
                            >
                              Promover
                            </button>
                          )}
                        </td>
                      );
                    })}
                    <td className="mono-corto">{rel.silos.length ? rel.silos.map((s) => <Link key={s} href={`/consola/silos/${s}`}>{s} </Link>) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Cascadas</h2>
        {!datos || datos.cascadas.length === 0 ? (
          <p className="vacio">Sin cascadas. "Aplicar al canal" actualiza los silos del canal de a uno.</p>
        ) : (
          <ul className="lista">
            {datos.cascadas.map((c) => (
              <li key={c.id} className="mono-corto">
                #{c.id} {c.version} a {c.canal} <span className={`chip ${claseCascada[c.estado]}`}>{c.estado}</span> · {Math.min(c.indice, c.silos.length)}/{c.silos.length} ·{' '}
                {c.silos.map((s, i) => (
                  <span key={s} className={i < c.indice ? 't-ok' : i === c.indice && c.estado !== 'TERMINADA' ? 't-warn' : ''}>
                    {s}
                    {i < c.silos.length - 1 ? ', ' : ''}
                  </span>
                ))}{' '}
                · {hace(c.creadaEn)} por {c.creadaPor}
                {c.estado === 'DETENIDA' && ' · reintenta el job fallido del silo en curso para continuar'}
              </li>
            ))}
          </ul>
        )}
      </section>
      {dialogo}
    </Shell>
  );
}
