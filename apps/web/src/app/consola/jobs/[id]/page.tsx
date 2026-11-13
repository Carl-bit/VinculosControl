'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';

import { claseJob, Shell } from '@/componentes/piezas';
import { enviarConSesion, hace, mensajeDe, useDatos, type DetalleJob, type Resumen } from '@/lib/api';

/*
 * Job (boceto system-reference/Panel de acceso, "Aprovisionamiento"): pasos a
 * la izquierda, log del agente a la derecha, reintentar desde el paso fallido
 * y cancelar (deshace solo lo creado por el mismo job).
 */

const hora = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('es-CL', { hour12: false }) : '--:--:--');
const duracion = (a: string | null, b: string | null) => (a && b ? `${((new Date(b).getTime() - new Date(a).getTime()) / 1000).toFixed(1).replace('.', ',')} s` : '');

export default function Job() {
  const { id } = useParams<{ id: string }>();
  const { datos: r } = useDatos<Resumen>('consola/resumen', 15_000);
  const { datos: j, error, recargar } = useDatos<DetalleJob>(`consola/jobs/${id}`, 3_000);
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<string>();

  const hacer = async (ruta: string) => {
    if (ocupado) return;
    setOcupado(true);
    setMsg(undefined);
    try {
      const res = await enviarConSesion(`consola/jobs/${id}/${ruta}`);
      if (!res.ok) setMsg(mensajeDe(res.datos, `No se pudo (HTTP ${res.status})`));
      await recargar();
    } finally {
      setOcupado(false);
    }
  };

  const fallido = j?.pasos.find((p) => p.estado === 'FALLIDO');
  const log = (j?.pasos ?? []).flatMap((p) => {
    if (p.estado === 'PENDIENTE') return [];
    const quien = p.ejecutor === 'control' ? 'control' : `agente@${j?.agente ?? 'host-b'}`;
    const lineas = [{ t: `${hora(p.inicioEn)}  ${p.codigo} ${p.nombre} · ${quien}`, c: 't-neu' }];
    for (const l of p.log) lineas.push({ t: `          ${l}`, c: 't-ok' });
    if (p.estado === 'EN_CURSO') lineas.push({ t: '          en curso...', c: 't-warn' });
    if (p.estado === 'OMITIDO') lineas.push({ t: '          omitido', c: 't-warn' });
    if (p.error) lineas.push({ t: `          error: ${p.error}`, c: 't-danger' });
    return lineas;
  });

  return (
    <Shell resumen={r} titulo={`aprovisionamiento / #${id}`}>
      <div className="cabecera-vista">
        <div>
          <Link href="/consola/jobs" className="sub">
            ← Aprovisionamiento
          </Link>
          <h1>
            Job {j?.tipo.toLowerCase() ?? '…'} · {j?.siloSlug ?? ''}
          </h1>
          <span className="sub">
            job #{id} · {j?.agente ? `ejecuta agente@${j.agente}` : 'esperando que el agente lo reclame'}
            {j?.revision && ` · rev ${j.revision} sha ${j.hashManifiesto?.slice(0, 6)}`}
            {j?.centro && (
              <>
                {' · '}
                <Link href={`/consola/manifiestos/${j.centro.id}`}>{j.centro.nombre}</Link>
              </>
            )}
            {error && ` · error: ${error}`}
          </span>
        </div>
        {j && <span className={`chip ${claseJob[j.estado]}`}>{j.estado}</span>}
      </div>

      {j && (
        <>
          <div className="acciones">
            {j.estado === 'FALLIDO' && (
              <button type="button" className="boton primario" disabled={ocupado} onClick={() => void hacer('reintentar')}>
                Reintentar desde {fallido?.codigo ?? 'el paso fallido'}
              </button>
            )}
            {j.puedeCancelar && (
              <button
                type="button"
                className="boton"
                disabled={ocupado}
                onClick={() => {
                  if (window.confirm('Cancelar el job. VERIFICAR no creo nada; los jobs que crean cosas deshacen solo lo propio. ¿Cancelar?')) void hacer('cancelar');
                }}
              >
                Cancelar (deshace solo lo creado por este job)
              </button>
            )}
            <span className="mono-corto">
              creado {hace(j.creadoEn)} por {j.creadoPor} · intentos {j.intentos}
              {j.terminadoEn && ` · termino ${hace(j.terminadoEn)}`}
            </span>
          </div>
          {msg && (
            <p role="alert" className="chip danger">
              {msg}
            </p>
          )}
          {j.error && <p className="chip danger" style={{ whiteSpace: 'normal' }}>{j.error}</p>}

          <div className="dos-columnas">
            <section className="panel pasos-job" style={{ flex: '1 1 440px' }}>
              {j.pasos.map((p) => (
                <div key={p.codigo} className="paso" data-estado={p.estado}>
                  <span className="paso-codigo">{p.codigo}</span>
                  <span>
                    <b>{p.nombre}</b>
                    <span className="mono-corto"> · {p.ejecutor === 'control' ? 'plano de control' : 'agente'}</span>
                    <span className="mono-corto" style={{ display: 'block' }}>
                      {p.detalle}
                    </span>
                  </span>
                  <span className={`chip ${claseJob[p.estado]}`}>{p.estado}</span>
                  <span className="mono-corto num">{duracion(p.inicioEn, p.finEn)}</span>
                </div>
              ))}
            </section>
            <section className="codigo" aria-label="Log del job" style={{ flex: '1 1 380px', minWidth: 0 }}>
              <div className="codigo-barra">agente@{j.agente ?? 'host-b'} · stdout</div>
              <div role="log" className="terminal-log" style={{ minHeight: 260 }}>
                {log.length === 0 ? <span className="t-neu">esperando...</span> : log.map((l, i) => <span key={i} className={l.c}>{l.t}</span>)}
              </div>
            </section>
          </div>
        </>
      )}
    </Shell>
  );
}
