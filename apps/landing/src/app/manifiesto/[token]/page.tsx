import type { Metadata } from 'next';

import { DatosFormales } from './datos';
import './manifiesto.css';

export const metadata: Metadata = { title: 'Datos de tu centro · Vinculos', robots: { index: false, follow: false } };

type Props = { params: Promise<{ token: string }> };

/** Fase 2: el centro completa sus datos formales por su enlace privado (7 dias). */
export default async function Manifiesto({ params }: Props) {
  const { token } = await params;
  return (
    <main className="f2-pagina">
      <span className="f2-marca">
        Vinculos<span>.</span>
      </span>
      <DatosFormales token={token} />
    </main>
  );
}
