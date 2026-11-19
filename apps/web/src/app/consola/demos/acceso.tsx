'use client';

import { useState } from 'react';

import { Dialogo } from '@/componentes/dialogo';

/*
 * Acceso para compartir un demo (decision 2026-11-19): enlace, contrasena
 * comun y cuentas ficticias por rol. Lo reporta el agente en P10; la API lo
 * guarda cifrado, registra cada lectura en la auditoria y lo borra con el demo.
 * Solo demos: nunca credenciales de un centro real.
 */

export interface AccesoDemo {
  url: string | null;
  clave: string;
  cuentas: { rol: string; email: string }[];
  creadoEn: string;
  venceEn: string | null;
}

const ORDEN = ['ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE', 'PACIENTE', 'RESPONSABLE'];

function porRol(cuentas: AccesoDemo['cuentas']) {
  const grupos = new Map<string, string[]>();
  for (const c of cuentas) grupos.set(c.rol, [...(grupos.get(c.rol) ?? []), c.email]);
  const rango = (rol: string) => (ORDEN.includes(rol) ? ORDEN.indexOf(rol) : ORDEN.length);
  return [...grupos.entries()].sort(([a], [b]) => rango(a) - rango(b) || a.localeCompare(b));
}

/** Texto listo para pegar en un correo o chat. */
export function textoAcceso(nombre: string, a: AccesoDemo): string {
  return [
    `Demo ${nombre}${a.venceEn ? ` (disponible hasta ${new Date(a.venceEn).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })})` : ''}`,
    `Entrar en: ${a.url ?? '-'}`,
    `Contrasena de todas las cuentas: ${a.clave}`,
    '',
    ...porRol(a.cuentas).map(([rol, correos]) => `${rol}: ${correos.join(', ')}`),
    '',
    'Datos ficticios. No ingreses datos reales de pacientes.',
  ].join('\n');
}

export function DialogoAcceso({ nombre, acceso, onCerrar }: { nombre: string; acceso: AccesoDemo | null; onCerrar: () => void }) {
  const [copiado, setCopiado] = useState<string>();
  const copiar = (que: string, texto: string) =>
    void navigator.clipboard
      .writeText(texto)
      .then(() => setCopiado(que))
      .catch(() => setCopiado(undefined));
  const cerrar = () => {
    setCopiado(undefined);
    onCerrar();
  };

  return (
    <Dialogo
      abierto={acceso !== null}
      etiqueta={`Demo · ${nombre}`}
      titulo="Acceso para compartir"
      onCerrar={cerrar}
      pie={
        <>
          <button type="button" className="boton" onClick={cerrar}>
            Cerrar
          </button>
          <button type="button" className="boton primario" onClick={() => acceso && copiar('todo', textoAcceso(nombre, acceso))}>
            {copiado === 'todo' ? 'Copiado' : 'Copiar todo'}
          </button>
        </>
      }
    >
      {acceso && (
        <>
          <p className="mono-corto" style={{ marginTop: 0 }}>
            Cuentas ficticias del demo. Se entra solo con correo y contrasena: un demo no pide codigo por correo (ERP con R10, 2026-11-19; un demo creado antes con
            una version anterior lo sigue pidiendo).
          </p>
          <dl className="ficha ficha-corta">
            <dt>Enlace</dt>
            <dd>
              {acceso.url ? (
                <a href={acceso.url} target="_blank" rel="noreferrer">
                  {acceso.url}
                </a>
              ) : (
                '-'
              )}
            </dd>
            <dt>Contrasena</dt>
            <dd>
              <code>{acceso.clave}</code>{' '}
              <button type="button" className="boton" onClick={() => copiar('clave', acceso.clave)}>
                {copiado === 'clave' ? 'Copiada' : 'Copiar'}
              </button>
            </dd>
          </dl>
          <div className="tabla-ancha">
            <table>
              <thead>
                <tr>
                  <th>Rol</th>
                  <th>Correo</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {porRol(acceso.cuentas).flatMap(([rol, correos]) =>
                  correos.map((email) => (
                    <tr key={email}>
                      <td>
                        <span className="chip neu">{rol}</span>
                      </td>
                      <td className="mono-corto" style={{ overflowWrap: 'anywhere' }}>
                        {email}
                      </td>
                      <td>
                        <button type="button" className="boton" onClick={() => copiar(email, email)}>
                          {copiado === email ? 'Copiado' : 'Copiar'}
                        </button>
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Dialogo>
  );
}
