'use client';

import { useEffect, useState } from 'react';

import { claseEstado, Shell } from '@/componentes/piezas';
import { hace, useDatos, type FilaCentro, type Resumen } from '@/lib/api';

import { codigo, DetalleSolicitud } from './detalle';

/** Filtros del boceto: pipeline comercial. */
const FILTROS = [
  { v: 'SOLICITUD', l: 'Nuevas' },
  { v: 'CONTACTADO', l: 'Contactadas' },
  { v: 'REUNION', l: 'Reunion' },
  { v: 'DATOS_COMPLETOS', l: 'Datos completos' },
  { v: 'DESCARTADO', l: 'Descartadas' },
  { v: '', l: 'Todas' },
];

/** Maestro-detalle (boceto): tabla a la izquierda, la solicitud elegida a la derecha. */
export function Lista({ inicial }: { inicial?: number }) {
  const [estado, setEstado] = useState(inicial ? '' : 'SOLICITUD');
  const [sel, setSel] = useState<number | undefined>(inicial);
  const { datos: r, recargar: recargarResumen } = useDatos<Resumen>('consola/resumen', 30_000);
  const { datos: centros, error, recargar } = useDatos<FilaCentro[]>(`consola/centros${estado ? `?estado=${estado}` : ''}`, 30_000);

  // Primera fila elegida por defecto; la eleccion queda en la URL para compartirla o recargar.
  useEffect(() => {
    if (centros?.length && (sel === undefined || !centros.some((c) => c.id === sel)) && !inicial) setSel(centros[0].id);
  }, [centros, sel, inicial]);
  useEffect(() => {
    if (sel !== undefined) window.history.replaceState(null, '', `/consola/solicitudes?id=${sel}`);
  }, [sel]);

  return (
    <Shell resumen={r} titulo="solicitudes">
      <div className="cabecera-vista">
        <div>
          <h1>Solicitudes</h1>
          <span className="sub">Llegan desde el sitio de Vinculos (manifiesto fase 1, sin datos sensibles){error && ` · error: ${error}`}</span>
        </div>
      </div>
      <div className="filtros" role="group" aria-label="Filtrar por estado">
        {FILTROS.map((f) => (
          <button key={f.v} type="button" className="boton" aria-pressed={estado === f.v} onClick={() => setEstado(f.v)}>
            {f.l}
            {f.v === 'SOLICITUD' && !!r?.solicitudesNuevas && ` (${r.solicitudesNuevas})`}
          </button>
        ))}
      </div>
      <div className="maestro-detalle">
        <section className="panel maestro">
          {!centros ? (
            <p className="vacio">Cargando…</p>
          ) : centros.length === 0 ? (
            <p className="vacio">Sin solicitudes en este estado.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Centro</th>
                  <th>Comuna</th>
                  <th>Tamano</th>
                  <th className="num">Bloq.</th>
                  <th>Recibida</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {centros.map((c) => (
                  <tr key={c.id} className="fila-clic" aria-selected={sel === c.id} onClick={() => setSel(c.id)}>
                    <td className="nowrap">
                      <button type="button" className="enlace-fila" onClick={() => setSel(c.id)}>
                        {codigo(c.id)}
                      </button>
                    </td>
                    <td>
                      <b>{c.nombre}</b>
                    </td>
                    <td className="sub">{c.comuna}</td>
                    <td className="nowrap">{c.tamanoEquipo ?? '-'}</td>
                    <td className="num" title={c.modulosInteres.join(', ')}>
                      {c.modulosInteres.length}
                    </td>
                    <td className="nowrap sub">{hace(c.creadoEn)}</td>
                    <td>
                      <span className={`chip ${claseEstado[c.estado]}`}>{c.estado}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        {sel !== undefined && (
          <DetalleSolicitud
            id={sel}
            alCambiar={async () => {
              await Promise.all([recargar(), recargarResumen()]);
            }}
          />
        )}
      </div>
    </Shell>
  );
}
