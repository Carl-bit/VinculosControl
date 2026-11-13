'use client';

import { Shell } from '@/componentes/piezas';
import { TablaSilos } from '@/componentes/tabla-silos';
import { useDatos, type Resumen } from '@/lib/api';

export default function Silos() {
  const { datos: r, error, recargar } = useDatos<Resumen>('consola/resumen');
  return (
    <Shell resumen={r} titulo="silos">
      <div>
        <h1>Silos</h1>
        <span className="sub">Un stack erp-&lt;slug&gt; por centro: base Postgres, API, front y secretos propios{error && ` · error: ${error}`}</span>
      </div>
      <section className="panel">
        <TablaSilos resumen={r} recargar={recargar} />
      </section>
    </Shell>
  );
}
