'use client';

import { useEffect, useState } from 'react';

import { CampoFechaHora, CampoNumero, Selector } from '@/componentes/controles';
import { claseSeveridad, Shell } from '@/componentes/piezas';
import { enviarConSesion, hace, mensajeDe, useDatos, type Incidente, type Resumen, type SolicitudSoporte } from '@/lib/api';

/*
 * Incidentes y soporte (CONTEXTO.md 8b). Se registran fuera del silo y sin
 * datos personales: el texto describe el hecho tecnico, nunca a pacientes ni
 * al equipo del centro. Plazos S1/S2/S3 con semaforo.
 */

const fecha = (iso: string | null) => (iso ? new Date(iso).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' }) : '-');
const CHIP_HITO: Record<string, string> = { cumplido: 'ok', cumplido_tarde: 'warn', pendiente: 'neu', por_vencer: 'warn', vencido: 'danger', no_aplica: 'neu' };
const TEXTO_HITO: Record<string, string> = { cumplido: 'cumplido', cumplido_tarde: 'tarde', pendiente: 'pendiente', por_vencer: 'por vencer', vencido: 'vencido', no_aplica: 'no aplica' };
const ACCIONES: { tipo: string; l: string; cuando: (i: Incidente) => boolean }[] = [
  { tipo: 'contencion', l: 'Registrar contencion', cuando: (i) => !i.contenidoEn },
  { tipo: 'aviso_centro', l: 'Registrar aviso al centro', cuando: (i) => !i.avisoCentroEn },
  { tipo: 'actualizacion', l: 'Registrar actualizacion', cuando: (i) => !!i.avisoCentroEn && !i.informeFinalEn },
  { tipo: 'informe_final', l: 'Registrar informe final', cuando: (i) => !!i.contenidoEn && !i.informeFinalEn },
  { tipo: 'cierre', l: 'Cerrar', cuando: (i) => !!i.informeFinalEn },
  { tipo: 'nota', l: 'Nota', cuando: () => true },
];

function DetalleIncidente({ id, alCambiar }: { id: number; alCambiar: () => Promise<void> }) {
  const { datos: i, recargar } = useDatos<Incidente>(`consola/incidentes/${id}`, 30_000);
  const [tipo, setTipo] = useState('');
  const [texto, setTexto] = useState('');
  const [msg, setMsg] = useState<string>();
  const [ocupado, setOcupado] = useState(false);
  if (!i || i.id !== id) return <section className="panel detalle-lateral">Cargando…</section>;

  const registrar = async () => {
    if (ocupado) return;
    setOcupado(true);
    setMsg(undefined);
    try {
      const r = await enviarConSesion(`consola/incidentes/${id}/eventos`, { tipo, texto });
      if (!r.ok) setMsg(mensajeDe(r.datos, `HTTP ${r.status}`));
      else {
        setTipo('');
        setTexto('');
      }
      await Promise.all([recargar(), alCambiar()]);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <section className="panel detalle-lateral" aria-label={`Incidente ${i.id}`}>
      <div className="titulo-fila">
        <span className={`chip ${claseSeveridad[i.severidad]}`}>{i.severidad}</span>
        <h2 className="h2-grande">{i.titulo}</h2>
      </div>
      <span className="mono-corto">
        #{i.id} · {i.siloSlug ?? 'plataforma'} · detectado {fecha(i.detectadoEn)} · {i.creadoPor}
        {i.cerradoEn && ` · cerrado ${fecha(i.cerradoEn)}`}
      </span>
      <ul className="hitos">
        {i.hitos.map((h) => (
          <li key={h.clave}>
            <span>
              {h.l}
              <span className="mono-corto"> · {h.cumplidoEn ? `hecho ${fecha(h.cumplidoEn)}` : h.venceEn ? `vence ${fecha(h.venceEn)}` : 'en el informe mensual'}</span>
            </span>
            <span className={`chip ${CHIP_HITO[h.estado]}`}>{TEXTO_HITO[h.estado]}</span>
          </li>
        ))}
      </ul>
      {!i.cerradoEn && (
        <div className="borde-arriba">
          <div className="filtros">
            {ACCIONES.filter((a) => a.cuando(i)).map((a) => (
              <button key={a.tipo} type="button" className="boton" aria-pressed={tipo === a.tipo} onClick={() => setTipo(a.tipo)}>
                {a.l}
              </button>
            ))}
          </div>
          {tipo && (
            <form
              className="acciones"
              style={{ marginTop: 8 }}
              onSubmit={(e) => {
                e.preventDefault();
                void registrar();
              }}
            >
              <input className="campo-texto" maxLength={2000} placeholder="Que se hizo (sin datos de pacientes ni del equipo)" value={texto} onChange={(e) => setTexto(e.target.value)} autoFocus />
              <button type="submit" className="boton primario" disabled={ocupado || texto.trim().length < 2}>
                Guardar
              </button>
            </form>
          )}
          {msg && (
            <p role="alert" className="chip danger">
              {msg}
            </p>
          )}
        </div>
      )}
      <details>
        <summary className="mono-corto">Bitacora ({i.eventos?.length ?? 0})</summary>
        <ul className="lista" style={{ marginTop: 8 }}>
          {i.eventos?.map((e) => (
            <li key={e.id} className="mono-corto" style={{ display: 'block' }}>
              {fecha(e.en)} · {e.tipo} · {e.actor}: {e.texto}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

function NuevoIncidente({ alCrear }: { alCrear: (id: number) => void }) {
  const [abierto, setAbierto] = useState(false);
  const [sev, setSev] = useState('S2');
  const [titulo, setTitulo] = useState('');
  const [silo, setSilo] = useState('');
  const [msg, setMsg] = useState<string>();
  if (!abierto)
    return (
      <button type="button" className="boton primario" onClick={() => setAbierto(true)}>
        Abrir incidente
      </button>
    );
  return (
    <form
      className="panel form-fila"
      style={{ flex: '1 1 100%' }}
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await enviarConSesion<Incidente>('consola/incidentes', { severidad: sev, titulo, siloSlug: silo || undefined });
        if (!r.ok) return setMsg(mensajeDe(r.datos, `HTTP ${r.status}`));
        setAbierto(false);
        setTitulo('');
        alCrear(r.datos.id);
      }}
    >
      <label className="campo-consola" style={{ flex: '0 1 90px' }}>
        Severidad
        <Selector valor={sev} onCambio={setSev} opciones={['S1', 'S2', 'S3'].map((s) => ({ valor: s, etiqueta: s }))} />
      </label>
      <label className="campo-consola" style={{ flex: '3 1 300px' }}>
        Que paso (hecho tecnico)
        <input className="campo-texto" required minLength={4} maxLength={200} value={titulo} onChange={(e) => setTitulo(e.target.value)} />
      </label>
      <label className="campo-consola">
        Silo (vacio = plataforma)
        <input className="campo-texto" maxLength={40} placeholder="slug" value={silo} onChange={(e) => setSilo(e.target.value.toLowerCase())} />
      </label>
      <button type="submit" className="boton primario">
        Abrir
      </button>
      <button type="button" className="boton" onClick={() => setAbierto(false)}>
        Cancelar
      </button>
      {msg && <p className="chip danger">{msg}</p>}
      <span className="mono-corto" style={{ flex: '1 1 100%' }}>
        Conectarse a un silo como dueno fuera de mantencion tambien es un incidente.
      </span>
    </form>
  );
}

function Soporte() {
  const { datos: lista, recargar } = useDatos<SolicitudSoporte[]>('consola/soporte', 30_000);
  const [silo, setSilo] = useState('');
  const [motivo, setMotivo] = useState('');
  const [alcance, setAlcance] = useState('DIAGNOSTICO');
  const [autorizadaEn, setAutorizadaEn] = useState('');
  const [horas, setHoras] = useState(24);
  const [msg, setMsg] = useState<string>();
  const [cerrando, setCerrando] = useState<number>();
  const [resultado, setResultado] = useState('');

  return (
    <>
      <form
        className="panel form-fila"
        onSubmit={async (e) => {
          e.preventDefault();
          setMsg(undefined);
          const r = await enviarConSesion('consola/soporte', { siloSlug: silo, motivo, alcance, autorizadaEn: new Date(autorizadaEn).toISOString(), horas });
          if (!r.ok) return setMsg(mensajeDe(r.datos, `HTTP ${r.status}`));
          setMotivo('');
          await recargar();
        }}
      >
        <label className="campo-consola" style={{ flex: '0 1 140px' }}>
          Silo
          <input className="campo-texto" required maxLength={40} value={silo} onChange={(e) => setSilo(e.target.value.toLowerCase())} />
        </label>
        <label className="campo-consola" style={{ flex: '3 1 260px' }}>
          Motivo
          <input className="campo-texto" required minLength={4} maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </label>
        <label className="campo-consola" style={{ flex: '0 1 160px' }}>
          Alcance autorizado
          <Selector
            valor={alcance}
            onCambio={setAlcance}
            opciones={[
              { valor: 'DIAGNOSTICO', etiqueta: 'diagnostico' },
              { valor: 'CONFIGURACION', etiqueta: 'configuracion' },
            ]}
          />
        </label>
        <label className="campo-consola" style={{ flex: '0 1 200px' }}>
          Autorizada por el ADMIN
          <CampoFechaHora requerido valor={autorizadaEn} onCambio={setAutorizadaEn} />
        </label>
        <label className="campo-consola" style={{ flex: '0 0 116px' }}>
          Horas
          <CampoNumero requerido min={1} max={72} valor={horas} onCambio={(n) => setHoras(n ?? 1)} />
        </label>
        <button type="submit" className="boton primario">
          Registrar
        </button>
        {msg && <p className="chip danger">{msg}</p>}
        <span className="mono-corto" style={{ flex: '1 1 100%' }}>
          Solo con la autorizacion vigente que el ADMIN otorgo en su silo (1 a 72 h). La consola lleva el ticket; el detalle queda en registro_soporte del silo.
        </span>
      </form>
      <section className="panel">
        {!lista ? (
          <p className="vacio">Cargando…</p>
        ) : lista.length === 0 ? (
          <p className="vacio">Sin solicitudes de soporte.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Silo</th>
                <th>Motivo</th>
                <th>Alcance</th>
                <th>Vence</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lista.map((s) => (
                <tr key={s.id}>
                  <td>{s.id}</td>
                  <td>{s.siloSlug}</td>
                  <td>
                    {s.motivo}
                    {s.resultado && <div className="mono-corto">resultado: {s.resultado}</div>}
                  </td>
                  <td>{s.alcance.toLowerCase()}</td>
                  <td className="nowrap">{fecha(s.venceEn)}</td>
                  <td>
                    <span className={`chip ${s.estado === 'ABIERTA' ? 'info' : s.estado === 'VENCIDA' ? 'warn' : 'neu'}`}>{s.estado}</span>
                  </td>
                  <td>
                    {s.estado !== 'CERRADA' &&
                      (cerrando === s.id ? (
                        <form
                          className="acciones"
                          onSubmit={async (e) => {
                            e.preventDefault();
                            const r = await enviarConSesion(`consola/soporte/${s.id}/cerrar`, { resultado });
                            if (!r.ok) return setMsg(mensajeDe(r.datos, `HTTP ${r.status}`));
                            setCerrando(undefined);
                            setResultado('');
                            await recargar();
                          }}
                        >
                          <input className="campo-texto" placeholder="Resultado (sin datos del centro)" value={resultado} onChange={(e) => setResultado(e.target.value)} autoFocus />
                          <button type="submit" className="boton primario" disabled={resultado.trim().length < 2}>
                            Cerrar
                          </button>
                        </form>
                      ) : (
                        <button type="button" className="boton" onClick={() => setCerrando(s.id)}>
                          Cerrar
                        </button>
                      ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

export function VistaIncidentes({ inicial }: { inicial?: number }) {
  const [pestana, setPestana] = useState<'incidentes' | 'soporte'>('incidentes');
  const [todos, setTodos] = useState(false);
  const [sel, setSel] = useState<number | undefined>(inicial);
  const { datos: r, recargar: recargarResumen } = useDatos<Resumen>('consola/resumen', 30_000);
  const { datos: lista, error, recargar } = useDatos<Incidente[]>(`consola/incidentes${todos ? '?todos=1' : ''}`, 30_000);

  useEffect(() => {
    if (lista?.length && sel === undefined) setSel(lista[0].id);
  }, [lista, sel]);
  useEffect(() => {
    if (sel !== undefined) window.history.replaceState(null, '', `/consola/incidentes?id=${sel}`);
  }, [sel]);

  return (
    <Shell resumen={r} titulo="incidentes y soporte">
      <div className="cabecera-vista">
        <div>
          <h1>Incidentes y soporte</h1>
          <span className="sub">Registro fuera del silo, sin datos personales. Plazos S1/S2/S3{error && ` · error: ${error}`}</span>
        </div>
        {pestana === 'incidentes' && <NuevoIncidente alCrear={(id) => void recargar().then(() => setSel(id))} />}
      </div>
      <div className="pestanas" role="tablist">
        <button type="button" role="tab" className="boton" aria-pressed={pestana === 'incidentes'} onClick={() => setPestana('incidentes')}>
          Incidentes {r?.incidentesAbiertos ? `(${r.incidentesAbiertos} abiertos)` : ''}
        </button>
        <button type="button" role="tab" className="boton" aria-pressed={pestana === 'soporte'} onClick={() => setPestana('soporte')}>
          Soporte
        </button>
      </div>
      {pestana === 'soporte' ? (
        <Soporte />
      ) : (
        <>
          <div className="filtros">
            <button type="button" className="boton" aria-pressed={!todos} onClick={() => setTodos(false)}>
              Abiertos
            </button>
            <button type="button" className="boton" aria-pressed={todos} onClick={() => setTodos(true)}>
              Todos
            </button>
          </div>
          <div className="maestro-detalle">
            <section className="panel maestro">
              {!lista ? (
                <p className="vacio">Cargando…</p>
              ) : lista.length === 0 ? (
                <p className="vacio">Sin incidentes {todos ? '' : 'abiertos'}.</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Sev.</th>
                      <th>Que paso</th>
                      <th>Silo</th>
                      <th>Detectado</th>
                      <th>Plazos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lista.map((i) => (
                      <tr key={i.id} className="fila-clic" aria-selected={sel === i.id} onClick={() => setSel(i.id)}>
                        <td>{i.id}</td>
                        <td>
                          <span className={`chip ${claseSeveridad[i.severidad]}`}>{i.severidad}</span>
                        </td>
                        <td>{i.titulo}</td>
                        <td>{i.siloSlug ?? 'plataforma'}</td>
                        <td className="sub nowrap">{hace(i.detectadoEn)}</td>
                        <td className={`semaforo-${i.semaforo} nowrap`}>● {i.semaforo.replace('_', ' ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
            {sel !== undefined && (
              <DetalleIncidente
                id={sel}
                alCambiar={async () => {
                  await Promise.all([recargar(), recargarResumen()]);
                }}
              />
            )}
          </div>
        </>
      )}
    </Shell>
  );
}
