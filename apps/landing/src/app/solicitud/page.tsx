import type { Metadata } from 'next';

import { FormularioSolicitud } from './formulario';

export const metadata: Metadata = { title: 'Solicitud · Vinculos', robots: { index: false, follow: false } };
export const dynamic = 'force-static';

/** Formulario de solicitud que comparte el operador (pagina aparte de la landing, mismo contenedor y misma API). */
export default function Solicitud() {
  return (
    <div className="raiz" data-tema="vinculos">
      <div className="contenido solo-formulario">
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
            Conoce Vinculos
          </a>
        </header>
        <FormularioSolicitud />
      </div>
    </div>
  );
}
