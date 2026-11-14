'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

/*
 * Controles de formulario de la consola con el estilo de la plataforma. Regla:
 * ningun selector usa el popup nativo del navegador (<select>, calendario de
 * <input type="date">, flechas de <input type="number">): se usan estos.
 */

/** Dentro de un <label>, un clic en texto del popover activaria el control: se cancela. */
const sinEtiqueta = (e: { preventDefault: () => void }) => e.preventDefault();

/** Cierra un popover al hacer clic fuera o con Esc. */
function usePopover() {
  const [abierto, setAbierto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: PointerEvent) => {
      if (raiz.current && !raiz.current.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener('pointerdown', fuera);
    return () => document.removeEventListener('pointerdown', fuera);
  }, [abierto]);
  return { abierto, setAbierto, raiz };
}

export interface Opcion {
  valor: string;
  etiqueta: ReactNode;
}

/** Reemplazo de <select>: boton + lista (role listbox), navegable con teclado. */
export function Selector({
  valor,
  opciones,
  onCambio,
  disabled,
  etiqueta,
  className = '',
}: {
  valor: string;
  opciones: Opcion[];
  onCambio: (v: string) => void;
  disabled?: boolean;
  /** Nombre accesible si el selector no esta dentro de un <label> con texto. */
  etiqueta?: string;
  className?: string;
}) {
  const { abierto, setAbierto, raiz } = usePopover();
  const id = useId();
  const actual = Math.max(
    0,
    opciones.findIndex((o) => o.valor === valor),
  );
  const [activa, setActiva] = useState(actual);
  const lista = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (abierto) {
      setActiva(actual);
      lista.current?.focus();
    }
  }, [abierto, actual]);
  useEffect(() => {
    lista.current?.querySelector(`[data-i="${activa}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [activa]);

  const elegir = (i: number) => {
    const o = opciones[i];
    if (o) onCambio(o.valor);
    setAbierto(false);
    raiz.current?.querySelector('button')?.focus();
  };
  const teclaBoton = (e: KeyboardEvent) => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
      e.preventDefault();
      setAbierto(true);
    }
  };
  const teclaLista = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') setActiva((i) => Math.min(opciones.length - 1, i + 1));
    else if (e.key === 'ArrowUp') setActiva((i) => Math.max(0, i - 1));
    else if (e.key === 'Home') setActiva(0);
    else if (e.key === 'End') setActiva(opciones.length - 1);
    else if (e.key === 'Enter' || e.key === ' ') elegir(activa);
    else if (e.key === 'Escape' || e.key === 'Tab') {
      setAbierto(false);
      if (e.key === 'Escape') raiz.current?.querySelector('button')?.focus();
      if (e.key === 'Tab') return;
    } else return;
    e.preventDefault();
  };

  return (
    <div ref={raiz} className={`control ${className}`}>
      <button
        type="button"
        className="campo-texto control-boton"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={abierto}
        aria-controls={id}
        aria-label={etiqueta}
        onClick={() => setAbierto((a) => !a)}
        onKeyDown={teclaBoton}
      >
        <span className="control-valor">{opciones[actual]?.etiqueta ?? '-'}</span>
        <span className="control-flecha" aria-hidden="true">
          ▾
        </span>
      </button>
      {abierto && (
        <ul ref={lista} id={id} role="listbox" tabIndex={-1} className="popover lista-opciones" aria-activedescendant={`${id}-${activa}`} onKeyDown={teclaLista} onClick={sinEtiqueta}>
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

/** Reemplazo de <input type="number">: campo de texto numerico con botones - y + propios. */
export function CampoNumero({
  valor,
  onCambio,
  min,
  max,
  paso = 1,
  placeholder,
  disabled,
  requerido,
  etiqueta,
}: {
  valor: number | undefined;
  onCambio: (v: number | undefined) => void;
  min?: number;
  max?: number;
  paso?: number;
  placeholder?: string;
  disabled?: boolean;
  requerido?: boolean;
  etiqueta?: string;
}) {
  const [texto, setTexto] = useState(valor === undefined ? '' : String(valor));
  useEffect(() => setTexto(valor === undefined ? '' : String(valor)), [valor]);
  const decimales = String(paso).split('.')[1]?.length ?? 0;
  const acotar = (n: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, Number(n.toFixed(decimales))));
  const mover = (dir: 1 | -1) => {
    const base = valor ?? (placeholder !== undefined && placeholder !== '' && !Number.isNaN(Number(placeholder)) ? Number(placeholder) : (min ?? 0));
    onCambio(acotar(base + dir * paso));
  };
  return (
    <div className="control campo-numero">
      <input
        className="campo-texto"
        inputMode={decimales ? 'decimal' : 'numeric'}
        value={texto}
        placeholder={placeholder}
        disabled={disabled}
        required={requerido}
        aria-label={etiqueta}
        aria-valuemin={min}
        aria-valuemax={max}
        role="spinbutton"
        aria-valuenow={valor}
        onChange={(e) => {
          const t = e.target.value.replace(',', '.');
          if (!/^-?\d*\.?\d*$/.test(t)) return;
          setTexto(t);
          if (t === '' || t === '-' || t === '.') onCambio(undefined);
          else onCambio(Number(t));
        }}
        onBlur={() => {
          if (valor !== undefined && acotar(valor) !== valor) onCambio(acotar(valor));
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            mover(e.key === 'ArrowUp' ? 1 : -1);
          }
        }}
      />
      <button type="button" className="paso-numero restar" tabIndex={-1} disabled={disabled || (valor !== undefined && min !== undefined && valor <= min)} aria-label="Restar" onClick={() => mover(-1)}>
        −
      </button>
      <button type="button" className="paso-numero" tabIndex={-1} disabled={disabled || (valor !== undefined && max !== undefined && valor >= max)} aria-label="Sumar" onClick={() => mover(1)}>
        +
      </button>
    </div>
  );
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = ['lu', 'ma', 'mi', 'ju', 'vi', 'sa', 'do'];
const dos = (n: number) => String(n).padStart(2, '0');
const iso = (a: number, m: number, d: number) => `${a}-${dos(m + 1)}-${dos(d)}`;

/** Calendario de un mes (lunes primero). `valor` en YYYY-MM-DD. */
function Calendario({ valor, onElegir }: { valor: string; onElegir: (v: string) => void }) {
  const hoy = new Date();
  const [a0, m0] = valor ? valor.split('-').map(Number) : [hoy.getFullYear(), hoy.getMonth() + 1];
  const [vista, setVista] = useState({ a: a0, m: m0 - 1 });
  const primero = (new Date(vista.a, vista.m, 1).getDay() + 6) % 7;
  const dias = new Date(vista.a, vista.m + 1, 0).getDate();
  const celdas: (number | null)[] = [...Array(primero).fill(null), ...Array.from({ length: dias }, (_, i) => i + 1)];
  const hoyIso = iso(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  const mover = (d: number) => setVista(({ a, m }) => ({ a: a + Math.floor((m + d) / 12), m: (((m + d) % 12) + 12) % 12 }));
  return (
    <div className="calendario">
      <div className="calendario-cabecera">
        <button type="button" className="boton" aria-label="Mes anterior" onClick={() => mover(-1)}>
          ‹
        </button>
        <span>
          {MESES[vista.m]} {vista.a}
        </span>
        <button type="button" className="boton" aria-label="Mes siguiente" onClick={() => mover(1)}>
          ›
        </button>
      </div>
      <div className="calendario-rejilla" role="grid">
        {DIAS.map((d) => (
          <span key={d} className="calendario-dia-semana">
            {d}
          </span>
        ))}
        {celdas.map((d, i) =>
          d === null ? (
            <span key={`v${i}`} />
          ) : (
            <button
              key={d}
              type="button"
              className="calendario-dia"
              aria-pressed={iso(vista.a, vista.m, d) === valor}
              data-hoy={iso(vista.a, vista.m, d) === hoyIso}
              onClick={() => onElegir(iso(vista.a, vista.m, d))}
            >
              {d}
            </button>
          ),
        )}
      </div>
      <button type="button" className="enlace" onClick={() => onElegir(hoyIso)}>
        hoy
      </button>
    </div>
  );
}

const legible = (v: string) => {
  const [a, m, d] = v.split('-').map(Number);
  return a ? `${dos(d)}-${dos(m)}-${a}` : '';
};

/** Reemplazo de <input type="date">. `valor` y `onCambio` en YYYY-MM-DD ('' = vacio). */
export function CampoFecha({ valor, onCambio, disabled, etiqueta, requerido }: { valor: string; onCambio: (v: string) => void; disabled?: boolean; etiqueta?: string; requerido?: boolean }) {
  const { abierto, setAbierto, raiz } = usePopover();
  return (
    <div ref={raiz} className="control" onKeyDown={(e) => e.key === 'Escape' && abierto && (e.stopPropagation(), setAbierto(false))}>
      <button type="button" className="campo-texto control-boton" disabled={disabled} aria-haspopup="dialog" aria-expanded={abierto} aria-label={etiqueta} onClick={() => setAbierto((a) => !a)}>
        <span className={`control-valor ${valor ? '' : 'control-vacio'}`}>{valor ? legible(valor) : 'dd-mm-aaaa'}</span>
        <span className="control-flecha" aria-hidden="true">
          ▦
        </span>
      </button>
      {requerido && <input className="control-requerido" tabIndex={-1} aria-hidden="true" required value={valor} onChange={() => undefined} />}
      {abierto && (
        <div className="popover" onClick={sinEtiqueta} role="dialog" aria-label={etiqueta ?? 'Elegir fecha'}>
          <Calendario
            valor={valor}
            onElegir={(v) => {
              onCambio(v);
              setAbierto(false);
            }}
          />
        </div>
      )}
    </div>
  );
}

/** Reemplazo de <input type="datetime-local">. `valor` en YYYY-MM-DDTHH:mm (hora local). */
export function CampoFechaHora({ valor, onCambio, disabled, etiqueta, requerido }: { valor: string; onCambio: (v: string) => void; disabled?: boolean; etiqueta?: string; requerido?: boolean }) {
  const { abierto, setAbierto, raiz } = usePopover();
  const [fecha = '', hora = ''] = valor.split('T');
  const [h, m] = hora ? hora.split(':') : ['09', '00'];
  const armar = (f: string, hh: string, mm: string) => onCambio(f ? `${f}T${hh}:${mm}` : '');
  return (
    <div ref={raiz} className="control" onKeyDown={(e) => e.key === 'Escape' && abierto && (e.stopPropagation(), setAbierto(false))}>
      <button type="button" className="campo-texto control-boton" disabled={disabled} aria-haspopup="dialog" aria-expanded={abierto} aria-label={etiqueta} onClick={() => setAbierto((a) => !a)}>
        <span className={`control-valor ${valor ? '' : 'control-vacio'}`}>{valor ? `${legible(fecha)} ${h}:${m}` : 'dd-mm-aaaa hh:mm'}</span>
        <span className="control-flecha" aria-hidden="true">
          ▦
        </span>
      </button>
      {requerido && <input className="control-requerido" tabIndex={-1} aria-hidden="true" required value={valor} onChange={() => undefined} />}
      {abierto && (
        <div className="popover" onClick={sinEtiqueta} role="dialog" aria-label={etiqueta ?? 'Elegir fecha y hora'}>
          <Calendario valor={fecha} onElegir={(f) => armar(f, h, m)} />
          <div className="calendario-hora">
            <Selector etiqueta="Hora" valor={h} opciones={Array.from({ length: 24 }, (_, i) => ({ valor: dos(i), etiqueta: dos(i) }))} onCambio={(v) => armar(fecha || hoyIso(), v, m)} />
            <span>:</span>
            <Selector etiqueta="Minutos" valor={dos(Math.floor(Number(m) / 5) * 5)} opciones={Array.from({ length: 12 }, (_, i) => ({ valor: dos(i * 5), etiqueta: dos(i * 5) }))} onCambio={(v) => armar(fecha || hoyIso(), h, v)} />
            <button type="button" className="boton primario" onClick={() => setAbierto(false)}>
              Listo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const hoyIso = () => {
  const d = new Date();
  return iso(d.getFullYear(), d.getMonth(), d.getDate());
};
