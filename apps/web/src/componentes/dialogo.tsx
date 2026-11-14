'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Modal de la consola. Regla: todo popup (confirmacion, aviso, pedido de un
 * texto) usa este componente, nunca window.confirm / prompt / alert. Usa
 * <dialog> con showModal(): atrapa el foco, cierra con Esc y deja el fondo
 * inerte. Mientras `ocupado`, no se cierra (la accion esta en vuelo).
 */
export function Dialogo({
  abierto,
  titulo,
  etiqueta,
  ocupado = false,
  onCerrar,
  children,
  pie,
}: {
  abierto: boolean;
  titulo: string;
  /** Linea corta sobre el titulo (ej. "Solicitud de modulo"). */
  etiqueta?: string;
  ocupado?: boolean;
  onCerrar: () => void;
  children: ReactNode;
  /** Botones de accion; van alineados a la derecha. */
  pie: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (abierto && !d.open) d.showModal();
    if (!abierto && d.open) d.close();
  }, [abierto]);

  return (
    <dialog
      ref={ref}
      className="dialogo"
      aria-labelledby="dialogo-titulo"
      onCancel={(e) => {
        e.preventDefault();
        if (!ocupado) onCerrar();
      }}
      onClick={(e) => {
        // Clic en el fondo (fuera de la caja) cierra.
        if (e.target === ref.current && !ocupado) onCerrar();
      }}
    >
      {abierto && (
        <div className="dialogo-caja">
          <header className="dialogo-cabecera">
            {etiqueta && <span className="etiqueta-paso">{etiqueta}</span>}
            <h2 id="dialogo-titulo" className="h2-grande">
              {titulo}
            </h2>
          </header>
          <div className="dialogo-cuerpo">{children}</div>
          <footer className="dialogo-pie">{pie}</footer>
        </div>
      )}
    </dialog>
  );
}

export interface PedidoConfirmacion {
  titulo: string;
  etiqueta?: string;
  /** Que pasa si se confirma. */
  texto: ReactNode;
  boton: string;
  /** Accion destructiva o que corta algo: boton rojo. */
  peligro?: boolean;
  /** Pide un texto (reemplaza window.prompt). */
  campo?: { etiqueta: string; minimo?: number; maximo?: number; ayuda?: string };
}

/**
 * Reemplazo de window.confirm / window.prompt con el modal de la consola:
 *
 *   const [confirmar, dialogo] = useConfirmacion();
 *   if ((await confirmar({ titulo, texto, boton })) === null) return;
 *   ...
 *   return <>{...}{dialogo}</>;
 *
 * Resuelve null si se cancela; '' al confirmar sin campo; el texto si hay campo.
 */
export function useConfirmacion() {
  const [pedido, setPedido] = useState<PedidoConfirmacion & { resolver: (v: string | null) => void }>();
  const [texto, setTexto] = useState('');

  const confirmar = useCallback(
    (p: PedidoConfirmacion) =>
      new Promise<string | null>((resolver) => {
        setTexto('');
        setPedido({ ...p, resolver });
      }),
    [],
  );
  const cerrar = (v: string | null) => {
    pedido?.resolver(v);
    setPedido(undefined);
  };
  const minimo = pedido?.campo?.minimo ?? 0;
  const valido = !pedido?.campo || texto.trim().length >= minimo;
  const aceptar = () => {
    if (valido) cerrar(pedido?.campo ? texto.trim() : '');
  };

  const dialogo = (
    <Dialogo
      abierto={!!pedido}
      etiqueta={pedido?.etiqueta}
      titulo={pedido?.titulo ?? ''}
      onCerrar={() => cerrar(null)}
      pie={
        <>
          <button type="button" className="boton" onClick={() => cerrar(null)}>
            Cancelar
          </button>
          <button type="button" className={`boton ${pedido?.peligro ? 'peligro' : 'primario'}`} disabled={!valido} autoFocus={!pedido?.campo} onClick={aceptar}>
            {pedido?.boton}
          </button>
        </>
      }
    >
      {pedido && (
        <>
          <div className="sub">{pedido.texto}</div>
          {pedido.campo && (
            <label className="campo-consola">
              {pedido.campo.etiqueta}
              <input
                className="campo-texto"
                autoFocus
                maxLength={pedido.campo.maximo ?? 200}
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    aceptar();
                  }
                }}
              />
              {pedido.campo.ayuda && <span className="mono-corto">{pedido.campo.ayuda}</span>}
            </label>
          )}
        </>
      )}
    </Dialogo>
  );
  return [confirmar, dialogo] as const;
}
