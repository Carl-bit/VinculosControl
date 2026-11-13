import { redirect } from 'next/navigation';

/** El landing por bloques llega en la fase 6 (docs/roadmap.md). Mientras, la portada es el formulario. */
export default function Inicio() {
  redirect('/solicitud');
}
