'use client';

import { useState } from 'react';

import { Conversemos } from './conversemos';
import {
  ACENTOS,
  activar,
  bloque,
  BLOQUES,
  DEMO_URL,
  desactivar,
  ESTILOS,
  type IdBloque,
  type IdEstilo,
  opcional,
  PROCESO,
  ROLES,
  type Rol,
  SEGURIDAD,
  textoRequisito,
  tonoChip,
} from './datos';

/*
 * Landing por bloques (CONTEXTO.md seccion 9; boceto system-reference/Landing).
 * Una sola seleccion de bloques para toda la pagina: el tablero del inicio, la
 * explicacion, el selector y la conversacion final la comparten, y es la que
 * llega como modulos_interes en la solicitud.
 */

type Tema = 'vinculos' | IdEstilo | 'propio';
const NOMBRE_TEMA: Record<Tema, string> = { vinculos: 'Vinculos', moderno: 'Moderno', cuaderno: 'Cuaderno', editorial: 'Editorial', propio: 'de tu centro (ejemplo)' };
const TABLERO: IdBloque[] = ['FICHAS', 'AGENDA', 'EQUIPO', 'MATCH', 'NUCLEO', 'PAGINA_PUBLICA'];

function Captura({ id, compacta = false }: { id: IdBloque; compacta?: boolean }) {
  const b = bloque(id);
  return (
    <div className={`captura m-${b.c}${compacta ? ' compacta' : ''}`} aria-label={`Ejemplo con datos ficticios: ${b.cap.t}`}>
      <div className="captura-barra">
        <span aria-hidden="true" />
        <span aria-hidden="true" />
        <span aria-hidden="true" />
        <strong>{b.cap.t}</strong>
      </div>
      <div className="captura-filas">
        {b.cap.filas.map(([a, x, c]) => (
          <div key={a + x} className="captura-fila">
            <strong>{a}</strong>
            <span>{x}</span>
            <span className={`chip ${tonoChip(c)}`}>{c}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Landing() {
  const [sel, setSel] = useState<IdBloque[]>(['NUCLEO', 'FICHAS', 'AGENDA', 'EQUIPO']);
  const [msg, setMsg] = useState('');
  const [ver, setVer] = useState<IdBloque>('AGENDA');
  const [rolId, setRolId] = useState<Rol['id']>('admin');
  const [mom, setMom] = useState(0);
  const [tema, setTema] = useState<Tema>('vinculos');
  const [acento, setAcento] = useState<(typeof ACENTOS)[number]['id']>('coral');

  const alternar = (id: IdBloque) => {
    const r = sel.includes(id) ? desactivar(sel, id) : activar(sel, id);
    setSel(r.sel);
    setMsg(r.msg);
  };
  const rol = ROLES.find((r) => r.id === rolId) ?? ROLES[0];
  const momento = rol.momentos[mom] ?? rol.momentos[0];
  const d = bloque(ver);
  const dOn = sel.includes(ver);
  const verBloque = (id: IdBloque) => {
    setVer(id);
    document.getElementById('bloques')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className={`raiz${tema === 'propio' ? ` acento-${acento}` : ''}`} data-tema={tema}>
      {tema !== 'vinculos' && (
        <div className="aviso-tema" role="status">
          <span>
            Estás viendo esta página con el estilo <strong>{NOMBRE_TEMA[tema]}</strong>. Así se vería el sitio de tu centro.
          </span>
          <button type="button" className="boton-claro" onClick={() => setTema('vinculos')}>
            Volver al estilo de Vinculos
          </button>
        </div>
      )}
      <div className="contenido">
        <header className="cabecera">
          <a href="#inicio" className="logo">
            <span aria-hidden="true" className="logo-bloques">
              <span />
              <span />
              <span />
              <span />
            </span>
            Vinculos
          </a>
          <nav aria-label="Principal" className="nav">
            <a href="#dia">Un día en tu centro</a>
            <a href="#bloques">Bloques</a>
            <a href="#estilos">Estilos</a>
            <a href="#confianza">Cómo trabajamos</a>
            <a href={DEMO_URL} target="_blank" rel="noopener">
              Demo
            </a>
          </nav>
          <a href="#conversemos" className="boton-tinta">
            Conversemos
          </a>
        </header>

        {/* 1. Inicio: el tablero de bloques */}
        <section id="inicio" className="inicio">
          <div className="inicio-texto">
            <span className="kicker">Plataforma modular para centros de psicología</span>
            <h1>Tu plataforma se arma por vínculos.</h1>
            <p className="lead">Fichas, agenda, equipo, match y el sitio de tu centro en un solo lugar. Activa solo los bloques que tu centro necesita: cada uno funciona por sí solo y se conecta con los demás.</p>
            <div className="acciones">
              <a href="#dia" className="boton-marca">
                Ver cómo funciona
              </a>
              <a href={DEMO_URL} target="_blank" rel="noopener" className="boton-borde">
                Ver demo en vivo
              </a>
            </div>
            <ul className="puntos">
              <li>Cada centro vive en su propio espacio, separado de los demás</li>
              <li>La ficha clínica solo la ve el profesional tratante</li>
              <li>Sin informático en tu centro: nosotros lo mantenemos</li>
            </ul>
          </div>
          <div className="hoja tablero-panel">
            <div className="tablero-cabeza">
              <strong>Arma tu plataforma</strong>
              <span>
                {sel.length} de {BLOQUES.length} bloques activos
              </span>
            </div>
            <div className="tablero">
              {TABLERO.map((id) => {
                const b = bloque(id);
                const on = sel.includes(id);
                const falta = !on && textoRequisito(id, true).startsWith('Necesita');
                return (
                  <button key={id} type="button" aria-pressed={on} onClick={() => alternar(id)} className={`pieza m-${b.c}${on ? ' on' : ''}${falta ? ' atenuada' : ''}`}>
                    <span className="pieza-estado">{b.fijo ? 'Siempre incluido' : on ? 'Incluido' : 'Agregar'}</span>
                    <span>
                      <strong>{b.n}</strong>
                      <span className="pieza-t">{b.t}</span>
                    </span>
                    <span className="pieza-req">{textoRequisito(id, true)}</span>
                  </button>
                );
              })}
            </div>
            <p className="mensaje" role="status" aria-live="polite">
              {msg}
            </p>
          </div>
        </section>

        {/* 2. Un dia en tu centro */}
        <section id="dia" className="seccion">
          <div className="seccion-cabeza">
            <span className="kicker">Un día en tu centro</span>
            <h2>Sin planillas ni choques de horario.</h2>
            <p>Elige desde qué lado quieres mirarlo y te mostramos cómo cambia la rutina de cada persona.</p>
          </div>
          <div role="tablist" aria-label="Elige un rol" className="roles">
            {ROLES.map((r, i) => (
              <button
                key={r.id}
                type="button"
                role="tab"
                aria-selected={r.id === rolId}
                className={`postit rol pi-${i}`}
                onClick={() => {
                  setRolId(r.id);
                  setMom(0);
                }}
              >
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d={r.icono} />
                </svg>
                <strong>{r.l}</strong>
                <span>{r.d}</span>
              </button>
            ))}
          </div>
          <h3>{rol.titulo}</h3>
          <div className="dia">
            <ol className="momentos">
              {rol.momentos.map(([hora, l, id], i) => {
                const b = bloque(id);
                return (
                  <li key={hora + l} className={`m-${b.c}`}>
                    <span className="hora">{hora}</span>
                    <span aria-hidden="true" className={`punto${i === mom ? ' on' : ''}`} />
                    <button type="button" aria-pressed={i === mom} onClick={() => setMom(i)} className="momento">
                      <span>{l}</span>
                      <span className="momento-bloque">{b.t}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
            <div className="vista">
              <Captura id={momento[2]} />
              <div className="vista-pie">
                <span>
                  Lo hace posible el bloque <strong>{bloque(momento[2]).t}</strong>.
                </span>
                <button type="button" className="boton-borde chico" onClick={() => verBloque(momento[2])}>
                  Ver cómo funciona
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* 3. Cada bloque, explicado */}
        <section id="bloques" className="seccion">
          <div className="seccion-cabeza fila">
            <div>
              <span className="kicker">Cada bloque, explicado</span>
              <h2>Mira cómo funciona cada pieza antes de decidir.</h2>
            </div>
            <p>Qué problema resuelve, quién lo usa, el flujo paso a paso y cómo se ve en la plataforma.</p>
          </div>
          <div className="explicacion">
            <div role="tablist" aria-orientation="vertical" aria-label="Bloques" className="lista-bloques">
              {BLOQUES.map((b) => (
                <button key={b.id} type="button" role="tab" aria-selected={b.id === ver} onClick={() => setVer(b.id)} className={`tab-bloque m-${b.c}`}>
                  <span aria-hidden="true" className="tab-color" />
                  <span>{b.t}</span>
                  <span className="tab-estado">{sel.includes(b.id) ? 'Incluido' : ''}</span>
                </button>
              ))}
            </div>
            <article className={`hoja detalle m-${d.c}`} role="tabpanel">
              <div className="detalle-cabeza">
                <span aria-hidden="true" className="detalle-color" />
                <div>
                  <h3>{d.t}</h3>
                  <div className="etiquetas">
                    {d.quien.map((q) => (
                      <span key={q}>{q}</span>
                    ))}
                  </div>
                </div>
                <button type="button" className={dOn ? 'boton-claro' : 'boton-marca chico'} onClick={() => alternar(ver)} disabled={d.fijo}>
                  {d.fijo ? 'Incluido siempre' : dOn ? 'Quitar de mi plataforma' : 'Agregar a mi plataforma'}
                </button>
              </div>
              <div className="detalle-dos">
                <div>
                  <span className="rotulo">El problema hoy</span>
                  <p>{d.problema}</p>
                </div>
                <div>
                  <span className="rotulo">Con Vinculos</span>
                  <p>{d.corto}</p>
                  <p className="sub">{textoRequisito(ver)}</p>
                  {opcional(ver).length > 0 && <p className="sub">Se potencia con: {opcional(ver).map((m) => bloque(m).n).join(', ')}.</p>}
                </div>
              </div>
              <div>
                <h4>El flujo</h4>
                <ol className="pasos">
                  {d.pasos.map((p, i) => (
                    <li key={p}>
                      <span>{i + 1}</span>
                      {p}
                    </li>
                  ))}
                </ol>
              </div>
              <div>
                <h4>Así se ve</h4>
                <Captura id={ver} compacta />
                <p className="sub">Ejemplo con datos ficticios.</p>
              </div>
            </article>
          </div>
        </section>

        {/* 4. Seleccion de bloques */}
        <section id="seleccion" className="seccion">
          <div className="seccion-cabeza fila">
            <h2>Cada uno funciona solo. Juntos, se potencian.</h2>
            <div className="contador">
              Te interesan {sel.length} de {BLOQUES.length} bloques
            </div>
          </div>
          <p className="mensaje" role="status" aria-live="polite">
            {msg}
          </p>
          <div className="selector">
            {BLOQUES.map((b, i) => {
              const on = sel.includes(b.id);
              return (
                <button key={b.id} type="button" role="switch" aria-checked={on} onClick={() => alternar(b.id)} className={`postit interruptor m-${b.c} pi-${(i + 2) % 5}${on ? ' on' : ''}`}>
                  <span aria-hidden="true" className="tab-color" />
                  <span className="interruptor-texto">
                    <strong>{b.t}</strong>
                    <span>{textoRequisito(b.id, true)}</span>
                  </span>
                  <span aria-hidden="true" className="pista">
                    <span />
                  </span>
                </button>
              );
            })}
          </div>
          <div className="centrado">
            <a href="#conversemos" className="boton-marca">
              Conversemos con esta selección
            </a>
          </div>
        </section>

        {/* 5. Con la cara de tu centro */}
        <section id="estilos" className="seccion">
          <div className="seccion-cabeza fila">
            <div>
              <span className="kicker">Con la cara de tu centro</span>
              <h2>Nos adaptamos a tu centro, no al revés.</h2>
            </div>
            <p>Estos son ejemplos de lo que podemos hacer. Tomamos los colores, la tipografía, el logo y el tono de tu centro, y la plataforma funciona igual.</p>
          </div>
          <div className="estilos">
            {ESTILOS.map((e) => {
              const on = tema === e.id;
              return (
                <div key={e.id} className="estilo" data-tema={e.id}>
                  <div className="estilo-muestra">
                    <strong className="estilo-hola">Hola de nuevo.</strong>
                    <div className="estilo-tarjeta">
                      <span aria-hidden="true" className="estilo-avatar" />
                      <span>
                        <strong>Ps. Camila Rojas</strong>
                        Ansiedad · adultos
                      </span>
                    </div>
                    <span className="estilo-boton">Pedir una hora</span>
                  </div>
                  <span className="estilo-texto">
                    <span className="rotulo">Ejemplo</span>
                    <strong>{e.n}</strong>
                    <span>{e.d}</span>
                  </span>
                  <button type="button" aria-pressed={on} className={on ? 'boton-tinta' : 'boton-borde'} onClick={() => setTema(on ? 'vinculos' : e.id)}>
                    {on ? 'Viendo este estilo' : 'Ver la página así'}
                  </button>
                </div>
              );
            })}
            <div className={`estilo propio${tema === 'propio' ? ' on' : ''}`}>
              <div className="estilo-muestra">
                <strong>El estilo de tu centro</strong>
                <span>Prueba con un color propio. En la reunión definimos tu logo, tus colores y tu tipografía.</span>
                <div role="group" aria-label="Color de ejemplo para tu centro" className="acentos">
                  {ACENTOS.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      aria-pressed={tema === 'propio' && acento === a.id}
                      aria-label={`Probar con color ${a.l}`}
                      className={`acento acento-${a.id}`}
                      onClick={() => {
                        setTema('propio');
                        setAcento(a.id);
                      }}
                    />
                  ))}
                </div>
              </div>
              <span className="estilo-texto">
                <span className="rotulo">A medida</span>
                <strong>Cuéntanos cómo es tu centro</strong>
                <span>Si ya tienen web, la integramos.</span>
              </span>
              <a href="#conversemos" className="boton-borde">
                Conversemos sobre tu estilo
              </a>
            </div>
          </div>
        </section>

        {/* 6. Como trabajamos y seguridad */}
        <section id="confianza" className="seccion confianza">
          <div>
            <span className="kicker">Cómo trabajamos</span>
            <h2>Te acompañamos de principio a fin.</h2>
            <ol className="proceso">
              {PROCESO.map(([l, x], i) => (
                <li key={l} className={`postit pi-${(i + 1) % 5}`}>
                  <span className="proceso-n">0{i + 1}</span>
                  <span>
                    <strong>{l}</strong>
                    <span>{x}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
          <div className="nota">
            <span className="rotulo">Seguridad</span>
            <h2>Lo clínico se queda donde corresponde.</h2>
            <div className="seguridad">
              {SEGURIDAD.map(([l, x]) => (
                <div key={l}>
                  <strong>{l}</strong>
                  <span>{x}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 7. Conversemos: la solicitud */}
        <Conversemos sel={sel} alternar={alternar} msg={msg} via="landing" />

        <footer className="pie">
          <strong>Vinculos</strong>
          <span>Tu plataforma se arma por vínculos</span>
          <span className="pie-legal">Privacidad · Términos · Tratamiento de datos</span>
        </footer>
      </div>
    </div>
  );
}
