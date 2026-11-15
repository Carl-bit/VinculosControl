'use client';

import { useState } from 'react';

import { Selector } from '@/componentes/controles';
import type { PedidoConfirmacion } from '@/componentes/dialogo';

/*
 * P5 de APROVISIONAR: los 3 custodios de la llave de recuperacion (una parte
 * cada uno; 2 de 3 la reconstruyen). Se llenan ANTES de correr el script: la
 * consola arma el comando con estos mismos custodios, y "Llaves listas" los
 * registra (nunca las partes). No se buscan en el silo: en P5 aun no tiene
 * usuarios (el ADMIN llega en P10) y el plano de control no lee personas del silo.
 */

const ROLES = ['Proveedor', 'Centro', 'Sobre offline', 'Otro'];
const PREDETERMINADOS = ['Proveedor', 'Centro', 'Sobre offline'];
/** Mismo formato que el script del ERP (Nombre:rol separados por coma): sin ':' ni ','. */
const VALIDO = /^[^:,\r\n]{2,80}$/;

interface Fila {
  nombre: string;
  rol: string;
  otro: string;
}

const rolDe = (f: Fila) => (f.rol === 'Otro' ? f.otro.trim() : f.rol);

export function PanelLlaves({
  jobId,
  slug,
  ocupado,
  confirmar,
  enviar,
}: {
  jobId: number;
  slug: string;
  ocupado: boolean;
  confirmar: (p: PedidoConfirmacion) => Promise<string | null>;
  enviar: (custodios: { nombre: string; rol: string }[]) => void;
}) {
  const [filas, setFilas] = useState<Fila[]>(PREDETERMINADOS.map((rol) => ({ nombre: '', rol, otro: '' })));
  const [prueba, setPrueba] = useState('real');

  const cambiar = (i: number, cambio: Partial<Fila>) => setFilas((fs) => fs.map((f, j) => (j === i ? { ...f, ...cambio } : f)));
  const errores = filas.map((f) => {
    if (!f.nombre.trim()) return 'falta el nombre';
    if (!VALIDO.test(f.nombre.trim())) return 'nombre sin : ni , (2 a 80)';
    if (!VALIDO.test(rolDe(f)) || rolDe(f).length > 40) return 'rol sin : ni , (2 a 40)';
    return null;
  });
  const completo = errores.every((e) => e === null);
  const lista = filas.map((f) => `${f.nombre.trim()}:${rolDe(f)}`).join(',');
  const extraPs = prueba === 'prueba' ? ' -Prueba' : '';
  const extraSh = prueba === 'prueba' ? ' --prueba' : '';
  const comando = completo
    ? `Windows:  .\\infra\\host-b\\llaves-silo.ps1 -Slug ${slug} -Custodios "${lista}"${extraPs}\nLinux:    sh infra/host-b/llaves-silo.sh ${slug} "${lista}"${extraSh}`
    : 'Completa los 3 custodios para ver el comando.';

  return (
    <section className="panel" aria-label="Llaves del silo">
      <h2>P5 · Llaves del silo (manual)</h2>
      <p className="mono-corto" style={{ marginTop: 0 }}>
        La llave de recuperacion se divide en 3 partes y 2 cualquiera la reconstruyen. Indica a quien va cada parte antes de correr el script: el comando se arma con
        estos custodios y quedan registrados en el silo. Aqui se guardan solo nombres y roles, nunca las partes.
      </p>

      <div className="custodios" role="group" aria-label="Custodios de las partes">
        {filas.map((f, i) => (
          <div key={i} className="custodio-fila">
            <span className="paso-codigo">Parte {i + 1}</span>
            <label className="campo-consola">
              Nombre
              <input className="campo-texto" value={f.nombre} maxLength={80} onChange={(e) => cambiar(i, { nombre: e.target.value })} placeholder="Nombre y apellido o descripcion" />
            </label>
            <label className="campo-consola">
              Rol
              <Selector valor={f.rol} opciones={ROLES.map((r) => ({ valor: r, etiqueta: r }))} onCambio={(v) => cambiar(i, { rol: v })} etiqueta={`Rol del custodio de la parte ${i + 1}`} />
            </label>
            {f.rol === 'Otro' ? (
              <label className="campo-consola">
                Cual
                <input className="campo-texto" value={f.otro} maxLength={40} onChange={(e) => cambiar(i, { otro: e.target.value })} placeholder="Rol" />
              </label>
            ) : (
              <span />
            )}
            <span className={`mono-corto ${errores[i] ? 't-warn' : ''}`}>{errores[i] ?? 'ok'}</span>
          </div>
        ))}
      </div>

      <div className="acciones">
        <label className="campo-consola">
          Tipo de silo
          <Selector
            valor={prueba}
            opciones={[
              { valor: 'real', etiqueta: 'Centro real: entregar las partes' },
              { valor: 'prueba', etiqueta: 'Silo de prueba: borrar las partes' },
            ]}
            onCambio={setPrueba}
          />
        </label>
      </div>
      {prueba === 'prueba' ? (
        <p className="chip warn" style={{ whiteSpace: 'normal' }}>
          Con -Prueba el script borra las partes al terminar: nadie podra recuperar la llave. Solo para silos de prueba.
        </p>
      ) : (
        <p className="mono-corto">Al terminar, entrega cada parte (infra/secrets/{slug}/partes_entregar/) a su custodio por un canal distinto y despues borra la carpeta.</p>
      )}

      <p className="mono-corto">En el host B, desde la raiz del plano de control (llama al script de llaves del ERP con el .env que dejo el ejecutor):</p>
      <pre className="codigo" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
        {comando}
      </pre>

      <button
        type="button"
        className="boton primario"
        disabled={ocupado || !completo}
        title={completo ? undefined : 'Completa los 3 custodios'}
        onClick={async () => {
          const ok = await confirmar({
            etiqueta: `Job #${jobId} · erp-${slug}`,
            titulo: 'Llaves listas',
            texto: `Confirmas que corriste el script con estos custodios: ${filas.map((f, i) => `parte ${i + 1}, ${f.nombre.trim()} (${rolDe(f)})`).join('; ')}. El agente levantara el silo completo; si la KEK no esta, el job vuelve a esperar aqui.`,
            boton: 'Confirmar llaves',
          });
          if (ok !== null) enviar(filas.map((f) => ({ nombre: f.nombre.trim(), rol: rolDe(f) })));
        }}
      >
        Llaves listas
      </button>
    </section>
  );
}
