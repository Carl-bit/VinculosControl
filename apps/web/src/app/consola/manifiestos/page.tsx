'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { claseEstado, Shell } from '@/componentes/piezas';
import { hace, useDatos, type FilaCentro, type Resumen } from '@/lib/api';

/** Centros con manifiesto en curso o aprobado (despues de la reunion). */
const CON_MANIFIESTO = ['REUNION', 'DATOS_COMPLETOS', 'APROBADO', 'APROVISIONANDO', 'ACTIVO', 'ACTIVO_SIN_DOMINIO', 'SUSPENDIDO'];

export default function Manifiestos() {
  const router = useRouter();
  const { datos: r } = useDatos<Resumen>('consola/resumen', 30_000);
  const { datos: centros, error } = useDatos<FilaCentro[]>('consola/centros', 30_000);
  const lista = centros?.filter((c) => CON_MANIFIESTO.includes(c.estado)) ?? [];
  return (
    <Shell resumen={r} titulo="manifiestos">
      <div>
        <h1>Manifiestos</h1>
        <span className="sub">Fase 2 en adelante: revisiones con hash, P0 y aprobacion{error && ` · error: ${error}`}</span>
      </div>
      <section className="panel">
        {!centros ? (
          <p className="vacio">Cargando…</p>
        ) : lista.length === 0 ? (
          <p className="vacio">Ningun centro llego a la reunion todavia. Avanzalos desde Solicitudes.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Slug</th>
                <th>Centro</th>
                <th>Estado</th>
                <th>Actualizado</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((c) => (
                <tr key={c.id} className="fila-clic" onClick={() => router.push(`/consola/manifiestos/${c.id}`)}>
                  <td className="nowrap">
                    <Link href={`/consola/manifiestos/${c.id}`}>{c.slug ?? 'sin slug'}</Link>
                  </td>
                  <td>{c.nombre}</td>
                  <td>
                    <span className={`chip ${claseEstado[c.estado]}`}>{c.estado}</span>
                  </td>
                  <td className="sub">{hace(c.creadoEn)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </Shell>
  );
}
