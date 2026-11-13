'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { claseJob, Shell } from '@/componentes/piezas';
import { hace, useDatos, type FilaJob, type Resumen } from '@/lib/api';

/** Lista de jobs (cola en Postgres). Se crean desde el manifiesto aprobado de cada centro. */
export default function Jobs() {
  const router = useRouter();
  const { datos: r } = useDatos<Resumen>('consola/resumen', 15_000);
  const { datos: jobs, error } = useDatos<FilaJob[]>('consola/jobs', 5_000);
  return (
    <Shell resumen={r} titulo="aprovisionamiento">
      <div>
        <h1>Aprovisionamiento</h1>
        <span className="sub">
          Cola de jobs: el agente del host B los reclama y reporta cada paso. Hoy se ejecuta VERIFICAR (solo lectura){error && ` · error: ${error}`}
        </span>
      </div>
      <section className="panel">
        {!jobs ? (
          <p className="vacio">Cargando…</p>
        ) : jobs.length === 0 ? (
          <p className="vacio">Sin jobs. Crea uno desde el manifiesto aprobado de un centro (Manifiestos).</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Job</th>
                <th>Tipo</th>
                <th>Silo</th>
                <th>Pasos</th>
                <th>Creado</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="fila-clic" onClick={() => router.push(`/consola/jobs/${j.id}`)}>
                  <td className="nowrap">
                    <Link href={`/consola/jobs/${j.id}`}>#{j.id}</Link>
                  </td>
                  <td>{j.tipo.toLowerCase()}</td>
                  <td>{j.siloSlug ?? '-'}</td>
                  <td>
                    <span className="pasos-mini" aria-label="Pasos">
                      {j.pasos.map((p) => (
                        <span key={p.codigo} className={`chip ${claseJob[p.estado]}`} title={`${p.codigo} ${p.estado}`}>
                          {p.codigo}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className="sub nowrap">
                    {hace(j.creadoEn)} · {j.creadoPor}
                  </td>
                  <td>
                    <span className={`chip ${claseJob[j.estado]}`}>{j.estado}</span>
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
