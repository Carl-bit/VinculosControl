import { CONTACTO_CORREO, DEMO_URL, LEGALES, PIE } from './datos';

/**
 * Pie de la landing, de /solicitud y de las paginas legales. Provisorio: los
 * textos legales y el correo de contacto se reemplazan en datos.ts cuando
 * existan. `inicio`: ruta base de los enlaces a secciones ("" en la landing,
 * "/" fuera de ella).
 */
export function Pie({ inicio = '' }: { inicio?: string }) {
  const s = (id: string) => `${inicio}#${id}`;
  return (
    <footer className="pie">
      <div className="pie-columnas">
        <div className="pie-marca">
          <strong>Vinculos</strong>
          <span>Tu plataforma se arma por vínculos. Plataforma modular para centros de psicología.</span>
        </div>
        <nav aria-label="Plataforma" className="pie-columna">
          <span className="rotulo">Plataforma</span>
          <a href={s('dia')}>Un día en tu centro</a>
          <a href={s('bloques')}>Bloques</a>
          <a href={s('estilos')}>Estilos</a>
          <a href={s('confianza')}>Cómo trabajamos</a>
          <a href={DEMO_URL} target="_blank" rel="noopener">
            Demo
          </a>
        </nav>
        <nav aria-label="Legal" className="pie-columna">
          <span className="rotulo">Legal</span>
          {LEGALES.map((x) => (
            <a key={x.id} href={`/legal/${x.id}`}>
              {x.l}
            </a>
          ))}
        </nav>
        <div className="pie-columna">
          <span className="rotulo">Contacto</span>
          <a href={`mailto:${CONTACTO_CORREO}`}>{CONTACTO_CORREO}</a>
          <span>{PIE.horario}</span>
          <span>{PIE.ubicacion}</span>
          <span className="pie-nota">
            Las solicitudes se reciben solo por la plataforma: <a href={s('conversemos')}>solicitar mi plataforma</a>.
          </span>
        </div>
      </div>
      <div className="pie-final">
        <span>
          © {PIE.anio} {PIE.razonSocial}
        </span>
        <span>Información provisoria: datos de contacto y textos legales en preparación.</span>
      </div>
    </footer>
  );
}
