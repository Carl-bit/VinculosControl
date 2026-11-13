import { Lista } from './lista';

/** La solicitud elegida (?id=) llega por la URL. El enlace para compartir esta en la barra lateral. */
export const dynamic = 'force-dynamic';

export default async function Solicitudes({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const id = Number((await searchParams).id);
  return <Lista inicial={Number.isInteger(id) && id > 0 ? id : undefined} />;
}
