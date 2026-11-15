'use client';

import { useState } from 'react';

import { Conversemos } from '../conversemos';
import { activar, desactivar, type IdBloque } from '../datos';

/**
 * Formulario de solicitud aparte (el enlace que comparte el operador desde la
 * consola). Misma conversacion y misma API que la landing, sin bloques
 * marcados: el centro los elige. Llega con origen "enlace".
 */
export function FormularioSolicitud() {
  const [sel, setSel] = useState<IdBloque[]>(['NUCLEO']);
  const [msg, setMsg] = useState('');
  const alternar = (id: IdBloque) => {
    const r = sel.includes(id) ? desactivar(sel, id) : activar(sel, id);
    setSel(r.sel);
    setMsg(r.msg);
  };
  return <Conversemos sel={sel} alternar={alternar} msg={msg} via="enlace" />;
}
