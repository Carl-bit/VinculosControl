'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { claseEstado, Shell } from '@/componentes/piezas';
import { enviarConSesion, hace, mensajeDe, useDatos, type CentroDetalle, type DetalleJob, type EstadoCentro, type Resumen } from '@/lib/api';
import { useRouter } from 'next/navigation';

import { VistaManifiesto } from './vista';

const EDITABLE: EstadoCentro[] = ['SOLICITUD', 'CONTACTADO', 'REUNION', 'DATOS_COMPLETOS'];
const FASE2: EstadoCentro[] = ['REUNION', 'DATOS_COMPLETOS'];
const codigo = (id: number) => `S-${String(id).padStart(3, '0')}`;

export default function Manifiesto() {
  const { id } = useParams<{ id: string }>();
  const { datos: r } = useDatos<Resumen>('consola/resumen', 30_000);
  const { datos: c, error, recargar } = useDatos<CentroDetalle>(`consola/centros/${id}`, 30_000);
  const [slug, setSlug] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<{ t: string; ok: boolean }>();
  const [url, setUrl] = useState<string>();

  useEffect(() => {
    if (c && !slug) setSlug(c.slug ?? c.fase2.slugSugerido);
  }, [c, slug]);

  const hacer = async (ruta: string, cuerpo: unknown, exito: string) => {
    if (ocupado) return null;
    setOcupado(true);
    setMsg(undefined);
    try {
      const res = await enviarConSesion<{ url?: string }>(`consola/centros/${id}/${ruta}`, cuerpo);
      if (!res.ok) {
        setMsg({ t: mensajeDe(res.datos, `No se pudo (HTTP ${res.status})`), ok: false });
        return null;
      }
      setMsg({ t: exito, ok: true });
      await recargar();
      return res.datos;
    } finally {
      setOcupado(false);
    }
  };

  const router = useRouter();
  const crearJob = async (tipo: string) => {
    if (ocupado || !c) return;
    setOcupado(true);
    setMsg(undefined);
    try {
      const res = await enviarConSesion<DetalleJob>('consola/jobs', { tipo, centroId: c.id });
      if (!res.ok) {
        setMsg({ t: mensajeDe(res.datos, `No se pudo (HTTP ${res.status})`), ok: false });
        return;
      }
      router.push(`/consola/jobs/${res.datos.id}`);
    } finally {
      setOcupado(false);
    }
  };
  const f2 = c?.fase2;
  const editable = !!c && EDITABLE.includes(c.estado);
  const rev = c?.revisiones[0];

  const lateral = c && f2 && editable && (
    <section className="panel">
      <h2>Fase 2 · slug y enlace</h2>
      <form
        className="acciones"
        onSubmit={(e) => {
          e.preventDefault();
          void hacer('slug', { slug }, `Slug: ${slug}`);
        }}
      >
        <input className="campo-texto" aria-label="Slug del silo" value={slug} maxLength={40} onChange={(e) => setSlug(e.target.value.toLowerCase())} />
        <button type="submit" className="boton" disabled={ocupado || !slug || slug === c.slug}>
          {c.slug ? 'Cambiar' : 'Fijar slug'}
        </button>
      </form>
      <p className="mono-corto" style={{ margin: '8px 0' }}>
        {f2.enlace
          ? `Enlace ${f2.enlace.activo ? 'activo' : f2.enlace.revocado ? 'revocado' : 'vencido'} · ${f2.enlace.enviadoA} · ${hace(f2.enlace.creadoEn)}${f2.enlace.ultimoUsoEn ? ` · abierto ${hace(f2.enlace.ultimoUsoEn)}` : ' · sin abrir'}`
          : 'Sin enlace enviado.'}
      </p>
      <div className="acciones">
        <button
          type="button"
          className="boton primario"
          disabled={ocupado || !c.slug || !FASE2.includes(c.estado)}
          title={!c.slug ? 'Primero fija el slug' : !FASE2.includes(c.estado) ? 'Despues de la reunion' : undefined}
          onClick={async () => {
            const d = await hacer('enlace', undefined, `Enlace enviado a ${c.contactoCorreo}`);
            if (d?.url) setUrl(d.url);
          }}
        >
          {f2.enlace?.activo ? 'Enviar enlace nuevo' : 'Enviar enlace fase 2 (7 dias)'}
        </button>
        {f2.enlace?.activo && (
          <button type="button" className="boton" disabled={ocupado} onClick={() => void hacer('enlace/revocar', undefined, 'Enlace revocado')}>
            Revocar
          </button>
        )}
        {c.estado === 'REUNION' && (
          <button
            type="button"
            className="boton"
            disabled={ocupado || !f2.datosCentroCompletos}
            title={f2.datosCentroCompletos ? 'Si completaste tu los datos del centro' : `Faltan: ${f2.faltanCentro.join('; ')}`}
            onClick={() => void hacer('transicion', { hacia: 'DATOS_COMPLETOS' }, 'Datos completos')}
          >
            Marcar datos completos
          </button>
        )}
      </div>
      {url && (
        <div className="acciones" style={{ marginTop: 8 }}>
          <input className="campo-texto" readOnly value={url} aria-label="Enlace de fase 2" onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className="boton" onClick={() => void navigator.clipboard.writeText(url).catch(() => undefined)}>
            Copiar
          </button>
        </div>
      )}
      {msg && (
        <p role="status" className={`chip ${msg.ok ? 'ok' : 'danger'}`} style={{ marginTop: 8, whiteSpace: 'normal' }}>
          {msg.t}
        </p>
      )}
    </section>
  );

  const aprobado = c && c.estado === 'APROBADO' && (
    <section className="panel">
      <h2>Aprovisionamiento</h2>
      <p className="mono-corto" style={{ marginTop: 0 }}>
        Aprobado {c.aprobadoEn && hace(c.aprobadoEn)} · rev {c.revisionAprobada} · sha {c.hashAprobado?.slice(0, 12)}
      </p>
      <div className="acciones">
        <button type="button" className="boton primario" disabled={ocupado} onClick={() => void crearJob('VERIFICAR')}>
          Verificar en el host B
        </button>
        <button type="button" className="boton" disabled title="Requiere imagenes unicas (R1), /api/internal/* (R4, R5) y escritura en el docker-socket-proxy">
          Aprovisionar (bloqueado)
        </button>
      </div>
      <p className="mono-corto">Verificar es solo lectura: valida el manifiesto, la red de Traefik, el nombre del stack y la capacidad del host.</p>
      {msg && (
        <p role="status" className={`chip ${msg.ok ? 'ok' : 'danger'}`} style={{ whiteSpace: 'normal' }}>
          {msg.t}
        </p>
      )}
    </section>
  );

  return (
    <Shell resumen={r} titulo={`manifiestos / ${c?.slug ?? codigo(Number(id))}`}>
      <div className="cabecera-vista">
        <div>
          <h1>Manifiesto · {c?.slug ?? f2?.slugSugerido ?? '…'}</h1>
          <span className="sub">
            {c ? (
              <>
                {c.nombre} · <Link href={`/consola/solicitudes?id=${c.id}`}>{codigo(c.id)}</Link> ·{' '}
                {c.estado === 'DATOS_COMPLETOS' ? 'fase 2 completada por el centro' : c.estado === 'REUNION' ? 'fase 2 en curso' : c.estado.toLowerCase()}
              </>
            ) : (
              'cargando…'
            )}
            {error && ` · error: ${error}`}
          </span>
        </div>
        {rev && (
          <span className="chip neu">
            rev {rev.numero} · sha {rev.hash.slice(0, 6)}
          </span>
        )}
        {c && <span className={`chip ${claseEstado[c.estado]}`}>{c.estado}</span>}
      </div>
      {c && f2 && (
        <VistaManifiesto
          centroId={c.id}
          borrador={f2.borrador}
          slug={c.slug}
          dominioBase={f2.dominioBase}
          editable={editable}
          estado={c.estado}
          lateral={lateral || aprobado}
          preferencia={typeof c.fase1?.estilo_preferido === 'string' ? c.fase1.estilo_preferido : undefined}
          alGuardar={recargar}
        />
      )}
    </Shell>
  );
}
