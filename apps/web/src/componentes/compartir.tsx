'use client';

import { useState } from 'react';

/**
 * Enlace al formulario de solicitud para que el operador lo comparta con un
 * centro. Es una pagina aparte dentro de la landing (`/solicitud`), con la
 * misma API de solicitud; los modulos los elige el centro ahi. La solicitud
 * llega con origen "enlace".
 */
export function CompartirFormulario({ sitioUrl, lateral = false }: { sitioUrl: string; lateral?: boolean }) {
  const [abierto, setAbierto] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const url = `${sitioUrl}/solicitud`;

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
        Envia este enlace al centro: abre el formulario de solicitud y el centro elige sus modulos. Lo que complete llega aqui como solicitud nueva (origen: enlace). No pidas datos de pacientes.
      </p>
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
