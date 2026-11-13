import { MODULOS_MVP, type Modulo } from '@vinculos/manifest';
import type { Metadata } from 'next';

import { Formulario } from './formulario';

export const metadata: Metadata = { title: 'Solicitar Vinculos para tu centro' };

/**
 * `?modulos=AGENDA,FICHAS` precarga los bloques (landing o enlace de la consola).
 * `?via=enlace` marca que llego por el enlace que comparte el operador.
 */
type Props = { searchParams: Promise<{ modulos?: string; via?: string }> };

export default async function Solicitud({ searchParams }: Props) {
  const q = await searchParams;
  const pedidos = (q.modulos ?? '').split(',');
  const precarga: Modulo[] = MODULOS_MVP.filter((m) => pedidos.includes(m));
  return (
    <main className="pagina">
      <span className="marca">
        Vinculos<span>.</span>
      </span>
      <div>
        <h1 className="titulo">Tu plataforma se arma por vinculos.</h1>
        <p className="bajada">Cuentanos de tu centro y que te interesa. Te contactamos para una reunion y ahi armamos juntos la plataforma.</p>
      </div>
      <Formulario precarga={precarga} via={q.via === 'enlace' ? 'enlace' : 'formulario'} />
    </main>
  );
}
