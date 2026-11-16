'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Selector } from '@/componentes/controles';
import { useConfirmacion } from '@/componentes/dialogo';
import { enviarConSesion, mensajeDe, useDatos, type DetalleJob, type OpcionesVersion } from '@/lib/api';

/*
 * Version del silo (seccion 7): la que corre (tag + digests), su canal y
 * "Actualizar" a una version promovida a ese canal. Un silo con version fija en
 * el manifiesto no se mueve desde aqui: se cambia el manifiesto.
 */
export function PanelVersion({ slug }: { slug: string }) {
  const router = useRouter();
  const { datos: v } = useDatos<OpcionesVersion>(`consola/releases/silo/${slug}`, 30_000);
  const [elegida, setElegida] = useState('');
  const [msg, setMsg] = useState<string>();
  const [confirmar, dialogo] = useConfirmacion();
  if (!v) return null;
  const destino = v.disponibles.find((x) => x.version === elegida) ?? v.disponibles[0];

  const actualizar = async () => {
    if (!destino) return;
    const ok = await confirmar({
      etiqueta: `Silo · erp-${slug}`,
      titulo: `Actualizar a ${destino.version}`,
      texto: `${v.version} -> ${destino.version} (${destino.salto}${destino.salto === 'minor' ? ': puede traer cambios incompatibles y se confirma otra vez en el job' : ''}). Respaldo, migraciones, recrear backend y frontend y /api/salud; si falla, el silo vuelve solo a ${v.version}. ${v.exportes.informa ? 'El silo informa que no hay una exportacion en curso; el agente lo vuelve a revisar antes del respaldo.' : 'Este silo no informa sus exportaciones (ERP anterior a R13): al confirmar declaras que revisaste que el centro no tiene una en curso.'}`,
      boton: v.exportes.informa ? 'Actualizar' : 'Sin exportacion en curso: actualizar',
    });
    if (ok === null) return;
    const r = await enviarConSesion<DetalleJob>('consola/jobs/actualizar', { siloSlug: slug, version: destino.version, sinExporte: !v.exportes.informa });
    if (r.ok) router.push(`/consola/jobs/${r.datos.id}`);
    else setMsg(mensajeDe(r.datos, `HTTP ${r.status}`));
  };

  return (
    <section className="panel">
      <h2>Version</h2>
      <p className="mono-corto" style={{ marginTop: 0 }}>
        {v.version ? (
          <>
            <b>{v.version}</b> · api {v.apiDigest?.slice(7, 19)} · web {v.webDigest?.slice(7, 19)} ·{' '}
          </>
        ) : (
          'sin version registrada · '
        )}
        {v.canal ? `canal ${v.canal}` : v.fija ? `version fija ${v.fija} en el manifiesto (el silo no se mueve hasta cambiarlo)` : 'sin manifiesto aprobado'}
      </p>
      {v.canal && v.version && (
        <div className="acciones">
          {v.disponibles.length === 0 ? (
            <span className="mono-corto">
              Al dia en su canal. Las versiones se promueven en <Link href="/consola/releases">Releases</Link>.
            </span>
          ) : (
            <>
              <Selector
                valor={destino?.version ?? ''}
                opciones={v.disponibles.map((x) => ({ valor: x.version, etiqueta: `${x.version} (${x.salto})` }))}
                onCambio={setElegida}
                etiqueta="Version destino"
              />
              <button type="button" className="boton primario" onClick={() => void actualizar()} disabled={!!v.exportes.enCurso}>
                Actualizar
              </button>
              {v.exportes.enCurso && (
                <span className="chip warn" style={{ whiteSpace: 'normal' }}>
                  Exportacion del centro {v.exportes.enCurso.estado.toLowerCase().replace('_', ' ')}: se actualiza al terminar
                </span>
              )}
            </>
          )}
        </div>
      )}
      {msg && (
        <p role="alert" className="chip danger" style={{ whiteSpace: 'normal' }}>
          {msg}
        </p>
      )}
      {dialogo}
    </section>
  );
}
