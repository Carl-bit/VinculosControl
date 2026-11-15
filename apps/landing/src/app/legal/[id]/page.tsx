import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { CONTACTO_CORREO, LEGALES } from '../../datos';
import { Pie } from '../../pie';

/**
 * Paginas legales provisorias (privacidad, terminos, tratamiento de datos):
 * existen para que el pie tenga sus enlaces; el texto final se escribe cuando
 * esten los documentos (seccion 12 del contexto). No se indexan.
 */
type Props = { params: Promise<{ id: string }> };

export const dynamicParams = false;
export function generateStaticParams() {
  return LEGALES.map((x) => ({ id: x.id }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const doc = LEGALES.find((x) => x.id === id);
  return { title: `${doc?.l ?? 'Legal'} · Vinculos`, robots: { index: false, follow: false } };
}

export default async function Legal({ params }: Props) {
  const { id } = await params;
  const doc = LEGALES.find((x) => x.id === id);
  if (!doc) notFound();
  return (
    <div className="raiz" data-tema="vinculos">
      <div className="contenido">
        <header className="cabecera">
          <a href="/" className="logo">
            <span aria-hidden="true" className="logo-bloques">
              <span />
              <span />
              <span />
              <span />
            </span>
            Vinculos
          </a>
          <a href="/" className="boton-borde chico cabecera-derecha">
            Volver al inicio
          </a>
        </header>
        <main className="legal">
          <span className="kicker">Documento en preparación</span>
          <h1>{doc.l}</h1>
          <p>Este documento se está redactando y se publicará aquí antes de que la plataforma reciba datos reales de centros.</p>
          <p>
            Mientras tanto, si tienes preguntas escríbenos a <a href={`mailto:${CONTACTO_CORREO}`}>{CONTACTO_CORREO}</a>.
          </p>
        </main>
        <Pie inicio="/" />
      </div>
    </div>
  );
}
