'use client';

import Link from 'next/link';
import { useState } from 'react';

import { enviarConSesion, hace, mensajeDe, useDatos } from '@/lib/api';

import { Dialogo } from './dialogo';

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
  /** El silo tiene centro con manifiesto aprobado: los cambios los aplica RECONFIGURAR. */
  automatica: boolean;
  /** Job activo sobre el silo (no se puede encolar otro). */
  jobActivo: number | null;
}

const CLASE: Record<SolicitudModulo['estado'], string> = { PENDIENTE: 'warn', APROBADA: 'info', RECHAZADA: 'neu', APLICADA: 'ok' };

/** APLICAR = encolar RECONFIGURAR para una solicitud ya APROBADA (no es un estado). */
type Accion = 'APROBADA' | 'RECHAZADA' | 'APLICADA' | 'APLICAR';

function textoAccion(a: Accion, automatica: boolean): { titulo: string; boton: string; clase: string; efecto: string; conTexto: boolean } {
  switch (a) {
    case 'APROBADA':
      return {
        titulo: 'Aprobar solicitud',
        boton: 'Aprobar',
        clase: 'primario',
        conTexto: true,
        efecto: automatica
          ? 'Automatico: se crea una revision nueva del manifiesto y un job RECONFIGURAR. Al terminar, la solicitud queda APLICADA en la consola y en el silo, sin tocar la BD a mano.'
          : 'Manual: este silo no tiene un centro con manifiesto aprobado en la consola. Despues de aprobar, cambia modulos_activos como dueno y luego marca la solicitud aplicada.',
      };
    case 'RECHAZADA':
      return {
        titulo: 'Rechazar solicitud',
        boton: 'Rechazar',
        clase: 'peligro',
        conTexto: true,
        efecto: 'Los modulos del centro no cambian. El ADMIN ve el rechazo y el texto en su lista y puede volver a pedirlo.',
      };
    case 'APLICADA':
      return {
        titulo: 'Marcar como aplicada',
        boton: 'Marcar aplicada',
        clase: 'primario',
        conTexto: true,
        efecto: 'Solo si modulos_activos del silo ya refleja el cambio: el silo lo verifica. Si no coincide, la solicitud vuelve a APROBADA con el motivo.',
      };
    case 'APLICAR':
      return {
        titulo: 'Aplicar con RECONFIGURAR',
        boton: 'Encolar RECONFIGURAR',
        clase: 'primario',
        conTexto: false,
        efecto:
          'Crea la revision del manifiesto con el cambio (si aun no la tiene) y encola el job RECONFIGURAR. Al terminar OK, la solicitud queda APLICADA y el agente la entrega al silo.',
      };
  }
}

/**
 * Bandeja del silo. La decision la entrega el agente al silo (R3) en su
 * siguiente ciclo (60 s). Con centro aprobado (automatica), aprobar crea una
 * revision y un job RECONFIGURAR (R4) que marca APLICADA al terminar; si la
 * aprobacion quedo sin job, "Aplicar con RECONFIGURAR" lo encola. Sin centro
 * aprobado (silo de desarrollo), el cambio se aplica a mano y se marca aplicada.
 */
export function SolicitudesModulo({ slug }: { slug: string }) {
  const { datos, error, recargar } = useDatos<SolicitudModulo[]>(`consola/solicitudes-modulo?silo=${slug}`, 30_000);
  const [msg, setMsg] = useState<string>();
  const [abierta, setAbierta] = useState<{ s: SolicitudModulo; accion: Accion }>();
  const [texto, setTexto] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [errorModal, setErrorModal] = useState<string>();

  const abrir = (s: SolicitudModulo, accion: Accion) => {
    setAbierta({ s, accion });
    setTexto('');
    setErrorModal(undefined);
  };
  const cerrar = () => setAbierta(undefined);

  const confirmar = async () => {
    if (!abierta) return;
    const { s, accion } = abierta;
    setOcupado(true);
    setErrorModal(undefined);
    const base = `consola/solicitudes-modulo/${s.siloSlug}/${s.id}`;
    const r =
      accion === 'APLICAR'
        ? await enviarConSesion(`${base}/aplicar`)
        : await enviarConSesion(`${base}/decision`, { estado: accion, ...(texto.trim() ? { respuesta: texto.trim() } : {}) });
    setOcupado(false);
    if (!r.ok) {
      setErrorModal(mensajeDe(r.datos as { mensaje?: string }, `HTTP ${r.status}`));
      return;
    }
    const reconf = (r.datos as { reconfigurar?: { motivo: string } }).reconfigurar;
    setMsg(
      accion === 'APLICAR'
        ? `${reconf?.motivo ?? 'Job encolado'}. Al terminar, el agente entrega APLICADA al silo.`
        : `Decision registrada: el agente la entrega al silo en el siguiente ciclo.${reconf ? ` ${reconf.motivo}.` : ''}`,
    );
    cerrar();
    void recargar();
  };

  const t = abierta && textoAccion(abierta.accion, abierta.s.automatica);

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
                  <span className="mono-corto"> · {s.automatica ? 'automatica (RECONFIGURAR)' : 'manual'}</span>
                  <div className="sub">
                    {enCamino ? `entregando al silo (el silo aun dice ${s.estadoSilo})` : 'el silo confirma este estado'}
                    {s.decididaPor && ` · ${s.decididaPor} ${hace(s.decididaEn)}`}
                    {s.respuesta && ` · "${s.respuesta}"`}
                    {s.errorEntrega && <span className="chip danger"> R3: {s.errorEntrega}</span>}
                  </div>
                </span>
                {!enCamino && s.estado === 'PENDIENTE' && (
                  <>
                    <button type="button" className="boton" onClick={() => abrir(s, 'APROBADA')}>
                      Aprobar
                    </button>
                    <button type="button" className="boton" onClick={() => abrir(s, 'RECHAZADA')}>
                      Rechazar
                    </button>
                  </>
                )}
                {!enCamino && s.estado === 'APROBADA' && (
                  <>
                    {s.automatica ? (
                      s.jobActivo ? (
                        <Link className="chip info nowrap" href={`/consola/jobs/${s.jobActivo}`}>
                          job #{s.jobActivo} en curso
                        </Link>
                      ) : (
                        <button type="button" className="boton primario" onClick={() => abrir(s, 'APLICAR')}>
                          Aplicar con RECONFIGURAR
                        </button>
                      )
                    ) : (
                      <button type="button" className="boton" title="Despues de cambiar modulos_activos del silo" onClick={() => abrir(s, 'APLICADA')}>
                        Marcar aplicada
                      </button>
                    )}
                    <button type="button" className="boton" onClick={() => abrir(s, 'RECHAZADA')}>
                      Rechazar
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <Dialogo
        abierto={!!abierta}
        etiqueta={`Solicitud de modulo · erp-${slug}`}
        titulo={t?.titulo ?? ''}
        ocupado={ocupado}
        onCerrar={cerrar}
        pie={
          <>
            <button type="button" className="boton" disabled={ocupado} onClick={cerrar}>
              Cancelar
            </button>
            <button type="button" className={`boton ${t?.clase ?? ''}`} disabled={ocupado} autoFocus={!t?.conTexto} onClick={() => void confirmar()}>
              {ocupado ? 'Enviando…' : t?.boton}
            </button>
          </>
        }
      >
        {abierta && t && (
          <>
            <dl className="ficha ficha-corta">
              <dt>accion</dt>
              <dd>
                {abierta.s.accion === 'ACTIVAR' ? 'activar' : 'desactivar'} <strong>{abierta.s.modulo}</strong>
              </dd>
              <dt>pedida por</dt>
              <dd>
                {abierta.s.pedidaPorRol} · {hace(abierta.s.pedidaEn)}
              </dd>
              <dt>estado actual</dt>
              <dd>
                <span className={`chip ${CLASE[abierta.s.estado]}`}>{abierta.s.estado}</span>
              </dd>
              <dt>modo</dt>
              <dd>{abierta.s.automatica ? 'automatico (RECONFIGURAR)' : 'manual'}</dd>
            </dl>
            <p className={abierta.s.automatica || abierta.accion === 'RECHAZADA' ? 'sub' : 'sub aviso-warn'}>{t.efecto}</p>
            {t.conTexto && (
              <label className="campo-consola">
                Texto para el ADMIN del centro (opcional, sin datos personales)
                <textarea
                  className="campo-texto"
                  rows={3}
                  maxLength={300}
                  value={texto}
                  disabled={ocupado}
                  autoFocus
                  onChange={(e) => setTexto(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void confirmar();
                  }}
                />
                <span className="mono-corto">Ctrl+Enter confirma · Esc cancela</span>
              </label>
            )}
            {errorModal && (
              <p className="aviso danger" role="alert">
                {errorModal}
              </p>
            )}
          </>
        )}
      </Dialogo>
    </section>
  );
}
