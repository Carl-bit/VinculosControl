'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { useConfirmacion } from '@/componentes/dialogo';
import { claseJob, Shell } from '@/componentes/piezas';
import { enviarConSesion, hace, mensajeDe, useDatos, type DetalleJob, type Resumen } from '@/lib/api';

import { PanelLlaves } from './llaves';

/*
 * Job (boceto system-reference/Panel de acceso, "Aprovisionamiento"): pasos a
 * la izquierda, log del agente a la derecha, reintentar desde el paso fallido
 * y cancelar (deshace solo lo creado por el mismo job).
 */

const hora = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('es-CL', { hour12: false }) : '--:--:--');

/** 12,3 s; desde un minuto, 2 min 05 s. */
function formatoDuracion(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  if (s < 60) return `${s.toFixed(1).replace('.', ',')} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${String(Math.floor(s % 60)).padStart(2, '0')} s`;
}

/**
 * Duracion de un paso: terminado, de inicio a fin (fija); EN_CURSO, de inicio
 * a ahora (corre en vivo). `desfase` corrige la diferencia entre el reloj del
 * navegador y el del servidor, para que el cronometro no parta en negativo.
 */
function duracion(p: { estado: string; inicioEn: string | null; finEn: string | null }, ahora: number, desfase: number): string {
  if (!p.inicioEn) return '';
  const inicio = new Date(p.inicioEn).getTime();
  if (p.estado === 'EN_CURSO') return formatoDuracion((p.finEn ? new Date(p.finEn).getTime() : ahora + desfase) - inicio);
  // Un paso reabierto (espera del operador) queda PENDIENTE con el fin del intento anterior: sin cronometro.
  if (p.finEn && (p.estado === 'OK' || p.estado === 'FALLIDO' || p.estado === 'OMITIDO')) return formatoDuracion(new Date(p.finEn).getTime() - inicio);
  return '';
}

/** Reloj para los cronometros: avanza cada 100 ms solo mientras haya algo en curso. */
function useAhora(activo: boolean): number {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    if (!activo) return;
    setAhora(Date.now());
    const t = setInterval(() => setAhora(Date.now()), 100);
    return () => clearInterval(t);
  }, [activo]);
  return ahora;
}

export default function Job() {
  const { id } = useParams<{ id: string }>();
  const { datos: r } = useDatos<Resumen>('consola/resumen', 15_000);
  const { datos: j, error, recargar } = useDatos<DetalleJob>(`consola/jobs/${id}`, 3_000);
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<string>();
  const [confirmar, dialogo] = useConfirmacion();
  const enCurso = j?.pasos.some((p) => p.estado === 'EN_CURSO' && p.inicioEn && !p.finEn) ?? false;
  const ahora = useAhora(enCurso);
  // Si el reloj del navegador va atrasado respecto del servidor, el paso recien iniciado
  // daria negativo: se toma el inicio mas reciente como piso del "ahora" del servidor.
  const ultimoInicio = Math.max(0, ...(j?.pasos ?? []).filter((p) => p.estado === 'EN_CURSO' && p.inicioEn).map((p) => new Date(p.inicioEn!).getTime()));
  const desfase = enCurso && ultimoInicio > ahora ? ultimoInicio - ahora : 0;

  const hacer = async (ruta: string, cuerpo?: unknown) => {
    if (ocupado) return;
    setOcupado(true);
    setMsg(undefined);
    try {
      const res = await enviarConSesion(`consola/jobs/${id}/${ruta}`, cuerpo);
      if (!res.ok) setMsg(mensajeDe(res.datos, `No se pudo (HTTP ${res.status})`));
      await recargar();
    } finally {
      setOcupado(false);
    }
  };

  const fallido = j?.pasos.find((p) => p.estado === 'FALLIDO');
  const log = (j?.pasos ?? []).flatMap((p) => {
    if (p.estado === 'PENDIENTE') return [];
    const quien = p.ejecutor === 'control' ? 'control' : p.ejecutor === 'operador' ? 'operador' : `agente@${j?.agente ?? 'host-b'}`;
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
          {j.estado === 'ESPERANDO_LLAVES' && j.siloSlug && (
            <PanelLlaves jobId={j.id} slug={j.siloSlug} ocupado={ocupado} confirmar={confirmar} enviar={(custodios) => void hacer('confirmar', { paso: 'P5', custodios })} />
          )}
          {j.estado === 'ESPERANDO_OPERADOR' && (
            <section className="panel" aria-label="Dominio del silo">
              <h2>P8 · Dominio</h2>
              <p className="mono-corto" style={{ marginTop: 0 }}>
                {j.pasos.find((p) => p.codigo === 'P8')?.error ?? 'El dominio aun no llega al silo.'} Configura la ruta del dominio en el tunel de Cloudflare hacia Traefik y confirma: el agente lo
                vuelve a verificar.
              </p>
              <button
                type="button"
                className="boton primario"
                disabled={ocupado}
                onClick={async () => {
                  const nota = await confirmar({
                    etiqueta: `Job #${j.id} · erp-${j.siloSlug}`,
                    titulo: 'Dominio listo',
                    texto: 'El agente probara https://<dominio>/api/salud otra vez. Si no responde, el job vuelve a esperar aqui.',
                    boton: 'Verificar de nuevo',
                    campo: { etiqueta: 'Nota (opcional)', maximo: 300 },
                  });
                  if (nota !== null) void hacer('confirmar', { paso: 'P8', nota });
                }}
              >
                Dominio listo
              </button>
            </section>
          )}
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
                onClick={async () => {
                  const ok = await confirmar({
                    etiqueta: `Job #${j.id}`,
                    titulo: 'Cancelar el job',
                    texto:
                      j.tipo === 'APROVISIONAR'
                        ? 'Los pasos pendientes no se ejecutan y el centro vuelve a APROBADO. Lo creado en el host B (stack, .env, token) queda para el siguiente intento; nada se borra solo.'
                        : 'Los pasos pendientes no se ejecutan. VERIFICAR no creo nada; los jobs que crean cosas deshacen solo lo propio, nunca datos del centro.',
                    boton: 'Cancelar job',
                    peligro: true,
                  });
                  if (ok !== null) void hacer('cancelar');
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
                    <span className="mono-corto"> · {p.ejecutor === 'control' ? 'plano de control' : p.ejecutor === 'operador' ? 'operador (manual)' : 'agente'}</span>
                    <span className="mono-corto" style={{ display: 'block' }}>
                      {p.detalle}
                    </span>
                  </span>
                  <span className={`chip ${claseJob[p.estado]}`}>{p.estado}</span>
                  <span className="mono-corto num" aria-live="off">
                    {duracion(p, ahora, desfase)}
                  </span>
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
      {dialogo}
    </Shell>
  );
}
