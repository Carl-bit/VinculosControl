import { Landing } from './landing';

/** Pagina estatica (SSG): el contenido no depende de la peticion. */
export const dynamic = 'force-static';

export default function Inicio() {
  return <Landing />;
}
