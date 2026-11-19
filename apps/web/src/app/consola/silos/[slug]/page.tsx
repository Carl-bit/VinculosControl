'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';

import { CampoFecha } from '@/componentes/controles';
import { Dialogo, useConfirmacion } from '@/componentes/dialogo';
import { ChipSalud, claseJob, claseSeveridad, EnlaceDominio, Grafico, Medidor, Shell } from '@/componentes/piezas';
import { SolicitudesModulo } from '@/componentes/solicitudes-modulo';
import { enviarConSesion, hace, mensajeDe, mib, tamano, useDatos, type DetalleJob, type DetalleSalida, type Detalle, type Incidente, type Resumen } from '@/lib/api';

import { PanelVersion } from './version';

const COLORES: Record<string, string> = { db: 'var(--info)', backend: 'var(--accent)', frontend: 'var(--warn)' };
const ORIGENES_SALIDA = ['ACTIVO', 'ACTIVO_SIN_DOMINIO', 'SUSPENDIDO'];
const EN_SALIDA = ['EN_SALIDA', 'EXPORTADO', 'GRACIA', 'ELIMINADO'];

/** S1 de la salida (CONTEXTO.md seccion 8): fecha de corte, motivo y el slug escrito para confirmar. */
function IniciarSalida({ slug, centro }: { slug: string; centro: NonNullable<Detalle['centro']> }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [corte, setCorte] = useState('');
  const [motivo, setMotivo] = useState('');
  const [conf, setConf] = useState('');
  const [msg, setMsg] = useState<string>();
  const [ocupado, setOcupado] = useState(false);
  if (EN_SALIDA.includes(centro.estado))
    return (
      <Link className="boton" href={`/consola/salidas?centro=${centro.id}`}>
        Ver salida
      </Link>
    );
  const puede = ORIGENES_SALIDA.includes(centro.estado);
  const enviar = async () => {
    setOcupado(true);
    try {
      const r = await enviarConSesion<DetalleSalida>('consola/salidas', { centroId: centro.id, fechaCorte: corte, motivo: motivo.trim(), confirmacion: conf.trim() });
      if (r.ok) router.push(`/consola/salidas?salida=${r.datos.id}`);
      else setMsg(mensajeDe(r.datos, `HTTP ${r.status}`));
    } finally {
      setOcupado(false);
    }
  };
  return (
    <>
      <button
        type="button"
        className="boton"
        disabled={!puede}
        title={puede ? undefined : `Una salida se inicia desde ${ORIGENES_SALIDA.join(', ')} (el centro esta en ${centro.estado})`}
        onClick={() => {
          setMsg(undefined);
          setAbierto(true);
        }}
      >
        Iniciar salida
      </button>
      <Dialogo
        abierto={abierto}
        etiqueta={`S1 · erp-${slug}`}
        titulo="Iniciar salida del centro"
        ocupado={ocupado}
        onCerrar={() => setAbierto(false)}
        pie={
          <>
            <button type="button" className="boton" disabled={ocupado} onClick={() => setAbierto(false)}>
              Cancelar
            </button>
            <button type="button" className="boton peligro" disabled={ocupado || !corte || motivo.trim().length < 4 || conf.trim() !== slug} onClick={() => void enviar()}>
              Iniciar salida
            </button>
          </>
        }
      >
        <p className="sub">
          {centro.nombre} pasa a EN_SALIDA. Sigue: el ADMIN genera el exporte cifrado en su silo, el centro firma el acta de recepcion, se detiene el silo y corre la gracia antes de eliminar.
        </p>
        <label className="campo-consola">
          Fecha de corte del contrato
          <CampoFecha requerido valor={corte} onCambio={setCorte} />
        </label>
        <label className="campo-consola">
          Motivo (contractual, sin datos de pacientes)
          <input className="campo-texto" maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </label>
        <label className="campo-consola">
          Escribe {slug} para confirmar
          <input className="campo-texto" spellCheck={false} maxLength={40} value={conf} onChange={(e) => setConf(e.target.value)} />
        </label>
        {msg && (
          <p role="alert" className="chip danger" style={{ whiteSpace: 'normal' }}>
            {msg}
          </p>
        )}
      </Dialogo>
    </>
  );
}

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
  const [confirmar, dialogo] = useConfirmacion();
  /** Acciones del boceto (Silos / detalle): reiniciar (ejecutor) y abrir un incidente del silo. */
  const reiniciar = async () => {
    const ok = await confirmar({
      etiqueta: `Silo · erp-${slug}`,
      titulo: 'Reiniciar contenedores',
      texto: 'Reinicia backend y frontend por el ejecutor del host B (job REINICIAR_SILO). La base de datos no se toca. Las sesiones abiertas del centro pueden cortarse.',
      boton: 'Reiniciar',
      peligro: true,
    });
    if (ok === null) return;
    const r = await enviarConSesion<DetalleJob>('consola/jobs', { tipo: 'REINICIAR_SILO', siloSlug: slug });
    if (r.ok) router.push(`/consola/jobs/${r.datos.id}`);
    else setMsg(mensajeDe(r.datos, `HTTP ${r.status}`));
  };
  const incidente = async () => {
    const titulo = await confirmar({
      etiqueta: `Silo · erp-${slug}`,
      titulo: 'Abrir incidente S2',
      texto: 'Queda abierto con severidad S2 y sus plazos; la severidad se ajusta en Incidentes.',
      boton: 'Abrir incidente',
      campo: { etiqueta: 'Que paso (hecho tecnico, sin datos personales)', minimo: 4, maximo: 200 },
    });
    if (!titulo) return;
    const r = await enviarConSesion<Incidente>('consola/incidentes', { severidad: 'S2', titulo, siloSlug: slug });
    if (r.ok) router.push(`/consola/incidentes?id=${r.datos.id}`);
    else setMsg(mensajeDe(r.datos, `HTTP ${r.status}`));
  };
  const disponibilidad = d && d.salud.length ? Math.round((d.salud.filter((m) => m.ok).length / d.salud.length) * 1000) / 10 : null;

  return (
    <Shell resumen={r} titulo={`silos / ${slug}`}>
      <div>
        <h1>{slug}</h1>
        <span className="sub">
          <EnlaceDominio dominio={d?.dominio} vacio="" /> · ultimas 24 h{error && ` · error: ${error}`}
        </span>
      </div>
      <div className="acciones">
        <button type="button" className="boton" onClick={() => void reiniciar()}>
          Reiniciar contenedores
        </button>
        <button type="button" className="boton" onClick={() => void incidente()}>
          Abrir incidente
        </button>
        {d?.centro && <IniciarSalida slug={slug} centro={d.centro} />}
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
          <PanelVersion slug={slug} />
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
              <div className="l">{d.respaldo ? `${tamano(d.respaldo.bytes)} · sha256 ${d.respaldo.sha256?.slice(0, 12) ?? '-'}` : 'instalar.sh no corre'}</div>
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
      {dialogo}
    </Shell>
  );
}
