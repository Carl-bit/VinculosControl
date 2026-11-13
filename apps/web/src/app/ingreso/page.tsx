'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { enviar, mensajeDe } from '@/lib/api';

/*
 * Acceso a la consola en dos pasos (boceto system-reference/Login, estilo
 * Terminal). La red la cubre Cloudflare Access; aca: correo + contrasena y
 * codigo de 6 digitos por correo, en cada inicio.
 */

type Paso = 'credenciales' | 'codigo' | 'listo';
type Tono = 'ok' | 'warn' | 'danger' | 'neu';
interface Linea {
  t: string;
  tono: Tono;
}
interface Desafio {
  desafio: string;
  correo: string;
  venceMin: number;
  reenviarEnS: number;
}
interface Inicio {
  operador: { nombre: string; correo: string };
  ip: string | null;
  inactividadMin: number;
  ultimoAcceso: { en: string; ip: string | null; mismaIp: boolean } | null;
}

const reloj = () => new Date().toLocaleTimeString('es-CL', { hour12: false });

export default function Ingreso() {
  const router = useRouter();
  const [paso, setPaso] = useState<Paso>('credenciales');
  const [correo, setCorreo] = useState('');
  const [clave, setClave] = useState('');
  const [ver, setVer] = useState(false);
  const [codigo, setCodigo] = useState('');
  const [desafio, setDesafio] = useState<Desafio>();
  const [inicio, setInicio] = useState<Inicio>();
  const [error, setError] = useState<string>();
  const [bloqueada, setBloqueada] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [espera, setEspera] = useState(0);
  const [origen, setOrigen] = useState<string>();
  const [log, setLog] = useState<Linea[]>([]);
  const codigoRef = useRef<HTMLInputElement>(null);

  const anotar = (t: string, tono: Tono = 'neu') => setLog((l) => [...l.slice(-30), { t: `${reloj()}  ${t}`, tono }]);

  useEffect(() => {
    const https = window.location.protocol === 'https:';
    setOrigen(https ? 'https · tras Cloudflare Access' : `local · ${window.location.host}`);
    setLog([
      { t: `${reloj()}  conexion ${https ? 'https' : 'local'} con ${window.location.host}`, tono: 'ok' },
      { t: `${reloj()}  esperando credenciales...`, tono: 'neu' },
    ]);
  }, []);

  // Cuenta regresiva del reenvio.
  useEffect(() => {
    if (espera <= 0) return;
    const t = setTimeout(() => setEspera((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [espera]);

  useEffect(() => {
    if (paso === 'codigo') codigoRef.current?.focus();
  }, [paso]);

  const volverACredenciales = () => {
    setPaso('credenciales');
    setCodigo('');
    setDesafio(undefined);
    setError(undefined);
  };

  const pedirCodigo = async (e: FormEvent) => {
    e.preventDefault();
    if (ocupado) return;
    setOcupado(true);
    setError(undefined);
    try {
      const r = await enviar<Desafio>('consola/acceso/credenciales', { correo, clave });
      if (r.ok) {
        setClave('');
        setBloqueada(false);
        setDesafio(r.datos);
        setEspera(r.datos.reenviarEnS);
        setPaso('codigo');
        anotar('contrasena ok', 'ok');
        anotar(`codigo enviado a ${r.datos.correo} · vence ${r.datos.venceMin} min`, 'warn');
        return;
      }
      const m = mensajeDe(r.datos, 'No se pudo verificar.');
      setError(m);
      setBloqueada(r.status === 423);
      anotar(r.status === 423 ? `cuenta bloqueada · evento auth.bloqueo` : `credenciales rechazadas (HTTP ${r.status})`, 'danger');
    } catch {
      setError('Sin conexion con la consola.');
    } finally {
      setOcupado(false);
    }
  };

  const verificar = async (e: FormEvent) => {
    e.preventDefault();
    if (ocupado || !desafio) return;
    setOcupado(true);
    setError(undefined);
    try {
      const r = await enviar<Inicio & { volver?: boolean; restantes?: number }>('consola/acceso/codigo', { desafio: desafio.desafio, codigo });
      if (r.ok) {
        setInicio(r.datos);
        setPaso('listo');
        anotar(`sesion iniciada · ${r.datos.operador.correo}`, 'ok');
        return;
      }
      anotar(`codigo rechazado (HTTP ${r.status})`, 'danger');
      setCodigo('');
      if (r.datos.volver) {
        volverACredenciales();
        setError(mensajeDe(r.datos, 'Vuelve a ingresar tus credenciales.'));
        return;
      }
      const restantes = r.datos.restantes;
      setError(`${mensajeDe(r.datos, 'Codigo incorrecto.')}${restantes !== undefined ? ` Quedan ${restantes} intentos.` : ''}`);
    } catch {
      setError('Sin conexion con la consola.');
    } finally {
      setOcupado(false);
    }
  };

  const reenviar = async () => {
    if (ocupado || !desafio || espera > 0) return;
    setOcupado(true);
    setError(undefined);
    try {
      const r = await enviar<{ reenviarEnS: number; volver?: boolean }>('consola/acceso/reenviar', { desafio: desafio.desafio });
      if (r.ok) {
        setEspera(r.datos.reenviarEnS);
        anotar('codigo reenviado · el anterior deja de servir', 'warn');
      } else if (r.datos.volver) {
        volverACredenciales();
        setError(mensajeDe(r.datos, 'Vuelve a ingresar tus credenciales.'));
      } else {
        if (r.datos.reenviarEnS) setEspera(r.datos.reenviarEnS);
        setError(mensajeDe(r.datos, 'No se pudo reenviar.'));
      }
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div className="ingreso">
      <header className="ingreso-cabecera">
        <span className="marca">vinculos-control</span>
        {origen && <span className="chip ok pildora">{origen}</span>}
      </header>

      <main className="ingreso-cuerpo">
        <section className="terminal" aria-label="Registro de la sesion de acceso">
          <div className="terminal-barra">
            <span className="punto danger" aria-hidden="true" />
            <span className="punto warn" aria-hidden="true" />
            <span className="punto ok" aria-hidden="true" />
            <span>sesion de acceso</span>
          </div>
          <div role="log" className="terminal-log">
            {log.map((l, i) => (
              <span key={i} className={`t-${l.tono}`}>
                {l.t}
              </span>
            ))}
          </div>
        </section>

        <section className="tarjeta-acceso" aria-labelledby="t-acceso">
          {paso === 'credenciales' && (
            <form onSubmit={pedirCodigo} className="formulario">
              <span className="etiqueta-paso">Paso 1 de 2 · credenciales</span>
              <h1 id="t-acceso">Acceso del proveedor</h1>
              <label className="campo">
                correo
                <input type="email" autoComplete="username" required maxLength={200} value={correo} onChange={(e) => setCorreo(e.target.value)} aria-invalid={!!error} />
              </label>
              <label className="campo">
                <span className="campo-fila">
                  contrasena
                  <button type="button" className="enlace" onClick={() => setVer((v) => !v)}>
                    {ver ? 'ocultar' : 'mostrar'}
                  </button>
                </span>
                <input type={ver ? 'text' : 'password'} autoComplete="current-password" required maxLength={200} value={clave} onChange={(e) => setClave(e.target.value)} aria-invalid={!!error} />
              </label>
              {error && (
                <p role="alert" className="aviso danger">
                  {error}
                </p>
              )}
              <button type="submit" className="boton primario grande" disabled={ocupado || !correo || !clave}>
                {ocupado ? 'Verificando…' : bloqueada ? 'Reintentar' : 'Continuar'}
              </button>
              <span className="sub pequeno">5 intentos. Al quinto la cuenta se bloquea 15 min y queda en auditoria.</span>
            </form>
          )}

          {paso === 'codigo' && desafio && (
            <form onSubmit={verificar} className="formulario">
              <span className="etiqueta-paso">Paso 2 de 2 · verificacion</span>
              <h1 id="t-acceso">Ingresa el codigo</h1>
              <p className="sub">
                Enviamos un codigo de 6 digitos a {desafio.correo}. Vence en {desafio.venceMin} minutos.
              </p>
              <label className="campo">
                codigo
                <input
                  ref={codigoRef}
                  className="codigo"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d{6}"
                  maxLength={6}
                  required
                  value={codigo}
                  onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  aria-invalid={!!error}
                />
              </label>
              {error && (
                <p role="alert" className="aviso danger">
                  {error}
                </p>
              )}
              <button type="submit" className="boton primario grande" disabled={ocupado || codigo.length !== 6}>
                {ocupado ? 'Verificando…' : 'Verificar'}
              </button>
              <div className="campo-fila pequeno">
                {espera > 0 ? (
                  <span className="sub">Reenviar en {espera} s</span>
                ) : (
                  <button type="button" className="enlace" onClick={() => void reenviar()} disabled={ocupado}>
                    Reenviar codigo
                  </button>
                )}
                <button type="button" className="enlace" onClick={volverACredenciales}>
                  Cambiar cuenta
                </button>
              </div>
              <span className="sub pequeno">El codigo se pide en cada inicio. Este equipo no se recuerda.</span>
            </form>
          )}

          {paso === 'listo' && inicio && (
            <div className="formulario">
              <span className="etiqueta-paso">Sesion iniciada</span>
              <h1 id="t-acceso">Bienvenido, {inicio.operador.nombre}.</h1>
              <dl className="datos-sesion">
                <dt>cuenta</dt>
                <dd>{inicio.operador.correo}</dd>
                <dt>ip</dt>
                <dd>{inicio.ip ?? 'local (sin proxy)'}</dd>
                <dt>expira</dt>
                <dd>{inicio.inactividadMin} min sin actividad</dd>
                <dt>ultimo acceso</dt>
                <dd>
                  {inicio.ultimoAcceso
                    ? `${new Date(inicio.ultimoAcceso.en).toLocaleString('es-CL', { dateStyle: 'medium', timeStyle: 'short' })} · ${
                        inicio.ultimoAcceso.mismaIp ? 'misma ip' : (inicio.ultimoAcceso.ip ?? 'ip desconocida')
                      }`
                    : 'primer acceso'}
                </dd>
              </dl>
              <button type="button" className="boton primario grande" onClick={() => router.push('/consola')}>
                Entrar a la consola
              </button>
              <span className="sub pequeno">¿No fuiste tu? Avisa al responsable de la consola para rotar la contrasena y cerrar las sesiones.</span>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
