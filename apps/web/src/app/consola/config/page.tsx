'use client';

import { useState } from 'react';

import { Shell } from '@/componentes/piezas';
import { enviarConSesion, hace, mensajeDe, useDatos, type Configuracion, type Resumen } from '@/lib/api';

/** Configuracion (boceto: plazos, seguridad de la consola, correo) + sesiones y cambio de contrasena. */
export default function Config() {
  const { datos: r } = useDatos<Resumen>('consola/resumen', 30_000);
  const { datos: c, error, recargar } = useDatos<Configuracion>('consola/config', 30_000);
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [repetida, setRepetida] = useState('');
  const [msg, setMsg] = useState<{ t: string; ok: boolean }>();

  const accion = async (ruta: string, cuerpo: unknown, exito: string) => {
    setMsg(undefined);
    const res = await enviarConSesion(`consola/config/${ruta}`, cuerpo);
    setMsg(res.ok ? { t: exito, ok: true } : { t: mensajeDe(res.datos, `HTTP ${res.status}`), ok: false });
    await recargar();
    return res.ok;
  };

  const tarjeta = (titulo: string, filas: { k: string; v: string }[] | undefined, extra?: React.ReactNode) => (
    <section className="panel" style={{ flex: '1 1 300px' }}>
      <h2>{titulo}</h2>
      <dl className="ficha ficha-corta">
        {filas?.map((f) => (
          <div key={f.k} style={{ display: 'contents' }}>
            <dt>{f.k}</dt>
            <dd>{f.v}</dd>
          </div>
        ))}
      </dl>
      {extra}
    </section>
  );

  return (
    <Shell resumen={r} titulo="configuracion">
      <div>
        <h1>Configuracion</h1>
        <span className="sub">Parametros del plano de control y del agente (viven en el codigo y en el .env){error && ` · error: ${error}`}</span>
      </div>
      {msg && (
        <p role="status" className={`chip ${msg.ok ? 'ok' : 'danger'}`} style={{ whiteSpace: 'normal' }}>
          {msg.t}
        </p>
      )}
      <div className="dos-columnas">
        {tarjeta('Plazos', c?.plazos)}
        {tarjeta('Seguridad de la consola', c?.seguridad)}
        {tarjeta(
          'Correo',
          c?.correo,
          <div className="acciones" style={{ marginTop: 10 }}>
            <button type="button" className="boton" onClick={() => void accion('correo-prueba', undefined, 'Correo de prueba enviado a tu cuenta')}>
              Enviar prueba
            </button>
          </div>,
        )}
      </div>

      <div className="dos-columnas">
        <section className="panel" style={{ flex: '2 1 480px' }}>
          <h2>Sesiones abiertas</h2>
          <table>
            <thead>
              <tr>
                <th>Operador</th>
                <th>Desde</th>
                <th>Actividad</th>
                <th>IP</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {c?.sesiones.map((s) => (
                <tr key={s.id}>
                  <td>
                    {s.operador}
                    {s.actual && <span className="chip ok"> esta sesion</span>}
                  </td>
                  <td className="sub">{hace(s.desde)}</td>
                  <td className="sub">{hace(s.ultimaActividad)}</td>
                  <td className="sub">{s.ip ?? '-'}</td>
                  <td>
                    {!s.actual && (
                      <button type="button" className="boton" onClick={() => void accion(`sesiones/${s.id}/revocar`, undefined, 'Sesion revocada')}>
                        Revocar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <h2 style={{ marginTop: 16 }}>Operadores</h2>
          <ul className="lista">
            {c?.operadores.map((o) => (
              <li key={o.id} className="mono-corto">
                {o.nombre} · {o.correo} {o.bloqueada && <span className="chip danger">bloqueada</span>}
                {!o.activo && <span className="chip neu">inactivo</span>}
              </li>
            ))}
          </ul>
          <p className="mono-corto">Alta de operadores: `operador:crear` en el host A (la contrasena se muestra una vez).</p>
        </section>

        <form
          className="panel"
          style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: 10 }}
          onSubmit={async (e) => {
            e.preventDefault();
            if (nueva !== repetida) return setMsg({ t: 'La nueva contrasena no coincide', ok: false });
            if (await accion('clave', { actual, nueva }, 'Contrasena cambiada. Tus otras sesiones se cerraron.')) {
              setActual('');
              setNueva('');
              setRepetida('');
            }
          }}
        >
          <h2>Cambiar mi contrasena</h2>
          <label className="campo-consola">
            Actual
            <input className="campo-texto" type="password" autoComplete="current-password" required value={actual} onChange={(e) => setActual(e.target.value)} />
          </label>
          <label className="campo-consola">
            Nueva (12 o mas caracteres)
            <input className="campo-texto" type="password" autoComplete="new-password" minLength={12} required value={nueva} onChange={(e) => setNueva(e.target.value)} />
          </label>
          <label className="campo-consola">
            Repetir la nueva
            <input className="campo-texto" type="password" autoComplete="new-password" minLength={12} required value={repetida} onChange={(e) => setRepetida(e.target.value)} />
          </label>
          <button type="submit" className="boton primario">
            Cambiar
          </button>
          <span className="mono-corto">Cierra tus otras sesiones abiertas.</span>
        </form>
      </div>
    </Shell>
  );
}
