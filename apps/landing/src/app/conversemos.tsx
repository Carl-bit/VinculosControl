'use client';

import { type Fase1, fase1Schema, type ModuloMvp, TAMANOS_EQUIPO } from '@vinculos/manifest';
import { type FormEvent, useEffect, useRef, useState } from 'react';

import { bloque, BLOQUES, type IdBloque, PROCESO } from './datos';

/*
 * Solicitud de fase 1 como conversacion (boceto "Conversemos"). Pregunta lo
 * mismo que el formulario de fase 1 y lo valida con el mismo schema que la API
 * (@vinculos/manifest). Sin datos de pacientes. El campo trampa va oculto.
 */

const TRAMPA = 'sitio_web_alternativo';
const TAMANO_TXT: Record<(typeof TAMANOS_EQUIPO)[number], string> = { '1 a 5': '1 a 5', '6 a 15': '6 a 15', '16 a 40': '16 a 40', 'mas de 40': 'Más de 40' };
const SITIO: { v: Fase1['sitio_existente']; l: string }[] = [
  { v: 'integrar', l: 'Sí, integrarlo' },
  { v: 'nuevo', l: 'No, quiero uno nuevo' },
  { v: 'no_necesito', l: 'No necesito sitio' },
];
const ESTILO: { v: Fase1['estilo_preferido']; l: string }[] = [
  { v: 'moderno', l: 'Moderno' },
  { v: 'cuaderno', l: 'Cuaderno' },
  { v: 'editorial', l: 'Editorial' },
  { v: 'propios', l: 'Uno propio del centro' },
  { v: 'aun_no_se', l: 'Aún no sé' },
];

type Paso = 'inicio' | 'tam' | 'bloques' | 'sitio' | 'estilo' | 'datos' | 'fin';
interface Linea {
  de: 'v' | 'u';
  t: string;
}
const SALUDO: Linea[] = [{ de: 'v', t: 'Hola, somos el equipo de Vinculos. ¿Qué te trae por aquí?' }];

const CAMPO_TXT: Record<string, string> = {
  nombre_centro: 'el nombre del centro',
  'contacto.nombre': 'tu nombre',
  'contacto.correo': 'el correo',
  'contacto.telefono': 'el teléfono',
  comuna: 'la comuna',
};

export function Conversemos({ sel, alternar, msg, via }: { sel: IdBloque[]; alternar: (id: IdBloque) => void; msg: string; via: 'landing' | 'enlace' }) {
  const [hist, setHist] = useState<Linea[]>(SALUDO);
  const [paso, setPaso] = useState<Paso>('inicio');
  const [tam, setTam] = useState<Fase1['tamano_equipo']>();
  const [sitio, setSitio] = useState<Fase1['sitio_existente']>();
  const [estilo, setEstilo] = useState<Fase1['estilo_preferido']>();
  const [datos, setDatos] = useState({ nombre: '', centro: '', comuna: '', correo: '', telefono: '' });
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  const registro = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const r = registro.current;
    if (r) r.scrollTop = r.scrollHeight;
  }, [hist, paso]);

  const decir = (usuario: string | null, bot: string[], siguiente: Paso) => {
    setHist((h) => [...h, ...(usuario ? [{ de: 'u' as const, t: usuario }] : []), ...bot.map((t) => ({ de: 'v' as const, t }))]);
    setPaso(siguiente);
    setError('');
  };
  const reiniciar = () => {
    setHist(SALUDO);
    setPaso('inicio');
    setError('');
  };

  const modulos = sel.filter((x): x is ModuloMvp => x !== 'NUCLEO');

  async function enviar(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const trampa = new FormData(ev.currentTarget).get(TRAMPA);
    const solicitud = {
      nombre_centro: datos.centro,
      contacto: { nombre: datos.nombre, correo: datos.correo, telefono: datos.telefono },
      comuna: datos.comuna,
      tamano_equipo: tam,
      modulos_interes: modulos,
      sitio_existente: sitio,
      estilo_preferido: estilo,
    };
    const r = fase1Schema.safeParse(solicitud);
    if (!r.success) {
      const i = r.error.issues[0];
      const campo = i.path.join('.');
      setError(CAMPO_TXT[campo] ? `Revisa ${CAMPO_TXT[campo]}.` : 'Revisa los datos de contacto.');
      return;
    }
    setEnviando(true);
    setError('');
    try {
      const res = await fetch('/api/solicitud', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...r.data, origen: via, [TRAMPA]: trampa ?? '' }) });
      if (res.status === 202) {
        decir('Te dejé mis datos', ['Listo, recibimos tu solicitud.', 'Te escribimos en un máximo de 2 días hábiles para coordinar la reunión. Esto es lo que sigue:'], 'fin');
        return;
      }
      const cuerpo = (await res.json().catch(() => ({}))) as { mensaje?: string };
      setError(cuerpo.mensaje ?? 'No pudimos enviar tu solicitud. Intenta de nuevo en unos minutos.');
    } catch {
      setError('No pudimos conectarnos. Revisa tu conexión e intenta de nuevo.');
    } finally {
      setEnviando(false);
    }
  }

  const campo = (k: keyof typeof datos, l: string, tipo: 'text' | 'email' | 'tel', auto: string, opcional = false) => (
    <label className="campo">
      <span>
        {l}
        {opcional && <span className="sub"> (opcional)</span>}
      </span>
      <input type={tipo} autoComplete={auto} value={datos[k]} required={!opcional} maxLength={k === 'correo' ? 200 : 120} onChange={(e) => setDatos((x) => ({ ...x, [k]: e.target.value }))} />
    </label>
  );

  return (
    <section id="conversemos" className="seccion conversemos">
      <div className="conversemos-texto">
        <span className="kicker">Conversemos</span>
        <h2>Una conversación, no un formulario largo.</h2>
        <p>
          Responde unas pocas preguntas y preparamos la reunión con lo justo.
          {via === 'landing' ? ' Los bloques que activaste arriba ya están marcados.' : ' En la conversación eliges los bloques que te interesan.'}
        </p>
        <div className="aviso">
          <strong>No escribas datos de pacientes aquí.</strong> Si traes fichas de otro sistema, las migramos después por un canal seguro.
        </div>
      </div>
      <div className="hoja chat">
        <div className="chat-cabeza">
          <span aria-hidden="true" className="chat-punto" />
          <strong>Vinculos</strong>
          <span className="sub">Respondemos en horario hábil</span>
        </div>
        <div className="chat-registro" role="log" aria-live="polite" ref={registro}>
          {hist.map((h, i) => (
            <div key={i} className={`burbuja ${h.de === 'u' ? 'de-usuario' : 'de-vinculos'}`}>
              {h.t}
            </div>
          ))}
        </div>
        <div className="chat-respuestas">
          {paso === 'inicio' && (
            <div className="opciones">
              <button type="button" className="opcion" onClick={() => decir('Quiero Vinculos para mi centro', ['Genial. Para preparar la reunión necesito unos datos rápidos.', '¿Cuántas personas atienden en tu centro?'], 'tam')}>
                Quiero Vinculos para mi centro
              </button>
            </div>
          )}
          {paso === 'tam' && (
            <div className="opciones">
              {TAMANOS_EQUIPO.map((t) => (
                <button
                  key={t}
                  type="button"
                  className="opcion"
                  onClick={() => {
                    setTam(t);
                    decir(TAMANO_TXT[t], [via === 'landing' ? '¿Qué bloques te interesan? Ya marqué los que activaste en la página; ajusta y toca Listo.' : '¿Qué bloques te interesan? Marca los que quieras y toca Listo. El Núcleo (seguridad y accesos) va siempre.'], 'bloques');
                  }}
                >
                  {TAMANO_TXT[t]}
                </button>
              ))}
            </div>
          )}
          {paso === 'bloques' && (
            <>
              <div className="opciones">
                {BLOQUES.filter((b) => !b.fijo).map((b) => (
                  <button key={b.id} type="button" aria-pressed={sel.includes(b.id)} className={`opcion multi m-${b.c}`} onClick={() => alternar(b.id)}>
                    {b.n}
                  </button>
                ))}
                <button
                  type="button"
                  className="opcion listo"
                  onClick={() => decir(modulos.length ? `Me interesan: ${modulos.map((m) => bloque(m).n).join(', ')}` : 'Por ahora solo el Núcleo', ['¿Tu centro ya tiene sitio web?'], 'sitio')}
                >
                  Listo
                </button>
              </div>
              {msg && (
                <span className="sub" role="status">
                  {msg}
                </span>
              )}
            </>
          )}
          {paso === 'sitio' && (
            <div className="opciones">
              {SITIO.map((s) => (
                <button
                  key={s.v}
                  type="button"
                  className="opcion"
                  onClick={() => {
                    setSitio(s.v);
                    decir(s.l, ['¿Cómo te imaginas el estilo? Puede ser uno de los ejemplos o uno propio de tu centro.'], 'estilo');
                  }}
                >
                  {s.l}
                </button>
              ))}
            </div>
          )}
          {paso === 'estilo' && (
            <div className="opciones">
              {ESTILO.map((s) => (
                <button
                  key={s.v}
                  type="button"
                  className="opcion"
                  onClick={() => {
                    setEstilo(s.v);
                    decir(s.l, ['Último paso: ¿cómo te contactamos?'], 'datos');
                  }}
                >
                  {s.l}
                </button>
              ))}
            </div>
          )}
          {paso === 'datos' && (
            <form className="datos" onSubmit={enviar} noValidate>
              <div className="datos-campos">
                {campo('nombre', 'Tu nombre', 'text', 'name')}
                {campo('centro', 'Centro', 'text', 'organization')}
                {campo('comuna', 'Comuna', 'text', 'address-level2')}
                {campo('correo', 'Correo', 'email', 'email')}
                {campo('telefono', 'Teléfono', 'tel', 'tel', true)}
              </div>
              {/* Trampa para bots: oculta para las personas y para los lectores de pantalla. */}
              <div className="trampa" aria-hidden="true">
                <label>
                  No llenar
                  <input type="text" name={TRAMPA} tabIndex={-1} autoComplete="off" defaultValue="" />
                </label>
              </div>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <button type="submit" className="boton-marca" disabled={enviando}>
                {enviando ? 'Enviando...' : 'Enviar solicitud'}
              </button>
            </form>
          )}
          {paso === 'fin' && (
            <>
              <ol className="linea-tiempo">
                {PROCESO.slice(0, 4).map(([l], i) => (
                  <li key={l} className={i === 0 ? 'hecho' : ''}>
                    <strong>
                      {i + 1}. {l}
                    </strong>
                    <span>{i === 0 ? 'Hecho' : i === 1 ? 'Siguiente' : 'Después'}</span>
                  </li>
                ))}
              </ol>
              <button type="button" className="boton-claro" onClick={reiniciar}>
                Empezar de nuevo
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
