'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { ChipSalud, Medidor } from '@/componentes/piezas';
import { accion, enviarConSesion, hace, mensajeDe, mib, type DetalleJob, type Resumen } from '@/lib/api';

/** Tabla de silos (stacks erp-* que reporta el agente): la usan Resumen y Silos. */
export function TablaSilos({ resumen: r, recargar }: { resumen?: Resumen; recargar: () => Promise<void> }) {
  const [ocupado, setOcupado] = useState<string>();
  const router = useRouter();
  const [error, setError] = useState<string>();
  /** Reinicio de backend y frontend por el ejecutor del host B (job REINICIAR_SILO). db no se toca. */
  const reiniciar = async (slug: string) => {
    if (!window.confirm(`Reiniciar backend y frontend de erp-${slug}? La base de datos no se toca. Las sesiones abiertas del centro pueden cortarse.`)) return;
    setOcupado(slug);
    setError(undefined);
    try {
      const r = await enviarConSesion<DetalleJob>('consola/jobs', { tipo: 'REINICIAR_SILO', siloSlug: slug });
      if (!r.ok) setError(`${slug}: ${mensajeDe(r.datos, `HTTP ${r.status}`)}`);
      else router.push(`/consola/jobs/${r.datos.id}`);
    } finally {
      setOcupado(undefined);
    }
  };
  const cambiar = async (slug: string, que: 'adoptar' | 'soltar') => {
    setOcupado(slug);
    try {
      await accion(`consola/silos/${slug}/${que}`);
      await recargar();
    } finally {
      setOcupado(undefined);
    }
  };
  return (
    <>
      {error && (
        <p role="alert" className="chip danger" style={{ whiteSpace: 'normal' }}>
          {error}
        </p>
      )}
    {!r ? (
      <p className="vacio">Cargando…</p>
    ) : r.silos.length === 0 ? (
      <p className="vacio">El agente todavia no reporta stacks erp-*. Revisa que este corriendo en el host B.</p>
    ) : (
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Silo</th>
              <th>Salud</th>
              <th>RAM (MiB / limite)</th>
              <th className="num">CPU</th>
              <th className="num">p95 max</th>
              <th>Respaldo</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {r.silos.map((s) => (
              <tr key={s.slug}>
                <td>
                  {s.adoptado ? <Link href={`/consola/silos/${s.slug}`}>{s.slug}</Link> : s.slug}
                  <div className="sub">{s.dominio ?? 'sin dominio'}</div>
                </td>
                <td>
                  <ChipSalud silo={s} />
                </td>
                <td>
                  {s.contenedores.map((c) => (
                    <div key={c.servicio}>
                      <Medidor
                        frac={c.memLimite ? c.memBytes / c.memLimite : 0}
                        texto={c.estado === 'running' ? `${c.servicio} ${mib(c.memBytes)}/${mib(c.memLimite)}` : `${c.servicio} ${c.estado}`}
                      />
                    </div>
                  ))}
                </td>
                <td className="num">{s.contenedores.reduce((a, c) => a + c.cpuPct, 0).toFixed(1)} %</td>
                <td className="num">{s.p95Max === null ? '-' : `${s.p95Max} ms`}</td>
                <td>{s.respaldo ? hace(s.respaldo.fecha) : <span className="chip warn">sin respaldo</span>}</td>
                <td>
                  <button
                    type="button"
                    className={`boton ${s.adoptado ? '' : 'primario'}`}
                    disabled={ocupado === s.slug}
                    onClick={() => void cambiar(s.slug, s.adoptado ? 'soltar' : 'adoptar')}
                  >
                    {s.adoptado ? 'Soltar' : 'Adoptar'}
                  </button>{' '}
                  <button type="button" className="boton" disabled={ocupado === s.slug} title="Reinicia backend y frontend por el ejecutor del host B" onClick={() => void reiniciar(s.slug)}>
                    Reiniciar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
    </>
  );
}
