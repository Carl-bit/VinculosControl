'use client';

import { claseSeveridad, Shell } from '@/componentes/piezas';
import { TablaSilos } from '@/componentes/tabla-silos';
import { gib, hace, useDatos, type Resumen } from '@/lib/api';

export default function Consola() {
  const { datos: r, error, recargar } = useDatos<Resumen>('consola/resumen');
  const adoptados = r?.silos.filter((s) => s.adoptado) ?? [];
  const enLinea = adoptados.filter((s) => s.salud?.ok).length;
  const porSev = (sev: string) => r?.alertas.filter((a) => a.severidad === sev).length ?? 0;

  return (
    <Shell resumen={r} titulo="resumen">
      <div>
        <h1>Resumen</h1>
        <span className="sub">Estado de la plataforma · se actualiza cada 15 s{error && ` · error: ${error}`}</span>
      </div>

      <section className="kpis" aria-label="Indicadores">
        <div className="panel kpi">
          <div className="l">silos en linea</div>
          <div className="v">
            {enLinea}/{adoptados.length}
          </div>
          <div className="l">{(r?.silos.length ?? 0) - adoptados.length} descubiertos sin adoptar</div>
        </div>
        <div className="panel kpi">
          <div className="l">alertas abiertas</div>
          <div className="v">{r?.alertas.length ?? 0}</div>
          <div className="l">
            S1 {porSev('S1')} · S2 {porSev('S2')} · S3 {porSev('S3')}
          </div>
        </div>
        <div className="panel kpi">
          <div className="l">solicitudes nuevas</div>
          <div className="v">{r?.solicitudesNuevas ?? 0}</div>
          <div className="l">
            jobs activos {r?.jobsActivos ?? 0} · incidentes abiertos {r?.incidentesAbiertos ?? 0}
          </div>
        </div>
        <div className="panel kpi">
          <div className="l">RAM host B</div>
          <div className="v">{r?.host ? `${gib(r.host.memUsada)}/${gib(r.host.memTotal)}` : '-'}</div>
          <div className="l">GiB · {r?.host?.cpus ?? '-'} vCPU · carga {r?.host?.carga1.toFixed(2) ?? '-'}</div>
        </div>
        <div className="panel kpi">
          <div className="l">disco host B</div>
          <div className="v">{r?.host ? `${r.host.discoPct} %` : '-'}</div>
          <div className="l">alerta sobre 80 %</div>
        </div>
      </section>

      <div className="rejilla">
        <section className="panel" aria-labelledby="t-silos">
          <h2 id="t-silos">Silos</h2>
          <TablaSilos resumen={r} recargar={recargar} />
        </section>

        <section className="panel" aria-labelledby="t-alertas">
          <h2 id="t-alertas">Alertas abiertas</h2>
          {r && r.alertas.length === 0 ? (
            <p className="vacio">Sin alertas.</p>
          ) : (
            <ul className="lista">
              {r?.alertas.map((a) => (
                <li key={a.id}>
                  <span className={`chip ${claseSeveridad[a.severidad]}`}>{a.severidad}</span>
                  <span>
                    {a.slug && <b>{a.slug}: </b>}
                    {a.mensaje}
                    <div className="sub">{hace(a.abiertaEn)}</div>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <h2 style={{ marginTop: 18 }}>Eventos recientes</h2>
          {r && r.eventos.length === 0 ? (
            <p className="vacio">Sin eventos.</p>
          ) : (
            <ul className="lista">
              {r?.eventos.map((e) => (
                <li key={e.id} className="mono-corto">
                  {hace(e.en)} · {e.accion} · {e.objeto ?? ''} · {e.actor}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Shell>
  );
}
