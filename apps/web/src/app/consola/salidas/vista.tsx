'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';

import { CampoFechaHora, CampoNumero, Selector } from '@/componentes/controles';
import { Dialogo, useConfirmacion } from '@/componentes/dialogo';
import { claseJob, Shell } from '@/componentes/piezas';
import { enviarConSesion, mensajeDe, tamano, useDatos, type DetalleSalida, type ExportacionesSilo, type FilaSalida, type Resumen } from '@/lib/api';

/*
 * Salidas (CONTEXTO.md seccion 8; ERP docs/cumplimiento/baja_centro.md).
 * La consola lleva el expediente: fechas, huella y conteos del exporte, quien
 * recibe por el centro, confirmacion escrita, actas de eliminacion o de
 * reversion. Nunca el contenido del exporte ni su clave. Detener, reanudar y
 * eliminar el silo van por jobs del ejecutor (opciones B y C); sin ejecutor,
 * se hacen a mano y se confirman aqui.
 */

const fecha = (iso: string | null) => (iso ? new Date(iso).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' }) : '-');
const dia = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('es-CL', { timeZone: 'UTC' }) : '-');
const CHIP_ESTADO: Record<string, string> = { EN_SALIDA: 'warn', EXPORTADO: 'info', GRACIA: 'warn', ELIMINADO: 'neu' };
const CHIP_PASO: Record<string, string> = { hecho: 'ok', actual: 'info', pendiente: 'neu' };
const EXPEDIENTE: Record<string, { l: string; chip: string }> = {
  abierta: { l: 'abierta', chip: 'info' },
  reversion_pendiente: { l: 'reversion pendiente', chip: 'warn' },
  revertida: { l: 'revertida', chip: 'ok' },
  eliminada: { l: 'eliminada', chip: 'neu' },
};
const MEDIOS = [
  { valor: 'CORREO', etiqueta: 'correo' },
  { valor: 'DOCUMENTO', etiqueta: 'documento firmado' },
  { valor: 'OTRO', etiqueta: 'otro' },
];
const aIso = (local: string) => (local ? new Date(local).toISOString() : '');
const HUELLA = /^[0-9a-fA-F]{64}$/;
/** ISO -> YYYY-MM-DDTHH:mm en hora local (formato de CampoFechaHora). */
const aLocal = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

function Dato({ l, children }: { l: string; children: ReactNode }) {
  return (
    // Etiqueta con ancho propio: un hash de 64 caracteres no debe aplastarla (la columna "auto" de .hitos lo haria).
    <li style={{ gridTemplateColumns: 'minmax(96px, max-content) minmax(0, 1fr)' }}>
      <span className="sub">{l}</span>
      <span className="mono-corto" style={{ textAlign: 'right', overflowWrap: 'anywhere' }}>
        {children}
      </span>
    </li>
  );
}

/** Formulario en modal: el pie lleva Cancelar + la accion; el error se muestra dentro. */
function Formulario({
  abierto,
  titulo,
  etiqueta,
  boton,
  peligro,
  valido,
  onCerrar,
  onEnviar,
  children,
}: {
  abierto: boolean;
  titulo: string;
  etiqueta: string;
  boton: string;
  peligro?: boolean;
  valido: boolean;
  onCerrar: () => void;
  onEnviar: () => Promise<string | null>;
  children: ReactNode;
}) {
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<string>();
  useEffect(() => {
    if (abierto) setMsg(undefined);
  }, [abierto]);
  const enviar = async () => {
    setOcupado(true);
    try {
      const error = await onEnviar();
      if (error) setMsg(error);
      else onCerrar();
    } finally {
      setOcupado(false);
    }
  };
  return (
    <Dialogo
      abierto={abierto}
      titulo={titulo}
      etiqueta={etiqueta}
      ocupado={ocupado}
      onCerrar={onCerrar}
      pie={
        <>
          <button type="button" className="boton" disabled={ocupado} onClick={onCerrar}>
            Cancelar
          </button>
          <button type="button" className={`boton ${peligro ? 'peligro' : 'primario'}`} disabled={!valido || ocupado} onClick={() => void enviar()}>
            {boton}
          </button>
        </>
      }
    >
      {children}
      {msg && (
        <p role="alert" className="chip danger" style={{ whiteSpace: 'normal' }}>
          {msg}
        </p>
      )}
    </Dialogo>
  );
}

const enviarPaso = async (ruta: string, cuerpo?: unknown) => {
  const r = await enviarConSesion<DetalleSalida>(ruta, cuerpo);
  return r.ok ? null : mensajeDe(r.datos, `HTTP ${r.status}`);
};

type PropsModal = { s: DetalleSalida; abierto: boolean; onCerrar: () => void; alCambiar: () => Promise<void> };

function ActaRecepcion({ s, abierto, onCerrar, alCambiar }: PropsModal) {
  const [exporteEn, setExporteEn] = useState('');
  const [bytes, setBytes] = useState<number>();
  const [huellaExporte, setHuellaExporte] = useState('');
  const [firmadaEn, setFirmadaEn] = useState('');
  const [nombre, setNombre] = useState('');
  const [cargo, setCargo] = useState('');
  const [pacientes, setPacientes] = useState<number>();
  const [fichas, setFichas] = useState<number>();
  const [huellaActa, setHuellaActa] = useState('');
  const [gracia, setGracia] = useState<number | undefined>(30);
  // R13: exportes terminados que informa el silo; elegir uno llena fecha, tamano y huella.
  const { datos: informados } = useDatos<ExportacionesSilo>(`consola/silos/${s.siloSlug}/exportaciones`, 60_000);
  const terminados = (informados?.exportaciones ?? []).filter((x) => x.huella && x.bytes && ['LISTA', 'DESCARGADA', 'VENCIDA'].includes(x.estado));
  const [elegido, setElegido] = useState('');
  const elegir = (id: string) => {
    setElegido(id);
    const x = terminados.find((t) => t.id === id);
    if (!x) return;
    setExporteEn(aLocal(x.terminadaEn ?? x.creadaEn));
    setBytes(x.bytes ?? undefined);
    setHuellaExporte(x.huella ?? '');
  };
  const coinciden = HUELLA.test(huellaExporte.trim()) && huellaExporte.trim().toLowerCase() === huellaActa.trim().toLowerCase();
  const valido = !!exporteEn && !!bytes && !!firmadaEn && nombre.trim().length >= 2 && cargo.trim().length >= 2 && pacientes !== undefined && fichas !== undefined && coinciden && !!gracia;

  return (
    <Formulario
      abierto={abierto}
      titulo="Registrar acta de recepcion"
      etiqueta={`S3-S5 · erp-${s.siloSlug}`}
      boton="Registrar acta"
      valido={valido}
      onCerrar={onCerrar}
      onEnviar={async () => {
        const e = await enviarPaso(`consola/salidas/${s.id}/acta-recepcion`, {
          exporteEn: aIso(exporteEn),
          exporteBytes: bytes,
          exporteHuella: huellaExporte.trim(),
          firmadaEn: aIso(firmadaEn),
          recibeNombre: nombre.trim(),
          recibeCargo: cargo.trim(),
          conteoPacientes: pacientes,
          conteoFichas: fichas,
          huellaActa: huellaActa.trim(),
          graciaDias: gracia,
        });
        if (!e) await alCambiar();
        return e;
      }}
    >
      <p className="sub">
        El ADMIN genera el exporte en su silo (Configuracion &gt; Exportar datos) y entrega fecha, tamano y huella de registro_exportaciones. El centro lo descifra con descifrar.mjs, revisa los
        conteos y firma el acta. La consola nunca ve el archivo ni su clave.
      </p>
      {terminados.length > 0 ? (
        <label className="campo-consola">
          Exporte informado por el silo (R13)
          <Selector
            valor={elegido}
            opciones={[{ valor: '', etiqueta: 'Elegir para llenar fecha, tamano y huella' }, ...terminados.map((x) => ({ valor: x.id, etiqueta: `${new Date(x.terminadaEn ?? x.creadaEn).toLocaleString('es-CL')} · ${tamano(x.bytes ?? 0)} · ${x.huella!.slice(0, 12)} · ${x.estado.toLowerCase()}` }))]}
            onCambio={elegir}
            etiqueta="Exporte informado por el silo"
          />
        </label>
      ) : (
        <p className="mono-corto">{informados?.vistoEn ? 'El silo no informa exportes terminados todavia.' : 'El silo no informa sus exportaciones (ERP anterior a R13): copia los datos que entrega el ADMIN.'}</p>
      )}
      <div className="rejilla-campos">
        <label className="campo-consola">
          Exporte generado
          <CampoFechaHora requerido valor={exporteEn} onCambio={setExporteEn} />
        </label>
        <label className="campo-consola">
          Tamano (bytes)
          <CampoNumero requerido min={1} valor={bytes} onCambio={setBytes} />
        </label>
      </div>
      <label className="campo-consola">
        Huella SHA-256 del exporte (registro_exportaciones)
        <input className="campo-texto" spellCheck={false} maxLength={80} value={huellaExporte} onChange={(e) => setHuellaExporte(e.target.value)} />
      </label>
      <div className="rejilla-campos">
        <label className="campo-consola">
          Acta firmada
          <CampoFechaHora requerido valor={firmadaEn} onCambio={setFirmadaEn} />
        </label>
        <label className="campo-consola">
          Gracia (dias, segun contrato)
          <CampoNumero requerido min={1} max={365} valor={gracia} onCambio={setGracia} />
        </label>
      </div>
      <div className="rejilla-campos">
        <label className="campo-consola">
          Recibe (direccion del centro)
          <input className="campo-texto" maxLength={120} value={nombre} onChange={(e) => setNombre(e.target.value)} />
        </label>
        <label className="campo-consola">
          Cargo
          <input className="campo-texto" maxLength={120} value={cargo} onChange={(e) => setCargo(e.target.value)} />
        </label>
      </div>
      <div className="rejilla-campos">
        <label className="campo-consola">
          Pacientes (indice.json)
          <CampoNumero requerido min={0} valor={pacientes} onCambio={setPacientes} />
        </label>
        <label className="campo-consola">
          Fichas (indice.json)
          <CampoNumero requerido min={0} valor={fichas} onCambio={setFichas} />
        </label>
      </div>
      <label className="campo-consola">
        Huella que firmo el centro en el acta
        <input className="campo-texto" spellCheck={false} maxLength={80} value={huellaActa} onChange={(e) => setHuellaActa(e.target.value)} />
        {huellaActa.trim() && !coinciden && <span className="mono-corto t-danger">No coincide con la huella del exporte</span>}
      </label>
    </Formulario>
  );
}

/** Fecha + medio + referencia de un escrito del centro (confirmacion de borrado o solicitud de reversion). */
function CamposEscrito({ en, setEn, medio, setMedio, ref, setRef }: { en: string; setEn: (v: string) => void; medio: string; setMedio: (v: string) => void; ref: string; setRef: (v: string) => void }) {
  return (
    <>
      <div className="rejilla-campos">
        <label className="campo-consola">
          Fecha
          <CampoFechaHora requerido valor={en} onCambio={setEn} />
        </label>
        <label className="campo-consola">
          Medio
          <Selector valor={medio} onCambio={setMedio} opciones={MEDIOS} />
        </label>
      </div>
      <label className="campo-consola">
        Referencia (asunto del correo, numero de documento; sin datos personales)
        <input className="campo-texto" maxLength={300} value={ref} onChange={(e) => setRef(e.target.value)} />
      </label>
    </>
  );
}

function ConfirmacionEscrita({ s, abierto, onCerrar, alCambiar }: PropsModal) {
  const [en, setEn] = useState('');
  const [medio, setMedio] = useState('CORREO');
  const [ref, setRef] = useState('');
  return (
    <Formulario
      abierto={abierto}
      titulo="Confirmacion escrita antes de borrar"
      etiqueta={`S6 · erp-${s.siloSlug}`}
      boton="Registrar confirmacion"
      valido={!!en && ref.trim().length >= 2}
      onCerrar={onCerrar}
      onEnviar={async () => {
        const e = await enviarPaso(`consola/salidas/${s.id}/confirmacion`, { en: aIso(en), medio, referencia: ref.trim() });
        if (!e) await alCambiar();
        return e;
      }}
    >
      <p className="sub">La direccion del centro confirma por escrito que se puede eliminar.</p>
      <CamposEscrito en={en} setEn={setEn} medio={medio} setMedio={setMedio} ref={ref} setRef={setRef} />
    </Formulario>
  );
}

function Revertir({ s, abierto, onCerrar, alCambiar }: PropsModal) {
  const [en, setEn] = useState('');
  const [medio, setMedio] = useState('CORREO');
  const [ref, setRef] = useState('');
  const [motivo, setMotivo] = useState('');
  const [slug, setSlug] = useState('');
  const conJob = !!s.siloDetenidoEn;
  return (
    <Formulario
      abierto={abierto}
      titulo="Revertir la salida"
      etiqueta={`Reversion · erp-${s.siloSlug}`}
      boton="Revertir"
      valido={!!en && ref.trim().length >= 2 && motivo.trim().length >= 4 && slug.trim() === s.siloSlug}
      onCerrar={onCerrar}
      onEnviar={async () => {
        const e = await enviarPaso(`consola/salidas/${s.id}/revertir`, { solicitudEn: aIso(en), medio, referencia: ref.trim(), motivo: motivo.trim(), confirmacion: slug.trim() });
        if (!e) await alCambiar();
        return e;
      }}
    >
      <p className="sub">
        Baja por error o arrepentimiento, con la solicitud escrita del centro. {s.nombre} vuelve a {s.desde}.{' '}
        {conJob ? 'El silo esta detenido: se encola REANUDAR_SILO y la salida se cierra cuando el silo quede en marcha.' : 'El silo sigue en marcha: se revierte en el acto.'} El exporte ya
        entregado es del centro. Queda un acta de reversion y su copia por correo.
      </p>
      <CamposEscrito en={en} setEn={setEn} medio={medio} setMedio={setMedio} ref={ref} setRef={setRef} />
      <label className="campo-consola">
        Motivo
        <input className="campo-texto" maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
      </label>
      <label className="campo-consola">
        Escribe {s.siloSlug} para confirmar
        <input className="campo-texto" spellCheck={false} maxLength={40} value={slug} onChange={(e) => setSlug(e.target.value)} />
      </label>
    </Formulario>
  );
}

function EliminarSilo({ s, abierto, onCerrar, alCambiar }: PropsModal) {
  const [slug, setSlug] = useState('');
  const comando = `echo ${s.actaRecepcionHash} > bajas/${s.siloSlug}`;
  return (
    <Formulario
      abierto={abierto}
      titulo="Eliminar el silo (ejecutor)"
      etiqueta={`S7 · erp-${s.siloSlug}`}
      boton="Encolar ELIMINAR"
      peligro
      valido={slug.trim() === s.siloSlug}
      onCerrar={onCerrar}
      onEnviar={async () => {
        const e = await enviarPaso(`consola/salidas/${s.id}/eliminar-silo`, { confirmacion: slug.trim() });
        if (!e) await alCambiar();
        return e;
      }}
    >
      <p className="sub">
        El ejecutor borra contenedores, volumenes (db_data, exportaciones), redes y respaldos/{s.siloSlug}/ del host B. No se puede deshacer. Solo corre si en el host B existe el consentimiento local
        con el hash del acta de recepcion de esta salida (en infra/host-b/, junto al compose):
      </p>
      <pre className="codigo" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
        {comando}
      </pre>
      <p className="sub">Quedan a mano: shred de infra/secrets/{s.siloSlug}/, bucket externo, DNS y tunel, crontab y borrar el archivo de consentimiento.</p>
      <label className="campo-consola">
        Escribe {s.siloSlug} para confirmar
        <input className="campo-texto" spellCheck={false} maxLength={40} value={slug} onChange={(e) => setSlug(e.target.value)} />
      </label>
    </Formulario>
  );
}

function ActaEliminacion({ s, abierto, onCerrar, alCambiar }: PropsModal) {
  const [marcas, setMarcas] = useState<Record<string, boolean>>({});
  const [nota, setNota] = useState('');
  const [slug, setSlug] = useState('');
  const marcado = (k: string) => s.porJob.includes(k) || !!marcas[k];
  const completo = s.checklist.every((i) => marcado(i.clave));
  return (
    <Formulario
      abierto={abierto}
      titulo="Acta de eliminacion"
      etiqueta={`S7 · erp-${s.siloSlug}`}
      boton="Registrar eliminacion"
      peligro
      valido={completo && slug.trim() === s.siloSlug}
      onCerrar={onCerrar}
      onEnviar={async () => {
        const checklist = Object.fromEntries(s.checklist.map((i) => [i.clave, marcado(i.clave)]));
        const e = await enviarPaso(`consola/salidas/${s.id}/acta-eliminacion`, { checklist, nota: nota.trim() || undefined, confirmacion: slug.trim() });
        if (!e) await alCambiar();
        return e;
      }}
    >
      <p className="sub">
        {s.porJob.length ? `Los pasos que probo el job ELIMINAR #${s.eliminacionJobId} ya vienen marcados. ` : ''}Marca el resto despues de hacerlo en el host B (baja_centro.md, seccion 2). El centro
        queda ELIMINADO y se envia la copia del acta.
      </p>
      <div className="switches" style={{ gridTemplateColumns: '1fr' }}>
        {s.checklist.map((i) => {
          const porJob = s.porJob.includes(i.clave);
          return (
            <button
              key={i.clave}
              type="button"
              role="switch"
              aria-checked={marcado(i.clave)}
              className="switch"
              disabled={porJob}
              onClick={() => setMarcas((m) => ({ ...m, [i.clave]: !m[i.clave] }))}
            >
              <span className="perilla" aria-hidden="true" />
              {i.l.replace('<slug>', s.siloSlug)}
              {porJob && <span className="mono-corto">job #{s.eliminacionJobId}</span>}
            </button>
          );
        })}
      </div>
      <label className="campo-consola">
        Nota (opcional, sin datos personales)
        <input className="campo-texto" maxLength={1000} value={nota} onChange={(e) => setNota(e.target.value)} />
      </label>
      <label className="campo-consola">
        Escribe {s.siloSlug} para confirmar
        <input className="campo-texto" spellCheck={false} maxLength={40} value={slug} onChange={(e) => setSlug(e.target.value)} />
      </label>
    </Formulario>
  );
}

function Envios({ s, tipo, onReenviar }: { s: DetalleSalida; tipo: 'eliminacion' | 'reversion'; onReenviar: () => void }) {
  const lista = s.envios.filter((v) => v.tipo === tipo);
  return (
    <div className="borde-arriba" style={{ paddingTop: 8 }}>
      <div className="titulo-fila">
        <span className="sub">Copia al centro</span>
        <button type="button" className="boton" style={{ marginLeft: 'auto' }} onClick={onReenviar}>
          Reenviar acta
        </button>
      </div>
      {lista.length === 0 ? (
        <p className="mono-corto t-warn">Sin envios registrados.</p>
      ) : (
        <ul className="lista">
          {lista.map((v) => (
            <li key={v.en} className="mono-corto">
              <span className={`chip ${v.ok ? 'ok' : 'danger'}`}>{v.ok ? 'enviada' : 'fallo'}</span> {fecha(v.en)} · {v.para}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type Modal = 'acta' | 'confirmacion' | 'eliminar-silo' | 'eliminacion' | 'revertir';

function DetalleSalidaVista({ id, alCambiar }: { id: number; alCambiar: () => Promise<void> }) {
  const { datos: s, recargar } = useDatos<DetalleSalida>(`consola/salidas/${id}`, 15_000);
  const [modal, setModal] = useState<Modal>();
  const [msg, setMsg] = useState<string>();
  const [confirmar, dialogo] = useConfirmacion();
  if (!s || s.id !== id) return <section className="panel detalle-lateral">Cargando…</section>;
  const cambio = async () => {
    await Promise.all([recargar(), alCambiar()]);
  };
  const accion = async (ruta: string, cuerpo?: unknown) => {
    setMsg((await enviarPaso(`consola/salidas/${s.id}/${ruta}`, cuerpo)) ?? undefined);
    await cambio();
  };
  const detener = async () => {
    const ok = await confirmar({
      etiqueta: `S6 · erp-${s.siloSlug}`,
      titulo: 'Detener el silo',
      texto: `Encola DETENER_SILO: el ejecutor para frontend, backend y db sin borrar nada (se puede reanudar si el centro se arrepiente). Al terminar, el centro pasa a GRACIA hasta ${dia(s.graciaHasta)} y el silo sale del monitoreo.`,
      boton: 'Detener',
    });
    if (ok !== null) await accion('detener');
  };
  const aMano = async (ruta: 'silo-detenido' | 'reanudado', titulo: string, texto: string) => {
    if ((await confirmar({ etiqueta: `erp-${s.siloSlug}`, titulo, texto, boton: 'Confirmar' })) !== null) await accion(ruta);
  };
  const reenviar = async (tipo: 'eliminacion' | 'reversion') => {
    const r = await enviarConSesion<{ enviada: boolean; para: string }>(`consola/salidas/${s.id}/enviar-acta`, { tipo });
    setMsg(!r.ok ? mensajeDe(r.datos, `HTTP ${r.status}`) : r.datos.enviada ? undefined : `No se pudo enviar a ${r.datos.para}. Revisa el correo de la consola (Configuracion).`);
    await recargar();
  };
  const abierta = s.expediente === 'abierta';
  const jobActivo = s.jobs.find((j) => j.estado === 'PENDIENTE' || j.estado === 'EN_CURSO');

  return (
    <section className="panel detalle-lateral" aria-label={`Salida de ${s.nombre}`}>
      <div className="titulo-fila">
        <span className={`chip ${CHIP_ESTADO[s.estado] ?? 'neu'}`}>{s.estado}</span>
        <h2 className="h2-grande">{s.nombre}</h2>
        <span className={`chip ${EXPEDIENTE[s.expediente].chip}`} style={{ marginLeft: 'auto' }}>
          {EXPEDIENTE[s.expediente].l}
        </span>
      </div>
      <span className="mono-corto">
        #{s.id} · erp-{s.siloSlug} · corte {dia(s.fechaCorte)} · iniciada {fecha(s.iniciadaEn)} por {s.iniciadaPor} · desde {s.desde}
      </span>
      <span className="sub">Motivo: {s.motivo}</span>

      {s.expediente !== 'revertida' && (
        <ul className="hitos">
          {s.pasos.map((p) => (
            <li key={p.codigo}>
              <span>
                <span className="mono-corto">{p.codigo}</span> {p.l}
              </span>
              <span className={`chip ${CHIP_PASO[p.estado]}`}>{p.estado}</span>
            </li>
          ))}
        </ul>
      )}

      {jobActivo && (
        <p className="mono-corto">
          <Link href={`/consola/jobs/${jobActivo.id}`}>
            job #{jobActivo.id} {jobActivo.tipo.toLowerCase()}
          </Link>{' '}
          <span className={`chip ${claseJob[jobActivo.estado]}`}>{jobActivo.estado}</span> · lo corre el agente del host B
        </p>
      )}

      {abierta && (
        <div className="acciones borde-arriba" style={{ paddingTop: 8 }}>
          {s.estado === 'EN_SALIDA' && (
            <button type="button" className="boton primario" onClick={() => setModal('acta')}>
              Registrar acta de recepcion
            </button>
          )}
          {s.estado === 'EXPORTADO' && (
            <>
              <button type="button" className="boton primario" disabled={!!jobActivo} onClick={() => void detener()}>
                Detener silo
              </button>
              <button
                type="button"
                className="boton"
                disabled={!!jobActivo}
                onClick={() => void aMano('silo-detenido', 'Silo detenido a mano', 'Sin ejecutor: confirma que corriste docker compose down del silo (sin borrar volumenes). Si el agente aun ve contenedores en marcha, se rechaza.')}
              >
                Ya lo detuve a mano
              </button>
            </>
          )}
          {(s.estado === 'EXPORTADO' || s.estado === 'GRACIA') && !s.confirmacionEn && (
            <button type="button" className="boton" onClick={() => setModal('confirmacion')}>
              Registrar confirmacion escrita
            </button>
          )}
          {s.estado === 'GRACIA' && !s.eliminacionJobId && (
            <button
              type="button"
              className="boton peligro"
              disabled={s.bloqueosEliminar.length > 0 || !!jobActivo}
              title={s.bloqueosEliminar.join('. ') || undefined}
              onClick={() => setModal('eliminar-silo')}
            >
              Eliminar silo
            </button>
          )}
          {s.estado === 'GRACIA' && (
            <button
              type="button"
              className={`boton ${s.eliminacionJobId ? 'peligro' : ''}`}
              disabled={s.bloqueosEliminar.length > 0 || !!jobActivo}
              title={s.eliminacionJobId ? undefined : 'Sin ejecutor: registrar el acta tras borrar a mano'}
              onClick={() => setModal('eliminacion')}
            >
              Registrar acta de eliminacion
            </button>
          )}
          {s.puedeRevertir && (
            <button type="button" className="boton" style={{ marginLeft: 'auto' }} disabled={!!jobActivo} onClick={() => setModal('revertir')}>
              Revertir salida
            </button>
          )}
        </div>
      )}
      {s.expediente === 'reversion_pendiente' && (
        <div className="borde-arriba" style={{ paddingTop: 8 }}>
          <p className="sub">
            Reversion pedida {fecha(s.reversionPedidaEn)} por {s.reversionPedidaPor}: el silo se esta reanudando{s.reversionJobId ? ` (job #${s.reversionJobId})` : ''}. Si el job falla, reintentalo en
            Aprovisionamiento o levanta el silo a mano y confirma.
          </p>
          <button
            type="button"
            className="boton"
            disabled={!!jobActivo}
            onClick={() => void aMano('reanudado', 'Silo levantado a mano', 'Confirma que el silo esta en marcha (el agente debe verlo en los ultimos 5 min). La salida se cierra como revertida.')}
          >
            Ya lo levante a mano
          </button>
        </div>
      )}
      {abierta && s.estado === 'GRACIA' && s.bloqueosEliminar.length > 0 && (
        <ul className="lista">
          {s.bloqueosEliminar.map((b) => (
            <li key={b} className="mono-corto">
              {b}
            </li>
          ))}
        </ul>
      )}
      {msg && (
        <p role="alert" className="chip danger" style={{ whiteSpace: 'normal' }}>
          {msg}
        </p>
      )}

      {s.actaReversion && (
        <div className="borde-arriba">
          <h2>Acta de reversion</h2>
          <p className="sub">{s.actaReversion.texto}.</p>
          <ul className="hitos">
            <Dato l="Revertida">{fecha(s.revertidaEn)}</Dato>
            <Dato l="Solicitud">
              {fecha(s.reversionSolicitudEn)} · {s.reversionMedio?.toLowerCase()} · {s.reversionRef}
            </Dato>
            <Dato l="Motivo">{s.reversionMotivo}</Dato>
            <Dato l="Silo">{s.actaReversion.siloReanudado}</Dato>
            <Dato l="Hash del acta">{s.actaReversionHash}</Dato>
          </ul>
          <Envios s={s} tipo="reversion" onReenviar={() => void reenviar('reversion')} />
        </div>
      )}

      {s.actaRecepcionHash && (
        <div className="borde-arriba">
          <h2>Acta de recepcion</h2>
          <ul className="hitos">
            <Dato l="Exporte">
              {fecha(s.exporteEn)} · {s.exporteBytes ? tamano(s.exporteBytes) : '-'}
            </Dato>
            <Dato l="Huella del exporte">{s.exporteHuella}</Dato>
            <Dato l="Firmada">
              {fecha(s.actaRecepcionFirmadaEn)} · {s.recibeNombre} ({s.recibeCargo})
            </Dato>
            <Dato l="Conteos">
              {s.conteoPacientes} pacientes · {s.conteoFichas} fichas
            </Dato>
            <Dato l="Gracia">
              {s.graciaDias} dias, hasta {fecha(s.graciaHasta)}
              {abierta && s.diasGracia !== null && ` (quedan ${s.diasGracia})`}
            </Dato>
            <Dato l="Hash del acta">{s.actaRecepcionHash}</Dato>
            {s.siloDetenidoEn && (
              <Dato l="Silo detenido">
                {fecha(s.siloDetenidoEn)} · {s.detencionJobId ? `job #${s.detencionJobId}` : s.siloDetenidoPor}
              </Dato>
            )}
            {s.confirmacionEn && (
              <Dato l="Confirmacion escrita">
                {fecha(s.confirmacionEn)} · {s.confirmacionMedio?.toLowerCase()} · {s.confirmacionRef}
              </Dato>
            )}
            {s.eliminacionJobId && <Dato l="Silo eliminado">job #{s.eliminacionJobId} (ejecutor)</Dato>}
          </ul>
          {s.evidenciaEliminacion.length > 0 && (
            <details>
              <summary className="mono-corto">Evidencia del ejecutor ({s.evidenciaEliminacion.length} lineas)</summary>
              <ul className="lista" style={{ marginTop: 6 }}>
                {s.evidenciaEliminacion.map((l) => (
                  <li key={l} className="mono-corto" style={{ display: 'block' }}>
                    {l}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {s.actaEliminacion && (
        <div className="borde-arriba">
          <h2>Acta de eliminacion</h2>
          <p className="sub">{s.actaEliminacion.texto}.</p>
          <ul className="hitos">
            <Dato l="Registrada">
              {fecha(s.eliminadoEn)} · {s.eliminadoPor}
            </Dato>
            {s.actaEliminacion.nota && <Dato l="Nota">{s.actaEliminacion.nota}</Dato>}
            <Dato l="Hash del acta">{s.actaEliminacionHash}</Dato>
          </ul>
          <ul className="lista" style={{ marginTop: 6 }}>
            {s.checklist.map((i) => {
              const por = s.actaEliminacion?.items[i.clave];
              return (
                <li key={i.clave} className="mono-corto">
                  ✓ {i.l.replace('<slug>', s.siloSlug)}
                  {typeof por === 'string' && ` · ${por}`}
                </li>
              );
            })}
          </ul>
          <Envios s={s} tipo="eliminacion" onReenviar={() => void reenviar('eliminacion')} />
        </div>
      )}

      {s.jobs.length > 0 && (
        <details>
          <summary className="mono-corto">Jobs de esta salida ({s.jobs.length})</summary>
          <ul className="lista" style={{ marginTop: 6 }}>
            {s.jobs.map((j) => (
              <li key={j.id} className="mono-corto">
                <Link href={`/consola/jobs/${j.id}`}>#{j.id}</Link> {j.tipo.toLowerCase()} <span className={`chip ${claseJob[j.estado]}`}>{j.estado}</span> · {fecha(j.creadoEn)}
                {j.error && ` · ${j.error}`}
              </li>
            ))}
          </ul>
        </details>
      )}

      <ActaRecepcion s={s} abierto={modal === 'acta'} onCerrar={() => setModal(undefined)} alCambiar={cambio} />
      <ConfirmacionEscrita s={s} abierto={modal === 'confirmacion'} onCerrar={() => setModal(undefined)} alCambiar={cambio} />
      <EliminarSilo s={s} abierto={modal === 'eliminar-silo'} onCerrar={() => setModal(undefined)} alCambiar={cambio} />
      <ActaEliminacion s={s} abierto={modal === 'eliminacion'} onCerrar={() => setModal(undefined)} alCambiar={cambio} />
      <Revertir s={s} abierto={modal === 'revertir'} onCerrar={() => setModal(undefined)} alCambiar={cambio} />
      {dialogo}
    </section>
  );
}

export function VistaSalidas({ inicial, centro }: { inicial?: number; centro?: number }) {
  const [sel, setSel] = useState<number | undefined>(inicial);
  const { datos: r, recargar: recargarResumen } = useDatos<Resumen>('consola/resumen', 30_000);
  const { datos: lista, error, recargar } = useDatos<FilaSalida[]>('consola/salidas', 30_000);

  useEffect(() => {
    if (!lista?.length || sel !== undefined) return;
    // ?centro=<id> (desde el silo): la salida mas reciente de ese centro.
    setSel((centro ? lista.find((s) => s.centroId === centro) : undefined)?.id ?? lista[0].id);
  }, [lista, sel, centro]);
  useEffect(() => {
    if (sel !== undefined) window.history.replaceState(null, '', `/consola/salidas?salida=${sel}`);
  }, [sel]);

  return (
    <Shell resumen={r} titulo="salidas">
      <div className="cabecera-vista">
        <div>
          <h1>Salidas</h1>
          <span className="sub">
            Exporte, gracia, eliminacion o reversion, con actas. Solo metadatos: nunca el contenido del exporte ni su clave{error && ` · error: ${error}`}
          </span>
        </div>
      </div>
      <div className="maestro-detalle">
        <section className="panel maestro">
          {!lista ? (
            <p className="vacio">Cargando…</p>
          ) : lista.length === 0 ? (
            <p className="vacio">
              Sin salidas. Una salida se inicia desde el detalle de un silo activo (<Link href="/consola/silos">Silos</Link>).
            </p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Centro</th>
                  <th>Silo</th>
                  <th>Estado</th>
                  <th>Corte</th>
                  <th>Gracia</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((s) => (
                  <tr key={s.id} className="fila-clic" aria-selected={sel === s.id} onClick={() => setSel(s.id)}>
                    <td>{s.nombre}</td>
                    <td className="mono-corto">{s.siloSlug}</td>
                    <td>
                      {s.expediente === 'revertida' ? (
                        <span className="chip ok">REVERTIDA</span>
                      ) : (
                        <span className={`chip ${CHIP_ESTADO[s.estado] ?? 'neu'}`}>{s.estado}</span>
                      )}
                    </td>
                    <td className="nowrap">{dia(s.fechaCorte)}</td>
                    <td className={`nowrap ${s.diasGracia === 0 ? 'semaforo-vencido' : s.diasGracia !== null && s.diasGracia <= 5 ? 'semaforo-por_vencer' : ''}`}>
                      {s.expediente === 'revertida'
                        ? '-'
                        : s.expediente === 'eliminada'
                          ? 'eliminado'
                          : s.expediente === 'reversion_pendiente'
                            ? 'revirtiendo'
                            : s.diasGracia === null
                              ? '-'
                              : s.diasGracia === 0
                                ? 'vencida'
                                : `${s.diasGracia} d`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        {sel !== undefined && (
          <DetalleSalidaVista
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
