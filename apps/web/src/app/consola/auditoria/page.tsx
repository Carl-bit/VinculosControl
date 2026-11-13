'use client';

import { useState } from 'react';

import { Shell } from '@/componentes/piezas';
import { useDatos, type EventoAuditoria, type Resumen } from '@/lib/api';

const FILTROS = [
  { v: '', l: 'Todos' },
  { v: 'auth', l: 'Acceso' },
  { v: 'operador', l: 'Operadores' },
  { v: 'silo', l: 'Silos' },
];

/** Color del chip segun la accion: fallos y bloqueos en rojo, el resto neutro. */
function tono(accion: string): string {
  if (/bloqueo|bloqueada|agotado/.test(accion)) return 'danger';
  if (/invalid/.test(accion)) return 'warn';
  if (accion === 'auth.sesion_iniciada' || accion.startsWith('silo.')) return 'ok';
  return 'neu';
}

export default function Auditoria() {
  const [tipo, setTipo] = useState('');
  const { datos: r } = useDatos<Resumen>('consola/resumen', 30_000);
  const { datos: eventos, error } = useDatos<EventoAuditoria[]>(`consola/auditoria?limite=200${tipo ? `&tipo=${tipo}` : ''}`, 30_000);
  return (
    <Shell resumen={r} titulo="auditoria">
      <div>
        <h1>Auditoria</h1>
        <span className="sub">Accesos y acciones de la consola. Sin datos clinicos. Ultimos 200{error && ` · error: ${error}`}</span>
      </div>
      <div className="filtros" role="group" aria-label="Filtrar por tipo">
        {FILTROS.map((f) => (
          <button key={f.v} type="button" className="boton" aria-pressed={tipo === f.v} onClick={() => setTipo(f.v)}>
            {f.l}
          </button>
        ))}
      </div>
      <section className="panel">
        {!eventos ? (
          <p className="vacio">Cargando…</p>
        ) : eventos.length === 0 ? (
          <p className="vacio">Sin eventos.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Actor</th>
                <th>Accion</th>
                <th>Objeto</th>
                <th>Detalle</th>
              </tr>
            </thead>
            <tbody>
              {eventos.map((e) => (
                <tr key={e.id}>
                  <td className="nowrap">{new Date(e.en).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'medium' })}</td>
                  <td>{e.actor}</td>
                  <td>
                    <span className={`chip ${tono(e.accion)}`}>{e.accion}</span>
                  </td>
                  <td>{e.objeto ?? '-'}</td>
                  <td className="sub">{e.detalle ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </Shell>
  );
}
