'use client';

import { useState } from 'react';

/* Modulos del MVP (sin COBROS ni WHATSAPP); MATCH y PAGINA_PUBLICA traen EQUIPO solos en el formulario. */
const MODULOS = [
  { v: 'FICHAS', l: 'Fichas' },
  { v: 'AGENDA', l: 'Agenda' },
  { v: 'EQUIPO', l: 'Equipo' },
  { v: 'MATCH', l: 'Match' },
  { v: 'PAGINA_PUBLICA', l: 'Pagina publica' },
];

/**
 * Enlace al formulario de solicitud (el mismo del final del landing) para que
 * el operador lo comparta directo con un centro. Puede precargar modulos; la
 * solicitud llega marcada con origen "enlace".
 */
export function CompartirFormulario({ sitioUrl, lateral = false }: { sitioUrl: string; lateral?: boolean }) {
  const [abierto, setAbierto] = useState(false);
  const [sel, setSel] = useState<string[]>([]);
  const [copiado, setCopiado] = useState(false);
  const url = `${sitioUrl}/solicitud?via=enlace${sel.length ? `&modulos=${sel.join(',')}` : ''}`;

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      setCopiado(false);
    }
  };

  if (!abierto)
    return lateral ? (
      <button type="button" className="compartir-lateral" onClick={() => setAbierto(true)}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M8.6 13.5l6.8 4 M15.4 6.5l-6.8 4" />
        </svg>
        Compartir solicitud
      </button>
    ) : (
      <div className="acciones">
        <button type="button" className="boton" onClick={() => setAbierto(true)}>
          Compartir formulario de solicitud
        </button>
      </div>
    );

  return (
    <section className={`panel${lateral ? ' compartir-flotante' : ''}`} aria-label="Compartir formulario">
      <h2>Compartir formulario</h2>
      <p className="sub" style={{ marginTop: 0 }}>
        Envia este enlace al centro. Lo que complete llega aqui como solicitud nueva (origen: enlace). No pidas datos de pacientes.
      </p>
      <div className="filtros" role="group" aria-label="Precargar modulos">
        {MODULOS.map((m) => (
          <button
            key={m.v}
            type="button"
            className="boton"
            aria-pressed={sel.includes(m.v)}
            onClick={() => setSel((s) => (s.includes(m.v) ? s.filter((x) => x !== m.v) : [...s, m.v]))}
          >
            {m.l}
          </button>
        ))}
      </div>
      <div className="acciones" style={{ marginTop: 10 }}>
        <input className="campo-texto" readOnly value={url} aria-label="Enlace al formulario" onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className="boton primario" onClick={() => void copiar()}>
          {copiado ? 'Copiado' : 'Copiar'}
        </button>
        <a className="boton" href={url} target="_blank" rel="noreferrer">
          Abrir
        </a>
        <button type="button" className="boton" onClick={() => setAbierto(false)}>
          Cerrar
        </button>
      </div>
    </section>
  );
}
