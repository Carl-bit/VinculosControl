'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

/**
 * Reemplazo de <select> con el estilo del sitio (nunca el popup nativo del
 * navegador). Para formularios no controlados: lleva un campo oculto con
 * `name`, asi FormData lo lee igual que un <select>. Navegable con teclado.
 */
export function Selector({
  name,
  opciones,
  defaultValue = '',
  placeholder = 'Elige una opcion',
  required,
  invalido,
}: {
  name: string;
  opciones: { valor: string; etiqueta: string }[];
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  invalido?: boolean;
}) {
  const [valor, setValor] = useState(defaultValue);
  const [abierto, setAbierto] = useState(false);
  const actual = opciones.findIndex((o) => o.valor === valor);
  const [activa, setActiva] = useState(Math.max(0, actual));
  const raiz = useRef<HTMLDivElement>(null);
  const lista = useRef<HTMLUListElement>(null);
  const id = useId();

  useEffect(() => {
    if (!abierto) return;
    setActiva(Math.max(0, actual));
    lista.current?.focus();
    const fuera = (e: PointerEvent) => {
      if (raiz.current && !raiz.current.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener('pointerdown', fuera);
    return () => document.removeEventListener('pointerdown', fuera);
  }, [abierto, actual]);
  useEffect(() => {
    lista.current?.querySelector(`[data-i="${activa}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [activa]);

  const boton = () => raiz.current?.querySelector('button');
  const elegir = (i: number) => {
    const o = opciones[i];
    if (o) setValor(o.valor);
    setAbierto(false);
    boton()?.focus();
  };
  const tecla = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') setActiva((i) => Math.min(opciones.length - 1, i + 1));
    else if (e.key === 'ArrowUp') setActiva((i) => Math.max(0, i - 1));
    else if (e.key === 'Enter' || e.key === ' ') elegir(activa);
    else if (e.key === 'Escape') {
      setAbierto(false);
      boton()?.focus();
    } else if (e.key === 'Tab') return setAbierto(false);
    else return;
    e.preventDefault();
  };

  return (
    <div ref={raiz} className="selector">
      <button
        type="button"
        className="selector-boton"
        aria-haspopup="listbox"
        aria-expanded={abierto}
        aria-controls={id}
        aria-invalid={invalido}
        onClick={() => setAbierto((a) => !a)}
        onKeyDown={(e) => {
          if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
            e.preventDefault();
            setAbierto(true);
          }
        }}
      >
        <span className={actual < 0 ? 'selector-vacio' : undefined}>{actual < 0 ? placeholder : opciones[actual].etiqueta}</span>
        <span aria-hidden="true" className="selector-flecha">
          ▾
        </span>
      </button>
      {/* Lo lee FormData; `required` bloquea el envio si queda vacio. */}
      <input className="selector-oculto" name={name} value={valor} required={required} tabIndex={-1} aria-hidden="true" onChange={() => undefined} />
      {abierto && (
        <ul
          ref={lista}
          id={id}
          role="listbox"
          tabIndex={-1}
          className="selector-lista"
          aria-activedescendant={`${id}-${activa}`}
          onKeyDown={tecla}
          // Dentro de un <label>, un clic aqui reactivaria el boton.
          onClick={(e) => e.preventDefault()}
        >
          {opciones.map((o, i) => (
            <li
              key={o.valor}
              id={`${id}-${i}`}
              data-i={i}
              role="option"
              aria-selected={o.valor === valor}
              data-activa={i === activa}
              onPointerEnter={() => setActiva(i)}
              onClick={() => elegir(i)}
            >
              {o.etiqueta}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
