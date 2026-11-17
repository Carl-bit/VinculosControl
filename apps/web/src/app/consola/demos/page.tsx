'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { CampoNumero, Selector } from '@/componentes/controles';
import { useConfirmacion } from '@/componentes/dialogo';
import { claseJob, Shell } from '@/componentes/piezas';
import { enviarConSesion, hace, mensajeDe, useDatos, type DetalleJob, type Resumen } from '@/lib/api';

/*
 * Demos a medida (R10). El operador elige cuantas cuentas madre, profesionales
 * y pacientes tendra el centro de demostracion; se aprovisiona como cualquier
 * silo (P5 de llaves sigue siendo manual) y en P10 el host B genera los datos.
 * Correos y contrasena de las cuentas quedan solo en el host B
 * (silos/<slug>/demo-cuentas.txt): aqui llegan conteos. Solo los slugs de
 * EJECUTOR_DEMOS del host B pueden ser demo.
 */

interface FilaDemo {
  centroId: number;
  slug: string | null;
  nombre: string;
  estado: string;
  dominio: string | null;
  cantidades: { cuentas_madre: number; profesionales: number; pacientes: number } | null;
  silo: { vistoEn: string | null; version: string | null; adoptado: boolean } | null;
  aprovisionar: { id: number; estado: string; error: string | null } | null;
  resembrado: { id: number; estado: string; creadoEn: string; terminadoEn: string | null } | null;
}

const MODULOS = ['FICHAS', 'AGENDA', 'EQUIPO', 'MATCH', 'PAGINA_PUBLICA'] as const;
const SLUG = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/;

export default function Demos() {
  const router = useRouter();
  const { datos: r } = useDatos<Resumen>('consola/resumen', 30_000);
  const { datos: demos, recargar } = useDatos<FilaDemo[]>('consola/demos', 15_000);
  const [confirmar, dialogo] = useConfirmacion();
  const [slug, setSlug] = useState('demo-');
  const [nombre, setNombre] = useState('');
  const [canal, setCanal] = useState('demo');
  const [tema, setTema] = useState('moderno');
  const [modulos, setModulos] = useState<string[]>(['FICHAS', 'AGENDA', 'EQUIPO']);
  const [madres, setMadres] = useState<number | undefined>(1);
  const [profesionales, setProfesionales] = useState<number | undefined>(4);
  const [pacientes, setPacientes] = useState<number | undefined>(40);
  const [msg, setMsg] = useState<{ t: string; ok: boolean }>();
  const [ocupado, setOcupado] = useState(false);

  const alternar = (m: string) => {
    const con = modulos.includes(m) ? modulos.filter((x) => x !== m) : [...modulos, m];
    // MATCH y PAGINA_PUBLICA requieren EQUIPO; sin EQUIPO se van los dos.
    const conEquipo = ['MATCH', 'PAGINA_PUBLICA'].includes(m) && !modulos.includes(m) ? [...new Set([...con, 'EQUIPO'])] : con;
    setModulos(conEquipo.includes('EQUIPO') ? conEquipo : conEquipo.filter((x) => x !== 'MATCH' && x !== 'PAGINA_PUBLICA'));
  };
  const valido = SLUG.test(slug) && nombre.trim().length >= 2 && madres !== undefined && profesionales !== undefined && pacientes !== undefined;

  const crear = async () => {
    const si = await confirmar({
      etiqueta: `Demo · erp-${slug}`,
      titulo: 'Crear demo',
      texto: `Se aprovisiona erp-${slug} con ${madres} cuenta(s) madre, ${profesionales} profesional(es) y ${pacientes} paciente(s) ficticios. Antes, en el host B, el slug debe estar en EJECUTOR_DEMOS (si no, P10 falla). Las llaves (P5) las corre el operador como en todo silo. Correos y contrasena quedan en silos/${slug}/demo-cuentas.txt del host B.`,
      boton: 'Crear y aprovisionar',
    });
    if (si === null) return;
    setOcupado(true);
    setMsg(undefined);
    try {
      const res = await enviarConSesion<{ centroId: number; job: DetalleJob }>('consola/demos', {
        slug,
        nombre: nombre.trim(),
        canal,
        tema,
        modulos,
        cuentasMadre: madres,
        profesionales,
        pacientes,
      });
      if (res.ok) router.push(`/consola/jobs/${res.datos.job.id}`);
      else setMsg({ t: mensajeDe(res.datos, `No se pudo (HTTP ${res.status})`), ok: false });
    } finally {
      setOcupado(false);
    }
  };

  const resembrar = async (d: FilaDemo) => {
    const si = await confirmar({
      etiqueta: `Demo · erp-${d.slug}`,
      titulo: 'Resembrar',
      texto: 'Agenda las proximas horas de los pacientes del demo y renueva accesos, sin borrar nada ni tocar llaves. Lo que hicieron los visitantes queda. Una vez por hora como maximo.',
      boton: 'Resembrar',
    });
    if (si === null) return;
    const res = await enviarConSesion<DetalleJob>('consola/jobs', { tipo: 'REINICIAR_DEMO', siloSlug: d.slug });
    if (res.ok) router.push(`/consola/jobs/${res.datos.id}`);
    else setMsg({ t: mensajeDe(res.datos, `No se pudo (HTTP ${res.status})`), ok: false });
    await recargar();
  };

  return (
    <Shell resumen={r} titulo="demos">
      <div>
        <h1>Demos</h1>
        <span className="sub">Centros de demostracion a medida del cliente. Datos ficticios; las credenciales quedan en el host B.</span>
      </div>
      {msg && (
        <p role="status" className={`chip ${msg.ok ? 'ok' : 'danger'}`} style={{ whiteSpace: 'normal' }}>
          {msg.t}
        </p>
      )}

      <section className="panel">
        <h2>Nuevo demo</h2>
        <div className="rejilla-campos">
          <label className="campo-consola">
            Slug (erp-&lt;slug&gt;)
            <input className="campo-texto" value={slug} maxLength={40} spellCheck={false} onChange={(e) => setSlug(e.target.value.toLowerCase())} aria-invalid={!SLUG.test(slug)} />
          </label>
          <label className="campo-consola">
            Nombre del centro
            <input className="campo-texto" value={nombre} maxLength={80} onChange={(e) => setNombre(e.target.value)} placeholder="Centro Kibou (demo)" />
          </label>
          <label className="campo-consola">
            Canal
            <Selector valor={canal} opciones={['demo', 'beta', 'estable'].map((c) => ({ valor: c, etiqueta: c }))} onCambio={setCanal} etiqueta="Canal" />
          </label>
          <label className="campo-consola">
            Tema
            <Selector valor={tema} opciones={['moderno', 'cuaderno'].map((t) => ({ valor: t, etiqueta: t }))} onCambio={setTema} etiqueta="Tema" />
          </label>
        </div>
        <div className="rejilla-campos">
          <label className="campo-consola">
            Cuentas madre (1 a 3)
            <CampoNumero requerido min={1} max={3} valor={madres} onCambio={setMadres} />
          </label>
          <label className="campo-consola">
            Profesionales (1 a 20)
            <CampoNumero requerido min={1} max={20} valor={profesionales} onCambio={setProfesionales} />
          </label>
          <label className="campo-consola">
            Pacientes (0 a 300)
            <CampoNumero requerido min={0} max={300} valor={pacientes} onCambio={setPacientes} />
          </label>
        </div>
        <fieldset className="campo-consola" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend>Modulos</legend>
          <div className="acciones">
            {MODULOS.map((m) => (
              <button key={m} type="button" className="boton" aria-pressed={modulos.includes(m)} onClick={() => alternar(m)}>
                {m}
              </button>
            ))}
          </div>
        </fieldset>
        <p className="mono-corto">
          Los tres primeros pacientes tienen cuenta en el portal. Cada cuenta entra con un codigo por correo (Mailpit o SES del silo).
        </p>
        <div className="acciones">
          <button type="button" className="boton primario" disabled={!valido || ocupado} onClick={() => void crear()}>
            {ocupado ? 'Creando…' : 'Crear y aprovisionar'}
          </button>
        </div>
      </section>

      <section className="panel">
        <h2>Demos</h2>
        {!demos ? (
          <p className="vacio">Cargando…</p>
        ) : demos.length === 0 ? (
          <p className="vacio">Ningun demo todavia.</p>
        ) : (
          <div className="tabla-ancha">
            <table>
              <thead>
                <tr>
                  <th>Demo</th>
                  <th>Cantidades</th>
                  <th>Estado</th>
                  <th>Aprovisionar</th>
                  <th>Resembrado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {demos.map((d) => (
                  <tr key={d.centroId}>
                    <td>
                      <b>{d.nombre}</b>
                      <span className="mono-corto" style={{ display: 'block' }}>
                        erp-{d.slug} · {d.dominio ?? 'sin dominio'}
                      </span>
                    </td>
                    <td className="mono-corto">
                      {d.cantidades ? `${d.cantidades.cuentas_madre} madre · ${d.cantidades.profesionales} prof · ${d.cantidades.pacientes} pac` : '-'}
                    </td>
                    <td>
                      <span className="chip neu">{d.estado}</span>
                      {d.silo?.version && <span className="mono-corto"> {d.silo.version}</span>}
                    </td>
                    <td>
                      {d.aprovisionar ? (
                        <Link href={`/consola/jobs/${d.aprovisionar.id}`} className={`chip ${claseJob[d.aprovisionar.estado] ?? 'neu'}`}>
                          #{d.aprovisionar.id} {d.aprovisionar.estado}
                        </Link>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td>
                      {d.resembrado ? (
                        <Link href={`/consola/jobs/${d.resembrado.id}`} className={`chip ${claseJob[d.resembrado.estado] ?? 'neu'}`}>
                          {d.resembrado.estado} · {hace(d.resembrado.terminadoEn ?? d.resembrado.creadoEn)}
                        </Link>
                      ) : (
                        <span className="mono-corto">nunca</span>
                      )}
                    </td>
                    <td>
                      <button type="button" className="boton" disabled={!['ACTIVO', 'ACTIVO_SIN_DOMINIO'].includes(d.estado)} onClick={() => void resembrar(d)}>
                        Resembrar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {dialogo}
    </Shell>
  );
}
