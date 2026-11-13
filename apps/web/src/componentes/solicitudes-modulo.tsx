'use client';

import { useState } from 'react';

import { enviarConSesion, hace, mensajeDe, useDatos } from '@/lib/api';

/** Tarea 31 (R2/R3): solicitud de modulo que pidio el ADMIN del centro en su silo. Solo metadatos. */
export interface SolicitudModulo {
  siloSlug: string;
  id: string;
  modulo: string;
  accion: 'ACTIVAR' | 'DESACTIVAR';
  pedidaPorRol: string;
  pedidaEn: string;
  estado: 'PENDIENTE' | 'APROBADA' | 'RECHAZADA' | 'APLICADA';
  estadoSilo: SolicitudModulo['estado'];
  respuesta: string | null;
  decididaPor: string | null;
  decididaEn: string | null;
  errorEntrega: string | null;
  vistaEn: string;
}

const CLASE: Record<SolicitudModulo['estado'], string> = { PENDIENTE: 'warn', APROBADA: 'info', RECHAZADA: 'neu', APLICADA: 'ok' };

/**
 * Bandeja del silo: aprobar, rechazar o marcar aplicada. La decision la
 * entrega el agente al silo (R3) en su siguiente ciclo (60 s). Aprobar crea
 * una revision nueva del manifiesto y un job RECONFIGURAR (R4) que, al
 * terminar, marca la solicitud APLICADA. Sin centro aprobado en la consola
 * (silo de desarrollo), el cambio se aplica a mano y se marca aplicada.
 */
export function SolicitudesModulo({ slug }: { slug: string }) {
  const { datos, error, recargar } = useDatos<SolicitudModulo[]>(`consola/solicitudes-modulo?silo=${slug}`, 30_000);
  const [msg, setMsg] = useState<string>();

  const decidir = async (s: SolicitudModulo, estado: 'APROBADA' | 'RECHAZADA' | 'APLICADA') => {
    const pregunta =
      estado === 'APLICADA'
        ? `Marcar como aplicada: ${s.accion.toLowerCase()} ${s.modulo}. Solo si modulos_activos del silo ya lo refleja (el silo lo verifica). Texto para el ADMIN (opcional):`
        : `${estado === 'APROBADA' ? 'Aprobar' : 'Rechazar'}: ${s.accion.toLowerCase()} ${s.modulo}. Texto para el ADMIN del centro (sin datos personales, opcional):`;
    const respuesta = window.prompt(pregunta, '');
    if (respuesta === null) return;
    const r = await enviarConSesion(`consola/solicitudes-modulo/${s.siloSlug}/${s.id}/decision`, { estado, ...(respuesta.trim() ? { respuesta: respuesta.trim() } : {}) });
    const reconf = (r.datos as { reconfigurar?: { motivo: string } }).reconfigurar;
    setMsg(
      r.ok
        ? `Decision registrada: el agente la entrega al silo en el siguiente ciclo.${reconf ? ` ${reconf.motivo}.` : ''}`
        : mensajeDe(r.datos as { mensaje?: string }, `HTTP ${r.status}`),
    );
    void recargar();
  };

  return (
    <section className="panel">
      <h2>Solicitudes de modulos (tarea 31)</h2>
      {error && <p className="vacio">error: {error}</p>}
      {msg && <p className="sub">{msg}</p>}
      {!datos ? (
        <p className="vacio">Cargando…</p>
      ) : datos.length === 0 ? (
        <p className="vacio">El ADMIN del centro no ha pedido modulos. Llegan solas si el agente tiene el token interno del silo y esta en su red de borde.</p>
      ) : (
        <ul className="lista">
          {datos.map((s) => {
            const enCamino = s.estado !== s.estadoSilo;
            return (
              <li key={s.id}>
                <span className={`chip ${CLASE[s.estado]}`}>{s.estado}</span>
                <span style={{ flex: 1 }}>
                  {s.accion === 'ACTIVAR' ? 'activar' : 'desactivar'} <strong>{s.modulo}</strong> · pedida por {s.pedidaPorRol} {hace(s.pedidaEn)}
                  <div className="sub">
                    {enCamino ? `entregando al silo (el silo aun dice ${s.estadoSilo})` : 'el silo confirma este estado'}
                    {s.decididaPor && ` · ${s.decididaPor} ${hace(s.decididaEn)}`}
                    {s.respuesta && ` · "${s.respuesta}"`}
                    {s.errorEntrega && <span className="chip danger"> R3: {s.errorEntrega}</span>}
                  </div>
                </span>
                {!enCamino && s.estado === 'PENDIENTE' && (
                  <>
                    <button type="button" className="boton" onClick={() => void decidir(s, 'APROBADA')}>
                      Aprobar
                    </button>
                    <button type="button" className="boton" onClick={() => void decidir(s, 'RECHAZADA')}>
                      Rechazar
                    </button>
                  </>
                )}
                {!enCamino && s.estado === 'APROBADA' && (
                  <>
                    <button type="button" className="boton" title="Despues de cambiar modulos_activos del silo" onClick={() => void decidir(s, 'APLICADA')}>
                      Marcar aplicada
                    </button>
                    <button type="button" className="boton" onClick={() => void decidir(s, 'RECHAZADA')}>
                      Rechazar
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
