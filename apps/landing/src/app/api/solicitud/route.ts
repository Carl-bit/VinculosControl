import type { NextRequest } from 'next/server';

import { reenviar } from '../proxy';

/* Solicitud de fase 1 (conversacion de la landing, o enlace compartido por el operador). */
export function POST(req: NextRequest) {
  return reenviar(req, 'solicitudes', 10_000);
}
