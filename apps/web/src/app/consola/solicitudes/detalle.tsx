'use client';

import Link from 'next/link';
import { useState } from 'react';

import { claseEstado } from '@/componentes/piezas';
import { enviarConSesion, mensajeDe, useDatos, type CentroDetalle, type EstadoCentro } from '@/lib/api';

/*
 * Panel derecho de Solicitudes (boceto: etapas, ficha corta, modulos y
 * acciones). Lo largo (manifiesto, enlace, P0) vive en la vista Manifiestos.
 */

const ETAPAS: EstadoCentro[] = ['SOLICITUD', 'CONTACTADO', 'REUNION', 'DATOS_COMPLETOS', 'APROBADO'];
const ETIQUETA_ETAPA: Partial<Record<EstadoCentro, string>> = { SOLICITUD: 'Solicitud', CONTACTADO: 'Contactado', REUNION: 'Reunion', DATOS_COMPLETOS: 'Datos', APROBADO: 'Aprobado' };
const SITIO: Record<string, string> = { nuevo: 'No tiene, quiere uno', integrar: 'Tiene, integrarlo', no_necesito: 'No necesita' };
const ORIGEN: Record<string, string> = { formulario: 'Formulario del sitio', enlace: 'Enlace compartido por el operador', conversacion: 'Conversacion', demo: 'Demo', consola: 'Consola' };
const ESTILO: Record<string, string> = { moderno: 'Moderno', cuaderno: 'Cuaderno', editorial: 'Editorial', propios: 'Tiene sus colores', aun_no_se: 'Aun no sabe (se define en la primera sesion)' };
const CON_MANIFIESTO: EstadoCentro[] = ['REUNION', 'DATOS_COMPLETOS', 'APROBADO'];

export const codigo = (id: number) => `S-${String(id).padStart(3, '0')}`;

export function DetalleSolicitud({ id, alCambiar }: { id: number; alCambiar: () => Promise<void> }) {
  const { datos: c, recargar } = useDatos<CentroDetalle>(`consola/centros/${id}`, 30_000);
  const [descartando, setDescartando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<string>();

  if (!c || c.id !== id) return <section className="panel detalle-lateral">Cargando…</section>;

  const f1 = (c.fase1 ?? {}) as Record<string, unknown>;
  const idx = ETAPAS.indexOf(c.estado);
  const mover = async (hacia: EstadoCentro, conMotivo?: string) => {
    if (ocupado) return;
    setOcupado(true);
    setMsg(undefined);
    try {
      const r = await enviarConSesion(`consola/centros/${id}/transicion`, { hacia, motivo: conMotivo });
      if (!r.ok) setMsg(mensajeDe(r.datos, `No se pudo (HTTP ${r.status})`));
      else {
        setDescartando(false);
        setMotivo('');
      }
      await Promise.all([recargar(), alCambiar()]);
    } finally {
      setOcupado(false);
    }
  };

  const nota =
    c.estado === 'SOLICITUD'
      ? 'Siguiente: escribir al contacto y marcarlo como contactado.'
      : c.estado === 'CONTACTADO'
        ? 'Siguiente: agendar la reunion.'
        : c.estado === 'REUNION'
          ? 'Siguiente: fijar el slug y enviar el enlace de fase 2 desde el manifiesto (expira en 7 dias).'
          : c.estado === 'DATOS_COMPLETOS'
            ? 'El centro completo la fase 2. Revisa el manifiesto, P0 y el contrato para aprobar.'
            : c.estado === 'APROBADO'
              ? `Aprobado: rev ${c.revisionAprobada} · sha ${c.hashAprobado?.slice(0, 12)}. Sigue el aprovisionamiento.`
              : '';

  return (
    <section className="panel detalle-lateral" aria-label={`Solicitud ${codigo(c.id)}`}>
      <div className="titulo-fila">
        <span className="mono-corto">{codigo(c.id)}</span>
        <h2 className="h2-grande">{c.nombre}</h2>
      </div>

      {c.estado === 'DESCARTADO' ? (
        <span className={`chip ${claseEstado.DESCARTADO}`}>DESCARTADO</span>
      ) : (
        <ol className="etapas" aria-label="Etapas">
          {ETAPAS.map((e, i) => (
            <li key={e} data-paso={i < idx ? 'hecho' : i === idx ? 'actual' : 'pendiente'} aria-current={i === idx ? 'step' : undefined}>
              <span className="barrita" />
              {ETIQUETA_ETAPA[e]}
            </li>
          ))}
        </ol>
      )}

      <dl className="ficha ficha-corta">
        <dt>Comuna</dt>
        <dd>{c.comuna}</dd>
        <dt>Tamano equipo</dt>
        <dd>{String(f1.tamano_equipo ?? '-')}</dd>
        <dt>Como trabajan hoy</dt>
        <dd>{String(f1.como_trabajan_hoy ?? '-')}</dd>
        <dt>Sitio web</dt>
        <dd>{SITIO[String(f1.sitio_existente)] ?? '-'}</dd>
        <dt>Estilo</dt>
        <dd>{ESTILO[String(f1.estilo_preferido)] ?? '-'}</dd>
        <dt>Contacto</dt>
        <dd>
          {c.contactoNombre} · <a href={`mailto:${c.contactoCorreo}`}>{c.contactoCorreo}</a>
          {c.contactoTelefono && ` · ${c.contactoTelefono}`}
        </dd>
        <dt>Origen</dt>
        <dd>{ORIGEN[c.origen] ?? c.origen}</dd>
        {typeof f1.comentarios === 'string' && (
          <>
            <dt>Comentarios</dt>
            <dd>{f1.comentarios}</dd>
          </>
        )}
      </dl>

      <div className="filtros">
        {((f1.modulos_interes as string[] | undefined) ?? []).map((m) => (
          <span key={m} className="chip neu">
            {m}
          </span>
        ))}
        {!((f1.modulos_interes as string[] | undefined) ?? []).length && <span className="mono-corto">sin modulos marcados</span>}
      </div>

      <div className="acciones borde-arriba">
        {c.siguiente && c.estado !== 'REUNION' && (
          <button type="button" className="boton primario" disabled={ocupado} onClick={() => void mover(c.siguiente!.hacia)}>
            {c.siguiente.accion}
          </button>
        )}
        {CON_MANIFIESTO.includes(c.estado) && (
          <Link href={`/consola/manifiestos/${c.id}`} className="boton primario">
            Abrir manifiesto
          </Link>
        )}
        {c.puedeDescartar && !descartando && (
          <button type="button" className="boton" disabled={ocupado} onClick={() => setDescartando(true)}>
            Descartar
          </button>
        )}
      </div>
      {descartando && (
        <form
          className="acciones"
          onSubmit={(e) => {
            e.preventDefault();
            void mover('DESCARTADO', motivo);
          }}
        >
          <input className="campo-texto" placeholder="Motivo (obligatorio)" maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus />
          <button type="submit" className="boton primario" disabled={ocupado || !motivo.trim()}>
            Descartar
          </button>
          <button type="button" className="boton" onClick={() => setDescartando(false)}>
            Cancelar
          </button>
        </form>
      )}
      {msg && (
        <p role="alert" className="chip danger">
          {msg}
        </p>
      )}
      {nota && <span className="mono-corto">{nota}</span>}

      <details>
        <summary className="mono-corto">Historial ({c.transiciones.length})</summary>
        <ul className="lista" style={{ marginTop: 8 }}>
          {c.transiciones.map((t) => (
            <li key={t.id} className="mono-corto">
              {new Date(t.en).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })} · {t.desde ? `${t.desde} → ` : ''}
              {t.hacia} · {t.actor}
              {t.motivo && ` · ${t.motivo}`}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
