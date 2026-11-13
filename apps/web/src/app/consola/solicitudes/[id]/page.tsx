import { redirect } from 'next/navigation';

/** Ruta antigua: el detalle vive en el panel derecho de Solicitudes; el manifiesto, en Manifiestos. */
export default async function Antigua({ params }: { params: Promise<{ id: string }> }) {
  redirect(`/consola/solicitudes?id=${encodeURIComponent((await params).id)}`);
}
