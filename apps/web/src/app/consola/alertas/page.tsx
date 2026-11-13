'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { claseSeveridad, Shell } from '@/componentes/piezas';
import { enviarConSesion, hace, mensajeDe, useDatos, type Alerta, type Incidente, type Resumen } from '@/lib/api';

export default function Alertas() {
  const router = useRouter();
  const [error, setError] = useState<string>();
  /** Una alerta del monitoreo pasa a incidente con su misma severidad (el plazo corre desde que se abrio la alerta). */
  const abrirIncidente = async (a: Alerta) => {
    const r = await enviarConSesion<Incidente>('consola/incidentes', {
      severidad: a.severidad,
      titulo: a.mensaje.slice(0, 200),
      siloSlug: a.slug ?? undefined,
      alertaId: a.id,
      detectadoEn: a.abiertaEn,
    });
    if (r.ok) router.push(`/consola/incidentes?id=${r.datos.id}`);
    else setError(mensajeDe(r.datos, `HTTP ${r.status}`));
  };
  const { datos: r } = useDatos<Resumen>('consola/resumen', 30_000);
  const { datos: alertas } = useDatos<Alerta[]>('consola/alertas?limite=200', 30_000);
  return (
    <Shell resumen={r} titulo="alertas">
      <div>
        <h1>Alertas</h1>
        <span className="sub">Se abren y cierran solas segun las reglas (apps/api/src/alertas/reglas.ts). Ultimas 200.</span>
      </div>
      {error && (
        <p role="alert" className="chip danger">
          {error}
        </p>
      )}
      <section className="panel">
        {!alertas ? (
          <p className="vacio">Cargando…</p>
        ) : alertas.length === 0 ? (
          <p className="vacio">Sin alertas registradas.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Sev.</th>
                <th>Silo</th>
                <th>Mensaje</th>
                <th>Abierta</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {alertas.map((a) => (
                <tr key={a.id}>
                  <td>
                    <span className={`chip ${claseSeveridad[a.severidad]}`}>{a.severidad}</span>
                  </td>
                  <td>{a.slug ?? 'host'}</td>
                  <td>{a.mensaje}</td>
                  <td>{hace(a.abiertaEn)}</td>
                  <td>{a.cerradaEn ? <span className="chip neu">cerrada {hace(a.cerradaEn)}</span> : <span className="chip warn">abierta</span>}</td>
                  <td>
                    {!a.cerradaEn && (
                      <button type="button" className="boton" onClick={() => void abrirIncidente(a)}>
                        Abrir incidente
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </Shell>
  );
}
