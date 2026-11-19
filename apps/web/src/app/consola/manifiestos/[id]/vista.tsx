'use client';

import {
  armarManifiesto,
  type Borrador,
  CAMPOS_REGLAS,
  completarDependencias,
  DEPENDENCIAS,
  formatearRut,
  type Modulo,
  MODULOS_MVP,
  NOMBRE_MODULO,
  ordenarModulos,
  TEMAS,
  TIPOS_ENTIDAD,
  validarP0,
} from '@vinculos/manifest';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { CampoFecha, CampoNumero, Selector } from '@/componentes/controles';
import { useConfirmacion } from '@/componentes/dialogo';
import { enviarConSesion, mensajeDe } from '@/lib/api';

/*
 * Vista Manifiesto (boceto system-reference/Panel de acceso, "Manifiesto"):
 * formulario compacto a la izquierda; a la derecha el YAML que se aprobara y
 * la validacion P0 en vivo (misma funcion validarP0 que la API y el job).
 */

const clonar = <T,>(v: T): T => JSON.parse(JSON.stringify(v ?? {})) as T;

function limpiar(v: unknown): unknown {
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object') {
    const o = Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .map(([k, x]) => [k, limpiar(x)])
        .filter(([, x]) => x !== undefined && x !== ''),
    );
    return Object.keys(o).length ? o : undefined;
  }
  return v;
}

/** YAML legible para la vista previa (no es el formato de intercambio; el hash va sobre el JSON canonico). */
function yaml(v: unknown, sangria = ''): string {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.length ? `[${v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ')}]` : '[]';
  if (typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x !== undefined && !(typeof x === 'object' && x !== null && !Array.isArray(x) && !Object.keys(x).length))
      .map(([k, x]) => (x && typeof x === 'object' && !Array.isArray(x) ? `\n${sangria}${k}:${yaml(x, `${sangria}  `)}` : `\n${sangria}${k}: ${yaml(x, sangria)}`))
      .join('');
  }
  return typeof v === 'string' && /[:#{}[\],]/.test(v) ? JSON.stringify(v) : String(v);
}

/** Reglas visibles de entrada (el boceto muestra 4); el resto en "Todas las reglas". */
const REGLAS_PRINCIPALES = ['plazo_aviso_cancelacion_horas', 'recordatorio_horas_antes', 'plazo_respuesta_derivacion_horas', 'plazo_consentimiento_horas'];

/** Chequeos de P0 agrupados como el boceto (cada error de validarP0 cae en uno por su prefijo). */
const CHEQUEOS: { l: string; prefijos: string[] }[] = [
  { l: 'Slug del silo definido', prefijos: ['Falta el slug', 'centro.id'] },
  { l: 'Entidad y responsables (schema v1)', prefijos: ['centro'] },
  { l: 'Dominio valido', prefijos: ['dominio'] },
  { l: 'Modulos y dependencias (MVP)', prefijos: ['modulos'] },
  { l: 'Reglas dentro de los rangos del ERP', prefijos: ['reglas'] },
  { l: 'Version y estilo', prefijos: ['version', 'estilo'] },
  { l: 'Contrato de encargo firmado', prefijos: ['legal'] },
];

export function VistaManifiesto({
  centroId,
  borrador,
  slug,
  dominioBase,
  editable,
  estado,
  lateral,
  preferencia,
  alGuardar,
}: {
  centroId: number;
  borrador: Borrador;
  slug: string | null;
  dominioBase: string;
  editable: boolean;
  estado: string;
  lateral: ReactNode;
  /** estilo_preferido de la fase 1 (moderno, cuaderno, editorial, propios, aun_no_se). */
  preferencia?: string;
  alGuardar: () => Promise<void>;
}) {
  const [b, setB] = useState<Borrador>(() => clonar(borrador));
  const [sucio, setSucio] = useState(false);
  const [msg, setMsg] = useState<{ t: string; ok: boolean }>();
  const [ocupado, setOcupado] = useState(false);
  const [confirmar, dialogo] = useConfirmacion();

  // Si el centro guardo por su enlace y aqui no hay cambios locales, se toma lo nuevo.
  useEffect(() => {
    if (!sucio) setB(clonar(borrador));
  }, [borrador, sucio]);

  const cambiar = (f: (x: Borrador) => void) => {
    setB((prev) => {
      const n = clonar(prev);
      f(n);
      return n;
    });
    setSucio(true);
  };

  const c = b.centro ?? {};
  const elegidos = ordenarModulos((b.modulos ?? []) as Modulo[]);
  const modulos = completarDependencias(elegidos);
  const final = useMemo(() => (limpiar({ ...b, modulos }) ?? {}) as Borrador, [b, modulos]);
  const p0 = useMemo(() => validarP0(final, slug), [final, slug]);
  const vistaYaml = useMemo(() => yaml(limpiar(armarManifiesto(final, slug))).trimStart(), [final, slug]);
  const canal = b.version && 'fija' in b.version ? 'fija' : (b.version?.canal ?? 'estable');
  const reglas = (b.reglas ?? {}) as Record<string, unknown>;

  const guardar = async (luego?: 'aprobar') => {
    if (ocupado) return;
    setOcupado(true);
    setMsg(undefined);
    try {
      if (sucio) {
        const r = await enviarConSesion<{ numero: number; hash: string; nueva: boolean }>(`consola/centros/${centroId}/manifiesto`, final);
        if (!r.ok) {
          setMsg({ t: mensajeDe(r.datos, `No se pudo guardar (HTTP ${r.status})`), ok: false });
          return;
        }
        setSucio(false);
        setMsg({ t: r.datos.nueva ? `Revision ${r.datos.numero} guardada · sha ${r.datos.hash.slice(0, 12)}` : 'Sin cambios', ok: true });
      }
      if (luego === 'aprobar') {
        const a = await enviarConSesion<{ revision: number; hash: string; errores?: string[] }>(`consola/centros/${centroId}/aprobar`);
        if (!a.ok) {
          setMsg({ t: `${mensajeDe(a.datos, 'No se pudo aprobar')}${a.datos.errores ? `: ${a.datos.errores.join('; ')}` : ''}`, ok: false });
          return;
        }
        setMsg({ t: `Aprobado · rev ${a.datos.revision} · sha ${a.datos.hash.slice(0, 12)}`, ok: true });
      }
      await alGuardar();
    } finally {
      setOcupado(false);
    }
  };

  const campo = (l: string, v: string | undefined, set: (s: string) => void, extra: { ph?: string; max?: number; tipo?: string } = {}) => (
    <label className="campo-consola">
      {l}
      <input className="campo-texto" type={extra.tipo ?? 'text'} value={v ?? ''} maxLength={extra.max ?? 200} placeholder={extra.ph} disabled={!editable} onChange={(e) => set(e.target.value)} />
    </label>
  );
  const regla = (k: string) => {
    const r = CAMPOS_REGLAS.find((x) => x.k === k)!;
    const v = reglas[k];
    const set = (nv: unknown) =>
      cambiar((x) => {
        const rr = (x.reglas ??= {}) as Record<string, unknown>;
        if (nv === undefined || nv === '') delete rr[k];
        else rr[k] = nv;
      });
    return (
      <label key={k} className="campo-consola" title={r.l}>
        {k}
        {r.tipo === 'bool' ? (
          <Selector
            disabled={!editable}
            valor={v === undefined ? '' : String(v)}
            onCambio={(x) => set(x === '' ? undefined : x === 'true')}
            opciones={[
              { valor: '', etiqueta: `default (${r.def ? 'si' : 'no'})` },
              { valor: 'true', etiqueta: 'si' },
              { valor: 'false', etiqueta: 'no' },
            ]}
          />
        ) : r.tipo === 'enum' ? (
          <Selector
            disabled={!editable}
            valor={v === undefined ? '' : String(v)}
            onCambio={(x) => set(x || undefined)}
            opciones={[{ valor: '', etiqueta: `default (${r.def})` }, ...r.opciones.map((o) => ({ valor: o, etiqueta: o }))]}
          />
        ) : (
          <CampoNumero
            disabled={!editable}
            min={r.min}
            max={r.max}
            paso={r.tipo === 'decimal' ? 0.01 : 1}
            placeholder={String(r.def)}
            valor={v === undefined ? undefined : Number(v)}
            onCambio={(n) => set(n)}
          />
        )}
      </label>
    );
  };
  const contrato = b.legal?.contrato_encargo;
  const contratoOk = !!contrato?.version && !!contrato.firmado_en;

  return (
    <div className="dos-columnas">
      <section className="panel columna-form">
        <div className="rejilla-campos">
          {campo('Razon social', c.razon_social, (s) => cambiar((x) => void ((x.centro ??= {}).razon_social = s)))}
          {campo('RUT', c.rut, (s) => cambiar((x) => void ((x.centro ??= {}).rut = formatearRut(s))), { max: 12, ph: '76.123.456-7' })}
          <label className="campo-consola">
            Tipo de entidad
            <Selector
              disabled={!editable}
              valor={c.tipo_entidad ?? ''}
              onCambio={(t) => cambiar((x) => void ((x.centro ??= {}).tipo_entidad = (t || undefined) as (typeof TIPOS_ENTIDAD)[number]))}
              opciones={[{ valor: '', etiqueta: '-' }, ...TIPOS_ENTIDAD.map((t) => ({ valor: t, etiqueta: t }))]}
            />
          </label>
          {campo('Admin inicial', c.admin?.correo, (s) => cambiar((x) => void (((x.centro ??= {}).admin ??= {}).correo = s)), { tipo: 'email', ph: 'correo' })}
          {campo('Nombre del admin', c.admin?.nombre, (s) => cambiar((x) => void (((x.centro ??= {}).admin ??= {}).nombre = s)), { max: 120 })}
          {campo('Responsable de datos (recibe exportes)', c.responsable_datos?.correo, (s) => cambiar((x) => void (((x.centro ??= {}).responsable_datos ??= {}).correo = s)), {
            tipo: 'email',
            ph: 'correo',
          })}
          {campo('Nombre del responsable', c.responsable_datos?.nombre, (s) => cambiar((x) => void (((x.centro ??= {}).responsable_datos ??= {}).nombre = s)), { max: 120 })}
          {campo('Dominio', b.dominio?.valor, (s) => cambiar((x) => void (((x.dominio ??= {}).tipo ??= 'subdominio'), (x.dominio.valor = s.toLowerCase()))), {
            ph: `${slug ?? '<slug>'}.${dominioBase}`,
            max: 253,
          })}
        </div>
        <details className="mas">
          <summary className="mono-corto">Mas datos de la entidad (nombre, direccion, custodio, tipo de dominio)</summary>
          <div className="rejilla-campos" style={{ marginTop: 8 }}>
            {campo('Nombre del centro', c.nombre, (s) => cambiar((x) => void ((x.centro ??= {}).nombre = s)), { max: 120 })}
            {campo('Direccion', c.direccion, (s) => cambiar((x) => void ((x.centro ??= {}).direccion = s)))}
            {campo('Custodio de recuperacion', c.custodio?.nombre, (s) => cambiar((x) => void (((x.centro ??= {}).custodio ??= {}).nombre = s)), { max: 120 })}
            {campo('Rol del custodio', c.custodio?.rol, (s) => cambiar((x) => void (((x.centro ??= {}).custodio ??= {}).rol = s)), { max: 80 })}
            <label className="campo-consola">
              Tipo de dominio
              <Selector
                disabled={!editable}
                valor={b.dominio?.tipo ?? 'subdominio'}
                onCambio={(t) => cambiar((x) => void ((x.dominio ??= {}).tipo = t as 'subdominio' | 'propio'))}
                opciones={[
                  { valor: 'subdominio', etiqueta: 'subdominio' },
                  { valor: 'propio', etiqueta: 'propio (custom hostname o DNS delegado)' },
                ]}
              />
            </label>
          </div>
        </details>

        <div className="bloque-form">
          <span className="etiqueta">Estilo</span>
          <div className="filtros">
            {TEMAS.map((t) => (
              <button key={t} type="button" className="boton" disabled={!editable} aria-pressed={(b.estilo?.tema ?? 'moderno') === t} onClick={() => cambiar((x) => void ((x.estilo ??= {}).tema = t))}>
                {t}
              </button>
            ))}
            <button type="button" className="boton" disabled title="Disenado, pero aun no implementado en el ERP (requisito R8): hoy se aprueban moderno y cuaderno">
              editorial
            </button>
            <input
              className="campo-texto"
              style={{ flex: '0 1 120px' }}
              aria-label="Color de marca"
              placeholder="#2E6E6E"
              maxLength={7}
              disabled={!editable}
              value={b.estilo?.marca?.principal ?? ''}
              onChange={(e) => cambiar((x) => void (((x.estilo ??= {}).marca ??= {}).principal = e.target.value))}
            />
          </div>
          {preferencia && (
            <span className="mono-corto">
              Preferencia del centro en la solicitud: {preferencia === 'propios' ? 'tiene sus colores (cargar el color de marca)' : preferencia === 'aun_no_se' ? 'aun no sabe (definir en la primera sesion)' : preferencia}
              {preferencia === 'editorial' && ' · disenado pero sin implementar en el ERP: elegir moderno o cuaderno por ahora'}
            </span>
          )}
        </div>

        <div className="bloque-form">
          <span className="etiqueta">Modulos (las dependencias se agregan solas)</span>
          <div className="switches">
            {MODULOS_MVP.map((m) => {
              const on = modulos.includes(m);
              const requerido = on && !elegidos.includes(m);
              const por = modulos.filter((x) => DEPENDENCIAS[x].requiere.includes(m));
              return (
                <button
                  key={m}
                  type="button"
                  role="switch"
                  aria-checked={on}
                  className="switch"
                  data-requerido={requerido}
                  disabled={!editable || requerido}
                  title={requerido ? `Lo requiere ${por.join(', ')}` : DEPENDENCIAS[m].requiere.length ? `Requiere ${DEPENDENCIAS[m].requiere.join(', ')}` : undefined}
                  onClick={() =>
                    cambiar((x) => {
                      const sel = ordenarModulos((x.modulos ?? []) as Modulo[]);
                      x.modulos = sel.includes(m) ? sel.filter((y) => y !== m) : ordenarModulos([...sel, m]);
                    })
                  }
                >
                  <span className="perilla" aria-hidden="true" />
                  {NOMBRE_MODULO[m]}
                  {requerido && <span className="mono-corto">requerido</span>}
                </button>
              );
            })}
          </div>
        </div>

        <div className="rejilla-campos estrecha">{REGLAS_PRINCIPALES.map(regla)}</div>
        <details className="mas">
          <summary className="mono-corto">Todas las reglas ({CAMPOS_REGLAS.length}; vacio = default del ERP)</summary>
          <div className="rejilla-campos estrecha" style={{ marginTop: 8 }}>
            {CAMPOS_REGLAS.filter((r) => !REGLAS_PRINCIPALES.includes(r.k)).map((r) => regla(r.k))}
          </div>
        </details>

        <div className="bloque-form">
          <span className="etiqueta">Canal de version</span>
          <div className="filtros">
            {(['estable', 'beta', 'fija'] as const).map((k) => (
              <button key={k} type="button" className="boton" disabled={!editable} aria-pressed={canal === k} onClick={() => cambiar((x) => void (x.version = k === 'fija' ? { fija: '0.1.0' } : { canal: k }))}>
                {k === 'fija' ? 'version fija' : k}
              </button>
            ))}
            {canal === 'fija' && b.version && 'fija' in b.version && (
              <input
                className="campo-texto"
                style={{ flex: '0 1 100px' }}
                aria-label="Version fija"
                disabled={!editable}
                value={b.version.fija}
                onChange={(e) => cambiar((x) => void (x.version = { fija: e.target.value }))}
              />
            )}
          </div>
        </div>

        <div className="contrato" data-ok={contratoOk}>
          <span className="casilla" aria-hidden="true">
            {contratoOk ? 'x' : ''}
          </span>
          <span>Contrato de encargo de tratamiento firmado</span>
          <input
            className="campo-texto"
            aria-label="Version del contrato"
            placeholder="version (2026-11)"
            maxLength={40}
            disabled={!editable}
            value={contrato?.version ?? ''}
            onChange={(e) => cambiar((x) => void (((x.legal ??= {}).contrato_encargo ??= {}).version = e.target.value))}
          />
          <CampoFecha
            etiqueta="Fecha de firma"
            disabled={!editable}
            valor={contrato?.firmado_en ?? ''}
            onCambio={(f) => cambiar((x) => void (((x.legal ??= {}).contrato_encargo ??= {}).firmado_en = f))}
          />
        </div>
      </section>

      <div className="columna-lateral">
        {lateral}
        <section className="codigo" aria-label="Manifiesto en YAML">
          <div className="codigo-barra">centros/{slug ?? '<slug>'}.yaml</div>
          <pre>{vistaYaml}</pre>
        </section>
        <section className="panel">
          <h2>Validacion P0</h2>
          <ul className="chequeos">
            {CHEQUEOS.map((k) => {
              const errores = p0.errores.filter((e) => k.prefijos.some((p) => e.startsWith(p)));
              return (
                <li key={k.l} title={errores.join('\n') || undefined}>
                  <span className={`chip ${errores.length ? 'danger' : 'ok'}`}>{errores.length ? 'x' : 'ok'}</span>
                  <span>
                    {k.l}
                    {errores.length > 0 && <span className="mono-corto"> · {errores[0]}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
          {editable && (
            <div className="acciones borde-arriba">
              <button type="button" className="boton" disabled={ocupado || !sucio} onClick={() => void guardar()}>
                Guardar revision
              </button>
              <button
                type="button"
                className="boton primario"
                disabled={ocupado || !p0.ok || estado !== 'DATOS_COMPLETOS'}
                title={estado !== 'DATOS_COMPLETOS' ? 'Se aprueba con los datos del centro completos (DATOS_COMPLETOS)' : undefined}
                onClick={async () => {
                  const ok = await confirmar({
                    etiqueta: `Manifiesto · ${slug ?? 'centro'}`,
                    titulo: 'Aprobar el manifiesto',
                    texto: 'Aprobar congela el manifiesto (revision fase 3 con hash) y el slug. Despues, los cambios nacen de una revision nueva.',
                    boton: 'Aprobar',
                  });
                  if (ok !== null) void guardar('aprobar');
                }}
              >
                Aprobar
              </button>
            </div>
          )}
          {editable && !contratoOk && (
            <span role="status" className="mono-corto aviso-warn">
              Falta registrar el contrato de encargo firmado para aprobar.
            </span>
          )}
          {sucio && <span className="mono-corto">Cambios sin guardar</span>}
          {msg && (
            <p role="status" className={`chip ${msg.ok ? 'ok' : 'danger'}`} style={{ whiteSpace: 'normal' }}>
              {msg.t}
            </p>
          )}
        </section>
      </div>
      {dialogo}
    </div>
  );
}
