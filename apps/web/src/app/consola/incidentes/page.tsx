import { VistaIncidentes } from './vista';

export const dynamic = 'force-dynamic';

export default async function Incidentes({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const id = Number((await searchParams).id);
  return <VistaIncidentes inicial={Number.isInteger(id) && id > 0 ? id : undefined} />;
}
