import { VistaSalidas } from './vista';

export const dynamic = 'force-dynamic';

const id = (v?: string) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
};

/** ?salida=<id> abre esa salida; ?centro=<id> (desde el silo) abre la mas reciente de ese centro. */
export default async function Salidas({ searchParams }: { searchParams: Promise<{ salida?: string; centro?: string }> }) {
  const q = await searchParams;
  return <VistaSalidas inicial={id(q.salida)} centro={id(q.centro)} />;
}
