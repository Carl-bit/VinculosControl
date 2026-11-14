'use client';

import {
  completarDependencias,
  DEPENDENCIAS,
  fase1Schema,
  MODULOS_MVP,
  type Modulo,
  NOMBRE_MODULO,
  ordenarModulos,
  quitarModulo,
  TAMANOS_EQUIPO,
} from '@vinculos/manifest';
import { useState, type FormEvent } from 'react';

import { Selector } from '../selector';

/*
 * Formulario de fase 1 (CONTEXTO.md seccion 3): pide poco, para llegar a una
 * reunion. Sin datos sensibles. Lo valida el mismo schema que usa la API
 * (@vinculos/manifest). `?modulos=AGENDA,FICHAS` lo precarga (el landing por
 * bloques de la fase 6 lo usara asi).
 */

const DESCRIPCION: Partial<Record<Modulo, string>> = {
  FICHAS: 'Fichas clinicas y pacientes',
  AGENDA: 'Horarios, boxes y reservas',
  EQUIPO: 'Profesionales, perfiles y validaciones',
  MATCH: 'Sugiere el profesional adecuado',
  PAGINA_PUBLICA: 'Sitio del centro con su equipo',
};
/** MVP: sin COBROS (no manejamos finanzas) ni WHATSAPP. */
const OFRECIDOS: readonly Modulo[] = MODULOS_MVP;
const SITIO = [
  { v: 'nuevo', l: 'No tenemos, queremos uno' },
  { v: 'integrar', l: 'Si, queremos integrarlo' },
  { v: 'no_necesito', l: 'No necesitamos sitio' },
] as const;
/** Preferencia de estilo (el tema final se fija en el manifiesto). */
const ESTILO = [
  { v: 'moderno', l: 'Moderno', d: 'Limpio y luminoso' },
  { v: 'cuaderno', l: 'Cuaderno', d: 'Calido, como papel' },
  { v: 'editorial', l: 'Editorial', d: 'Sobrio, de revista' },
  { v: 'propios', l: 'Tenemos nuestros colores', d: 'Usamos tu marca' },
  { v: 'aun_no_se', l: 'Aun no lo se', d: 'Lo vemos juntos' },
] as const;
const TRAMPA = 'sitio_web_alternativo';

export function Formulario({ precarga, via }: { precarga: Modulo[]; via: 'formulario' | 'enlace' }) {
  const [modulos, setModulos] = useState<Modulo[]>(() => completarDependencias(precarga));
  const [elegidos, setElegidos] = useState<Modulo[]>(() => ordenarModulos(precarga));
  const [error, setError] = useState<string>();
  const [campos, setCampos] = useState<string[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [listo, setListo] = useState(false);
  const [estilo, setEstilo] = useState<string>('moderno');

  /** Los requeridos se agregan solos; al quitar uno elegido se recalculan. Un requerido no se quita mientras otro lo necesite. */
  const alternar = (m: Modulo) => {
    if (elegidos.includes(m)) {
      const sinM = elegidos.filter((x) => x !== m);
      const r = quitarModulo(completarDependencias(sinM).concat(m), m);
      if (!r.ok) return;
      setElegidos(sinM);
      setModulos(completarDependencias(sinM));
    } else {
      const con = ordenarModulos([...elegidos, m]);
      setElegidos(con);
      setModulos(completarDependencias(con));
    }
  };
  const requeridoPor = (m: Modulo) => modulos.filter((x) => x !== m && DEPENDENCIAS[x].requiere.includes(m));

  const enviar = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (enviando) return;
    const f = new FormData(e.currentTarget);
    const v = (k: string) => String(f.get(k) ?? '').trim();
    const datos = {
      nombre_centro: v('nombre_centro'),
      contacto: { nombre: v('contacto_nombre'), correo: v('contacto_correo'), telefono: v('contacto_telefono') },
      comuna: v('comuna'),
      region: v('region') || undefined,
      tamano_equipo: v('tamano_equipo'),
      modulos_interes: modulos,
      sitio_existente: v('sitio_existente'),
      estilo_preferido: v('estilo_preferido'),
      como_trabajan_hoy: v('como_trabajan_hoy') || undefined,
      comentarios: v('comentarios') || undefined,
    };
    const r = fase1Schema.safeParse(datos);
    if (!r.success) {
      setCampos(r.error.issues.map((i) => i.path.join('.')));
      setError('Revisa los campos marcados.');
      return;
    }
    setEnviando(true);
    setError(undefined);
    setCampos([]);
    try {
      const res = await fetch('/api/publico/solicitudes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...datos, [TRAMPA]: v(TRAMPA), origen: via }),
      });
      if (res.ok) {
        setListo(true);
        window.scrollTo({ top: 0 });
        return;
      }
      const d = (await res.json().catch(() => ({}))) as { mensaje?: string; campos?: string[] };
      setError(d.mensaje ?? 'No pudimos enviar tu solicitud. Intenta de nuevo.');
      setCampos(d.campos ?? []);
    } catch {
      setError('Sin conexion. Revisa tu internet e intenta de nuevo.');
    } finally {
      setEnviando(false);
    }
  };

  const mal = (c: string) => campos.includes(c) || undefined;

  if (listo) {
    return (
      <section className="panel exito" role="status">
        <h2>Recibimos tu solicitud.</h2>
        <p className="bajada">Te escribiremos al correo que dejaste para coordinar una reunion. Ahi vemos juntos los modulos y como trabaja tu centro.</p>
      </section>
    );
  }

  return (
    <form className="panel formulario" onSubmit={enviar} noValidate>
      <fieldset>
        <legend>Tu centro</legend>
        <div className="fila">
          <label className="campo">
            Nombre del centro
            <input name="nombre_centro" required maxLength={120} autoComplete="organization" aria-invalid={mal('nombre_centro')} />
          </label>
          <label className="campo">
            Comuna
            <input name="comuna" required maxLength={80} aria-invalid={mal('comuna')} />
          </label>
          <label className="campo">
            <span>
              Region <span className="opcional">(opcional)</span>
            </span>
            <input name="region" maxLength={80} />
          </label>
        </div>
        <label className="campo">
          Tamano del equipo
          <Selector name="tamano_equipo" required invalido={mal('tamano_equipo')} opciones={TAMANOS_EQUIPO.map((t) => ({ valor: t, etiqueta: `${t} profesionales` }))} />
        </label>
      </fieldset>

      <fieldset>
        <legend>Quien te contacta</legend>
        <div className="fila">
          <label className="campo">
            Nombre
            <input name="contacto_nombre" required maxLength={120} autoComplete="name" aria-invalid={mal('contacto.nombre')} />
          </label>
          <label className="campo">
            Correo
            <input name="contacto_correo" type="email" required maxLength={200} autoComplete="email" aria-invalid={mal('contacto.correo')} />
          </label>
          <label className="campo">
            <span>
              Telefono <span className="opcional">(opcional)</span>
            </span>
            <input name="contacto_telefono" type="tel" maxLength={16} autoComplete="tel" aria-invalid={mal('contacto.telefono')} />
          </label>
        </div>
      </fieldset>

      <fieldset>
        <legend>Que te interesa</legend>
        <p className="ayuda">Elige los modulos. Los que otro necesita se agregan solos (borde verde).</p>
        <div className="bloques">
          {OFRECIDOS.map((m) => {
            const req = requeridoPor(m);
            const activo = modulos.includes(m);
            const soloRequerido = activo && !elegidos.includes(m);
            return (
              <button key={m} type="button" className="bloque" aria-pressed={activo} data-requerido={soloRequerido} onClick={() => (soloRequerido ? undefined : alternar(m))}>
                <b>{NOMBRE_MODULO[m]}</b>
                <small>{DESCRIPCION[m]}</small>
                {soloRequerido && <small>Lo necesita {req.map((x) => NOMBRE_MODULO[x]).join(' y ')}</small>}
                {!activo && DEPENDENCIAS[m].requiere.length > 0 && <small>Incluye {DEPENDENCIAS[m].requiere.map((x) => NOMBRE_MODULO[x]).join(' y ')}</small>}
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset>
        <legend>Sitio web</legend>
        <div className="opciones" role="radiogroup">
          {SITIO.map((o, i) => (
            <label key={o.v} className="opcion">
              <input type="radio" name="sitio_existente" value={o.v} defaultChecked={i === 0} />
              {o.l}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>Estilo visual</legend>
        <div className="opciones" role="radiogroup" aria-label="Estilo visual">
          {ESTILO.map((o) => (
            <label key={o.v} className="opcion" title={o.d}>
              <input type="radio" name="estilo_preferido" value={o.v} checked={estilo === o.v} onChange={() => setEstilo(o.v)} />
              {o.l}
            </label>
          ))}
        </div>
        {estilo === 'aun_no_se' && (
          <p className="nota" role="status">
            No te preocupes, con la primera sesion podremos definir tus colores.
          </p>
        )}
        {estilo === 'propios' && (
          <p className="nota" role="status">
            En la reunion vemos tus colores y tu logo para aplicarlos a la plataforma.
          </p>
        )}
      </fieldset>

      <fieldset>
        <legend>Cuentanos un poco mas</legend>
        <label className="campo">
          <span>
            Como trabajan hoy <span className="opcional">(opcional)</span>
          </span>
          <input name="como_trabajan_hoy" maxLength={300} placeholder="Ej.: agenda en planillas y fichas en papel" />
        </label>
        <label className="campo">
          <span>
            Comentarios <span className="opcional">(opcional)</span>
          </span>
          <textarea name="comentarios" maxLength={1000} />
        </label>
        <p className="nota">No incluyas datos de pacientes. Esta solicitud solo nos sirve para coordinar una reunion.</p>
      </fieldset>

      {/* Campo trampa: oculto para personas y lectores de pantalla. */}
      <div className="trampa" aria-hidden="true">
        <label>
          No llenar
          <input name={TRAMPA} tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      {error && (
        <p className="aviso" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="enviar" disabled={enviando}>
        {enviando ? 'Enviando…' : 'Enviar solicitud'}
      </button>
    </form>
  );
}
