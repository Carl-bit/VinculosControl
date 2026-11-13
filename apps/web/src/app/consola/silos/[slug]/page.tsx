'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';

import { ChipSalud, claseJob, claseSeveridad, Grafico, Medidor, Shell } from '@/componentes/piezas';
import { SolicitudesModulo } from '@/componentes/solicitudes-modulo';
import { enviarConSesion, gib, hace, mensajeDe, mib, useDatos, type DetalleJob, type Detalle, type Incidente, type Resumen } from '@/lib/api';

const COLORES: Record<string, string> = { db: 'var(--info)', backend: 'var(--accent)', frontend: 'var(--warn)' };

export default function Silo() {
  const { slug } = useParams<{ slug: string }>();
  const { datos: r } = useDatos<Resumen>('consola/resumen', 30_000);
  const { datos: d, error } = useDatos<Detalle>(`consola/silos/${slug}?horas=24`, 30_000);
  const fila = r?.silos.find((s) => s.slug === slug);
  const servicios = [...new Set(d?.contenedores.map((c) => c.servicio))].sort();
  const serie = (campo: 'memBytes' | 'cpuPct') =>
    servicios.map((s) => ({
      nombre: s,
      color: COLORES[s] ?? 'var(--ink2)',
      puntos: d!.contenedores.filter((c) => c.servicio === s).map((c) => ({ t: new Date(c.en).getTime(), v: campo === 'memBytes' ? c.memBytes / 2 ** 20 : c.cpuPct })),
    }));
  const router = useRouter();
  const [msg, setMsg] = useState<string>();
  /** Acciones del boceto (Silos / detalle): reiniciar (ejecutor) y abrir un incidente del silo. */
  const reiniciar = async () => {
    if (!window.confirm(`Reiniciar backend y frontend de erp-${slug}? La base de datos no se toca.`)) return;
    const r = await enviarConSesion<DetalleJob>('consola/jobs', { tipo: 'REINICIAR_SILO', siloSlug: slug });
    if (r.ok) router.push(`/consola/jobs/${r.datos.id}`);
    else setMsg(mensajeDe(r.datos, `HTTP ${r.status}`));
  };
  const incidente = async () => {
    const titulo = window.prompt('Que paso (hecho tecnico, sin datos personales):');
    if (!titulo || titulo.trim().length < 4) return;
    const r = await enviarConSesion<Incidente>('consola/incidentes', { severidad: 'S2', titulo: titulo.trim(), siloSlug: slug });
    if (r.ok) router.push(`/consola/incidentes?id=${r.datos.id}`);
    else setMsg(mensajeDe(r.datos, `HTTP ${r.status}`));
  };
  const disponibilidad = d && d.salud.length ? Math.round((d.salud.filter((m) => m.ok).length / d.salud.length) * 1000) / 10 : null;

  return (
    <Shell resumen={r} titulo={`silos / ${slug}`}>
      <div>
        <h1>{slug}</h1>
        <span className="sub">
          {d?.dominio ?? ''} · ultimas 24 h{error && ` · error: ${error}`}
        </span>
      </div>
      <div className="acciones">
        <button type="button" className="boton" onClick={() => void reiniciar()}>
          Reiniciar contenedores
        </button>
        <button type="button" className="boton" onClick={() => void incidente()}>
          Abrir incidente
        </button>
        <span className="boton" aria-disabled="true" title="Fase 5: salidas (exporte, gracia, eliminacion con acta)" style={{ opacity: 0.45 }}>
          Iniciar salida (pronto)
        </span>
        {d?.centro && (
          <span className="mono-corto">
            centro <Link href={`/consola/manifiestos/${d.centro.id}`}>{d.centro.nombre}</Link> · {d.centro.estado}
            {d.centro.revisionAprobada && ` · manifiesto rev ${d.centro.revisionAprobada} sha ${d.centro.hashAprobado?.slice(0, 12)}`}
          </span>
        )}
      </div>
      {msg && (
        <p role="alert" className="chip danger">
          {msg}
        </p>
      )}
      {!d ? (
        <p className="vacio">Cargando…</p>
      ) : (
        <>
          {d.jobs.length > 0 && (
            <section className="panel">
              <h2>Jobs recientes</h2>
              <ul className="lista">
                {d.jobs.map((j) => (
                  <li key={j.id} className="mono-corto">
                    <Link href={`/consola/jobs/${j.id}`}>#{j.id}</Link> {j.tipo.toLowerCase()} <span className={`chip ${claseJob[j.estado]}`}>{j.estado}</span> · {hace(j.creadoEn)} · {j.creadoPor}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <SolicitudesModulo slug={slug} />
          <section className="kpis">
            <div className="panel kpi">
              <div className="l">salud ahora</div>
              <div className="v" style={{ fontSize: 16, marginTop: 6 }}>
                {fila && <ChipSalud silo={fila} />}
              </div>
              <div className="l">canarios {fila?.salud?.canarios === false ? 'FALLAN' : 'ok'} · bd {fila?.salud?.bd === false ? 'FALLA' : 'ok'}</div>
            </div>
            <div className="panel kpi">
              <div className="l">disponibilidad 24 h</div>
              <div className="v">{disponibilidad === null ? '-' : `${disponibilidad} %`}</div>
              <div className="l">{d.salud.length} sondeos de /api/salud</div>
            </div>
            <div className="panel kpi">
              <div className="l">respaldo</div>
              <div className="v" style={{ fontSize: 16, marginTop: 6 }}>
                {d.respaldo ? hace(d.respaldo.fecha) : 'sin respaldo'}
              </div>
              <div className="l">{d.respaldo ? `${gib(d.respaldo.bytes)} GiB · sha256 ${d.respaldo.sha256?.slice(0, 12) ?? '-'}` : 'instalar.sh no corre'}</div>
            </div>
          </section>

          <div className="rejilla">
            <section className="panel">
              <h2>RAM por contenedor (MiB, limite 256)</h2>
              <Grafico series={serie('memBytes')} max={256} />
            </section>
            <section className="panel">
              <h2>Contenedores ahora</h2>
              {fila?.contenedores.map((c) => (
                <div key={c.servicio} style={{ marginBottom: 6 }}>
                  <Medidor frac={c.memLimite ? c.memBytes / c.memLimite : 0} texto={`${c.servicio} ${mib(c.memBytes)}/${mib(c.memLimite)} MiB · ${c.cpuPct} % · ${c.reinicios} reinicios`} />
                </div>
              ))}
            </section>
          </div>

          <div className="rejilla">
            <section className="panel">
              <h2>CPU por contenedor (% de una vCPU)</h2>
              <Grafico series={serie('cpuPct')} />
            </section>
            <section className="panel">
              <h2>Latencia de /api/salud (ms, desde host A)</h2>
              <Grafico series={[{ nombre: 'salud', color: 'var(--accent)', puntos: d.salud.filter((m) => m.latenciaMs !== null).map((m) => ({ t: new Date(m.en).getTime(), v: m.latenciaMs! })) }]} />
            </section>
          </div>

          <section className="panel">
            <h2>Latencia por ruta (ultimos 5 min, calculada en el host B)</h2>
            {d.latencias.length === 0 ? (
              <p className="vacio">Sin peticiones en la ventana.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      <th>Ruta</th>
                      <th className="num">n</th>
                      <th className="num">p50</th>
                      <th className="num">p95</th>
                      <th className="num">max</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.latencias.map((l) => (
                      <tr key={l.ruta}>
                        <td>{l.ruta}</td>
                        <td className="num">{l.n}</td>
                        <td className="num">{l.p50}</td>
                        <td className="num">
                          <span className={l.n >= 20 && l.p95 > 300 ? 'chip warn' : ''}>{l.p95}</span>
                        </td>
                        <td className="num">{l.max}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="panel">
            <h2>Historial de alertas</h2>
            {d.alertas.length === 0 ? (
              <p className="vacio">Sin alertas registradas.</p>
            ) : (
              <ul className="lista">
                {d.alertas.map((a) => (
                  <li key={a.id}>
                    <span className={`chip ${a.cerradaEn ? 'neu' : claseSeveridad[a.severidad]}`}>{a.severidad}</span>
                    <span>
                      {a.mensaje}
                      <div className="sub">
                        abierta {hace(a.abiertaEn)}
                        {a.cerradaEn ? ` · cerrada ${hace(a.cerradaEn)}` : ' · abierta'}
                      </div>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </Shell>
  );
}
