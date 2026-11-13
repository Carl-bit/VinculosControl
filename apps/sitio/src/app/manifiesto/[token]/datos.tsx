'use client';

import {
  type Borrador,
  completarDependencias,
  DEPENDENCIAS,
  type Modulo,
  MODULOS_MVP,
  NOMBRE_MODULO,
  ordenarModulos,
  TIPOS_ENTIDAD,
} from '@vinculos/manifest';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

/*
 * Fase 2 por el enlace privado: entidad, responsables, dominio, modulos y color
 * de marca. Se guarda a medias cuantas veces se quiera; "Enviar" valida que
 * este completo y avisa a Vinculos (DATOS_COMPLETOS). Version, reglas y
 * contrato los ve y fija el operador en la consola.
 */

interface Datos {
  nombre: string;
  estado: string;
  editable: boolean;
  enviado: boolean;
  venceEn: string;
  subdominioSugerido: string;
  borrador: Pick<Borrador, 'centro' | 'dominio' | 'modulos' | 'estilo'>;
}

const ENTIDAD: Record<(typeof TIPOS_ENTIDAD)[number], string> = {
  sociedad_profesionales: 'Sociedad de profesionales',
  spa: 'SpA',
  eirl: 'EIRL',
  persona_natural: 'Persona natural',
  otra: 'Otra',
};

export function DatosFormales({ token }: { token: string }) {
  const [d, setD] = useState<Datos>();
  const [error, setError] = useState<string>();
  const [aviso, setAviso] = useState<string>();
  const [faltan, setFaltan] = useState<{ campo: string; mensaje: string }[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [elegidos, setElegidos] = useState<Modulo[]>([]);

  const cargar = useCallback(async () => {
    const r = await fetch(`/api/publico/manifiesto/${token}`, { cache: 'no-store' });
    const j = (await r.json().catch(() => ({}))) as Datos & { mensaje?: string };
    if (!r.ok) {
      setError(j.mensaje ?? 'Este enlace ya no es valido.');
      return;
    }
    setD(j);
    setElegidos(ordenarModulos(j.borrador.modulos ?? []));
  }, [token]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (error)
    return (
      <section className="panel exito">
        <h2>Enlace no disponible</h2>
        <p className="bajada">{error}</p>
      </section>
    );
  if (!d) return <p className="nota">Cargando…</p>;

  const b = d.borrador;
  const modulos = completarDependencias(elegidos);
  const alternar = (m: Modulo) => setElegidos((s) => (s.includes(m) ? s.filter((x) => x !== m) : ordenarModulos([...s, m])));

  const leerForm = (f: HTMLFormElement): Datos['borrador'] => {
    const v = (k: string) => String(new FormData(f).get(k) ?? '').trim();
    const opc = (s: string) => s || undefined;
    const tipoDominio = v('dominio_tipo') === 'propio' ? 'propio' : 'subdominio';
    return {
      centro: {
        nombre: v('nombre'),
        razon_social: opc(v('razon_social')),
        rut: opc(v('rut')),
        tipo_entidad: opc(v('tipo_entidad')) as (typeof TIPOS_ENTIDAD)[number] | undefined,
        direccion: opc(v('direccion')),
        admin: { nombre: opc(v('admin_nombre')), correo: opc(v('admin_correo')) },
        responsable_datos: { nombre: opc(v('resp_nombre')), correo: opc(v('resp_correo')) },
        ...(v('cust_nombre') || v('cust_rol') ? { custodio: { nombre: opc(v('cust_nombre')), rol: opc(v('cust_rol')) } } : {}),
      },
      dominio: { tipo: tipoDominio, valor: tipoDominio === 'subdominio' ? d.subdominioSugerido : opc(v('dominio_propio')) },
      modulos,
      ...(v('color') ? { estilo: { marca: { principal: v('color') } } } : {}),
    };
  };

  const guardar = async (f: HTMLFormElement, luegoEnviar: boolean) => {
    if (ocupado) return;
    setOcupado(true);
    setAviso(undefined);
    setFaltan([]);
    try {
      const r = await fetch(`/api/publico/manifiesto/${token}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(leerForm(f)) });
      const j = (await r.json().catch(() => ({}))) as { mensaje?: string };
      if (!r.ok) {
        setAviso(j.mensaje ?? 'No se pudo guardar.');
        return;
      }
      if (!luegoEnviar) {
        setAviso('Guardado. Puedes volver a este enlace cuando quieras.');
        return;
      }
      const e = await fetch(`/api/publico/manifiesto/${token}/enviar`, { method: 'POST', headers: { 'content-type': 'application/json' } });
      const je = (await e.json().catch(() => ({}))) as { mensaje?: string; campos?: { campo: string; mensaje: string }[] };
      if (!e.ok) {
        setFaltan(je.campos ?? []);
        setAviso(je.mensaje === 'Faltan datos' ? 'Faltan algunos datos. Revisa la lista.' : (je.mensaje ?? 'No se pudo enviar.'));
        return;
      }
      await cargar();
      setAviso('Listo. Recibimos tus datos; te avisaremos cuando la plataforma este aprobada.');
    } catch {
      setAviso('Sin conexion. Revisa tu internet e intenta de nuevo.');
    } finally {
      setOcupado(false);
    }
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void guardar(e.currentTarget, true);
  };
  const mal = (c: string) => faltan.some((f) => f.campo === c || f.campo.startsWith(`${c}.`)) || undefined;
  const dis = !d.editable || ocupado;

  return (
    <>
      <div>
        <h1 className="titulo">Datos de {d.nombre}</h1>
        <p className="bajada">
          Con esto preparamos tu plataforma. Puedes guardar y volver cuantas veces quieras hasta el {new Date(d.venceEn).toLocaleDateString('es-CL', { dateStyle: 'long' })}.
          {d.enviado && ' Ya nos enviaste los datos; si corriges algo, vuelve a enviarlos.'}
        </p>
      </div>
      {!d.editable && (
        <p className="aviso" role="status">
          Tu plataforma ya esta en preparacion; estos datos ya no se editan aqui.
        </p>
      )}
      <form className="panel formulario" onSubmit={onSubmit} noValidate>
        <fieldset disabled={dis}>
          <legend>Entidad</legend>
          <div className="fila">
            <label className="campo">
              Nombre del centro
              <input name="nombre" defaultValue={b.centro?.nombre ?? ''} maxLength={120} aria-invalid={mal('centro.nombre')} />
            </label>
            <label className="campo">
              Razon social
              <input name="razon_social" defaultValue={b.centro?.razon_social ?? ''} maxLength={200} aria-invalid={mal('centro.razon_social')} />
            </label>
          </div>
          <div className="fila">
            <label className="campo">
              RUT
              <input name="rut" defaultValue={b.centro?.rut ?? ''} maxLength={14} placeholder="76.123.456-7" aria-invalid={mal('centro.rut')} />
            </label>
            <label className="campo">
              Tipo de entidad
              <select name="tipo_entidad" defaultValue={b.centro?.tipo_entidad ?? ''} aria-invalid={mal('centro.tipo_entidad')}>
                <option value="">Elige una opcion</option>
                {TIPOS_ENTIDAD.map((t) => (
                  <option key={t} value={t}>
                    {ENTIDAD[t]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="campo">
            <span>
              Direccion <span className="opcional">(opcional)</span>
            </span>
            <input name="direccion" defaultValue={b.centro?.direccion ?? ''} maxLength={200} />
          </label>
        </fieldset>

        <fieldset disabled={dis}>
          <legend>Responsables</legend>
          <p className="ayuda">El admin inicial recibe la invitacion a la plataforma. El responsable de datos recibe los exportes si algun dia el centro se va.</p>
          <div className="fila">
            <label className="campo">
              Admin inicial: nombre
              <input name="admin_nombre" defaultValue={b.centro?.admin?.nombre ?? ''} maxLength={120} aria-invalid={mal('centro.admin')} />
            </label>
            <label className="campo">
              Admin inicial: correo
              <input name="admin_correo" type="email" defaultValue={b.centro?.admin?.correo ?? ''} maxLength={200} aria-invalid={mal('centro.admin')} />
            </label>
          </div>
          <div className="fila">
            <label className="campo">
              Responsable de datos: nombre
              <input name="resp_nombre" defaultValue={b.centro?.responsable_datos?.nombre ?? ''} maxLength={120} aria-invalid={mal('centro.responsable_datos')} />
            </label>
            <label className="campo">
              Responsable de datos: correo
              <input name="resp_correo" type="email" defaultValue={b.centro?.responsable_datos?.correo ?? ''} maxLength={200} aria-invalid={mal('centro.responsable_datos')} />
            </label>
          </div>
          <div className="fila">
            <label className="campo">
              <span>
                Custodio de la llave de recuperacion <span className="opcional">(opcional)</span>
              </span>
              <input name="cust_nombre" defaultValue={b.centro?.custodio?.nombre ?? ''} maxLength={120} placeholder="Nombre" />
            </label>
            <label className="campo">
              <span>
                Rol del custodio <span className="opcional">(opcional)</span>
              </span>
              <input name="cust_rol" defaultValue={b.centro?.custodio?.rol ?? ''} maxLength={80} placeholder="Ej.: directora" />
            </label>
          </div>
        </fieldset>

        <fieldset disabled={dis}>
          <legend>Dominio</legend>
          <div className="opciones" role="radiogroup">
            <label className="opcion">
              <input type="radio" name="dominio_tipo" value="subdominio" defaultChecked={b.dominio?.tipo !== 'propio'} />
              {d.subdominioSugerido}
            </label>
            <label className="opcion">
              <input type="radio" name="dominio_tipo" value="propio" defaultChecked={b.dominio?.tipo === 'propio'} />
              Dominio propio
            </label>
          </div>
          <label className="campo">
            <span>
              Dominio propio <span className="opcional">(solo si elegiste esa opcion)</span>
            </span>
            <input name="dominio_propio" defaultValue={b.dominio?.tipo === 'propio' ? (b.dominio.valor ?? '') : ''} placeholder="plataforma.micentro.cl" aria-invalid={mal('dominio')} />
          </label>
        </fieldset>

        <fieldset disabled={dis}>
          <legend>Modulos</legend>
          <p className="ayuda">Los que otro necesita se agregan solos (borde verde).</p>
          <div className="bloques">
            {MODULOS_MVP.map((m) => {
              const activo = modulos.includes(m);
              const requerido = activo && !elegidos.includes(m);
              const por = modulos.filter((x) => DEPENDENCIAS[x].requiere.includes(m));
              return (
                <button key={m} type="button" className="bloque" aria-pressed={activo} data-requerido={requerido} onClick={() => (requerido ? undefined : alternar(m))}>
                  <b>{NOMBRE_MODULO[m]}</b>
                  {requerido && <small>Lo necesita {por.map((x) => NOMBRE_MODULO[x]).join(' y ')}</small>}
                </button>
              );
            })}
          </div>
        </fieldset>

        <fieldset disabled={dis}>
          <legend>Color de marca</legend>
          <label className="campo">
            <span>
              Color principal <span className="opcional">(opcional, #RRGGBB)</span>
            </span>
            <input name="color" defaultValue={b.estilo?.marca?.principal ?? ''} maxLength={7} placeholder="#2E6E6E" aria-invalid={mal('estilo')} />
          </label>
          <p className="nota">No incluyas datos de pacientes en ningun campo.</p>
        </fieldset>

        {faltan.length > 0 && (
          <ul className="aviso" role="alert">
            {faltan.map((f) => (
              <li key={f.campo + f.mensaje}>
                {f.campo}: {f.mensaje}
              </li>
            ))}
          </ul>
        )}
        {aviso && faltan.length === 0 && (
          <p className="nota" role="status">
            {aviso}
          </p>
        )}
        {d.editable && (
          <div className="opciones">
            <button
              type="button"
              className="opcion"
              disabled={ocupado}
              onClick={(e) => {
                const f = e.currentTarget.form;
                if (f) void guardar(f, false);
              }}
            >
              Guardar sin enviar
            </button>
            <button type="submit" className="enviar" disabled={ocupado}>
              {ocupado ? 'Enviando…' : 'Enviar datos'}
            </button>
          </div>
        )}
      </form>
    </>
  );
}
