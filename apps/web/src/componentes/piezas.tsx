'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

import { CompartirFormulario } from '@/componentes/compartir';
import { accion, hace, useDatos, type FilaSilo, type Resumen, type Yo } from '@/lib/api';

/** Agente vivo = latido de menos de 2 minutos (misma regla que la API). */
export const agenteVivo = (r?: Resumen) => !!r?.agente?.ultimoLatido && Date.now() - new Date(r.agente.ultimoLatido).getTime() < 120_000;

/*
 * Navegacion agrupada como el boceto (system-reference/Panel de acceso). Las
 * vistas que aun no existen se muestran apagadas, para que el mapa sea el mismo.
 */
type ItemNav = { href: string; l: string; d: string; badge?: number; pronto?: true };
const ICONOS = {
  resumen: 'M4 13h6V4H4z M14 20h6v-9h-6z M4 20h6v-3H4z M14 7h6V4h-6z',
  solicitudes: 'M4 4h16v12H8l-4 4z',
  manifiestos: 'M6 3h9l4 4v14H6z M14 3v5h5 M9 13h7 M9 17h5',
  job: 'M4 17l6-6-6-6 M12 19h8',
  silos: 'M4 5h16v5H4z M4 14h16v5H4z M8 7.5h.01 M8 16.5h.01',
  releases: 'M6 3v12 M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M18 9c0 6-12 3-12 9',
  monitoreo: 'M3 12h4l3-8 4 16 3-8h4',
  auditoria: 'M9 5h11 M9 12h11 M9 19h11 M4 5h.01 M4 12h.01 M4 19h.01',
  salidas: 'M10 17l5-5-5-5 M15 12H3 M14 3h6v18h-6',
  config: 'M4 7h10 M18 7h2 M4 17h4 M12 17h8 M16 5v4 M10 15v4',
  incidentes: 'M12 3l9 16H3z M12 10v4 M12 17h.01',
  demos: 'M4 4h16v12H4z M8 20h8 M12 16v4 M9 9l2 2 4-4',
};

export function Shell({ resumen, titulo, children }: { resumen?: Resumen; titulo: string; children: ReactNode }) {
  const ruta = usePathname();
  const vivo = agenteVivo(resumen);
  const grupos: { l: string; items: ItemNav[] }[] = [
    {
      l: 'Operacion',
      items: [
        { href: '/consola', l: 'Resumen', d: ICONOS.resumen },
        { href: '/consola/solicitudes', l: 'Solicitudes', d: ICONOS.solicitudes, badge: resumen?.solicitudesNuevas },
        { href: '/consola/manifiestos', l: 'Manifiestos', d: ICONOS.manifiestos },
        { href: '/consola/jobs', l: 'Aprovisionamiento', d: ICONOS.job, badge: resumen?.jobsActivos },
        { href: '/consola/silos', l: 'Silos', d: ICONOS.silos },
        { href: '/consola/demos', l: 'Demos', d: ICONOS.demos },
      ],
    },
    { l: 'Versiones', items: [{ href: '/consola/releases', l: 'Releases y canales', d: ICONOS.releases }] },
    {
      l: 'Salud',
      items: [
        { href: '/consola/alertas', l: 'Monitoreo', d: ICONOS.monitoreo },
        { href: '/consola/incidentes', l: 'Incidentes y soporte', d: ICONOS.incidentes, badge: resumen?.incidentesAbiertos },
        { href: '/consola/auditoria', l: 'Auditoria', d: ICONOS.auditoria },
      ],
    },
    { l: 'Ciclo de vida', items: [{ href: '/consola/salidas', l: 'Salidas', d: ICONOS.salidas }] },
    { l: 'Ajustes', items: [{ href: '/consola/config', l: 'Configuracion', d: ICONOS.config }] },
  ];
  const activo = (href: string) => ruta === href || (href !== '/consola' && ruta.startsWith(`${href}/`));
  // Vista de detalle (/consola/<seccion>/<id>): enlace para volver a la lista de su seccion.
  const padre = grupos.flatMap((g) => g.items).find((e) => e.href !== '/consola' && ruta.startsWith(`${e.href}/`));
  const { datos: yo } = useDatos<Yo>('consola/acceso/yo', 60_000);
  const [sitioUrl, setSitioUrl] = useState<string>();
  useEffect(() => {
    fetch('/api/sitio')
      .then((r) => r.json() as Promise<{ url: string }>)
      .then((d) => setSitioUrl(d.url))
      .catch(() => undefined);
  }, []);
  const salir = async () => {
    await accion('consola/acceso/salir').catch(() => undefined);
    window.location.assign('/ingreso');
  };
  return (
    <div className="shell">
      <aside className="lateral">
        <span className="marca">vinculos-control</span>
        <nav className="nav" aria-label="Consola">
          {grupos.map((g) => (
            <div key={g.l} className="nav-grupo">
              <span className="nav-titulo">{g.l}</span>
              {g.items.map((e) => {
                const icono = (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d={e.d} />
                  </svg>
                );
                return e.pronto ? (
                  <span key={e.href} className="nav-pronto" aria-disabled="true" title="Llega en una fase siguiente (docs/roadmap.md)">
                    {icono}
                    {e.l}
                    <span className="mono-corto">pronto</span>
                  </span>
                ) : (
                  <Link key={e.href} href={e.href} aria-current={activo(e.href) ? 'page' : undefined}>
                    {icono}
                    {e.l}
                    {!!e.badge && (
                      <span className="badge" aria-label={`${e.badge} pendientes`}>
                        {e.badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        {sitioUrl && <CompartirFormulario sitioUrl={sitioUrl} lateral />}
        <div className="agente" role="status">
          <span className={`chip ${vivo ? 'ok' : 'danger'}`}>{vivo ? '● en linea' : '● sin latido'}</span>
          <div style={{ marginTop: 6 }}>agente {resumen?.agente?.nombre ?? 'sin registrar'}</div>
          <div>
            latido {hace(resumen?.agente?.ultimoLatido)}
            {resumen?.agente?.version && ` · v${resumen.agente.version}`}
          </div>
        </div>
      </aside>
      <main className="principal">
        <div className="barra">
          {padre && (
            <Link href={padre.href} className="boton" aria-label={`Volver a ${padre.l}`}>
              ← {padre.l}
            </Link>
          )}
          <span className="ruta">
            consola / <b>{titulo}</b>
          </span>
          <span style={{ marginLeft: 'auto' }} className={`chip ${vivo ? 'ok' : 'danger'}`}>
            host-b: {vivo ? 'en linea' : 'sin datos'}
          </span>
          {yo && (
            <span className="operador" title={`sesion desde ${new Date(yo.sesion.desde).toLocaleString('es-CL')}${yo.sesion.ip ? ` · ${yo.sesion.ip}` : ''}`}>
              {yo.nombre} · <span className="chip ok">2FA</span>
            </span>
          )}
          <button type="button" className="boton" onClick={() => void salir()}>
            Salir
          </button>
        </div>
        {children}
      </main>
    </div>
  );
}

const nivel = (frac: number) => (frac > 0.9 ? 'danger' : frac > 0.75 ? 'warn' : 'ok');

/** Barra de uso con el valor al lado (RAM contra el limite del contenedor, disco, etc.). */
export function Medidor({ frac, texto }: { frac: number; texto: string }) {
  const f = Math.min(Math.max(frac, 0), 1);
  return (
    <span className="medidor">
      <span className="pista" aria-hidden="true">
        <span className="relleno" data-nivel={nivel(f)} style={{ width: `${Math.round(f * 100)}%`, display: 'block' }} />
      </span>
      {texto}
    </span>
  );
}

export function ChipSalud({ silo }: { silo: FilaSilo }) {
  if (!silo.adoptado) return <span className="chip neu">sin adoptar</span>;
  const s = silo.salud;
  if (!s) return <span className="chip neu">sin sondeo</span>;
  if (s.canarios === false) return <span className="chip danger">canarios</span>;
  return s.ok ? <span className="chip ok">ok · {s.latenciaMs} ms</span> : <span className="chip danger">{s.error ?? `HTTP ${s.http}`}</span>;
}

export const claseSeveridad = { S1: 'danger', S2: 'warn', S3: 'info' } as const;

/** Linea simple en SVG (sin librerias): serie de valores en el tiempo. */
export function Grafico({ series, max }: { series: { nombre: string; color: string; puntos: { t: number; v: number }[] }[]; max?: number }) {
  const todos = series.flatMap((s) => s.puntos);
  if (todos.length < 2) return <p className="vacio">Faltan datos para graficar (llegan cada minuto).</p>;
  const t0 = Math.min(...todos.map((p) => p.t));
  const t1 = Math.max(...todos.map((p) => p.t));
  const tope = max ?? Math.max(...todos.map((p) => p.v), 1);
  const x = (t: number) => ((t - t0) / Math.max(t1 - t0, 1)) * 600;
  const y = (v: number) => 88 - (Math.min(v, tope) / tope) * 84;
  return (
    <>
      <svg className="grafico" viewBox="0 0 600 90" preserveAspectRatio="none" role="img" aria-label={series.map((s) => s.nombre).join(', ')}>
        <line x1="0" x2="600" y1="88" y2="88" stroke="var(--line)" />
        {series.map((s) => (
          <polyline key={s.nombre} className="linea" stroke={s.color} points={s.puntos.map((p) => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')} vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <div className="sub" style={{ display: 'flex', gap: 14, fontSize: 11 }}>
        {series.map((s) => (
          <span key={s.nombre}>
            <span style={{ color: s.color }}>■</span> {s.nombre}
          </span>
        ))}
        <span style={{ marginLeft: 'auto' }}>tope {Math.round(tope)}</span>
      </div>
    </>
  );
}

/** Color del chip por estado del centro. */
export const claseEstado: Record<string, string> = {
  SOLICITUD: 'info',
  CONTACTADO: 'warn',
  REUNION: 'warn',
  DATOS_COMPLETOS: 'warn',
  APROBADO: 'ok',
  APROVISIONANDO: 'info',
  ACTIVO: 'ok',
  ACTIVO_SIN_DOMINIO: 'warn',
  SUSPENDIDO: 'danger',
  EN_SALIDA: 'danger',
  EXPORTADO: 'neu',
  GRACIA: 'neu',
  ELIMINADO: 'neu',
  DESCARTADO: 'neu',
};

/** Color del chip por estado de job o de paso. */
export const claseJob: Record<string, string> = {
  PENDIENTE: 'neu',
  EN_CURSO: 'info',
  ESPERANDO_LLAVES: 'warn',
  ESPERANDO_OPERADOR: 'warn',
  FALLIDO: 'danger',
  OK: 'ok',
  OMITIDO: 'warn',
  CANCELADO: 'neu',
};

const DOMINIO = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

/** Dominio de un silo como enlace que abre el sitio en otra pestana (sin copiar y pegar). */
export function EnlaceDominio({ dominio, vacio = 'sin dominio' }: { dominio: string | null | undefined; vacio?: string }) {
  if (!dominio) return <>{vacio}</>;
  if (!DOMINIO.test(dominio)) return <>{dominio}</>;
  return (
    <a href={`https://${dominio}`} target="_blank" rel="noopener noreferrer" title={`Abrir https://${dominio} en otra pestana`}>
      {dominio} ↗
    </a>
  );
}
