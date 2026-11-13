import { type NextRequest, NextResponse } from 'next/server';

/*
 * Sin cookie de sesion, /consola manda a /ingreso. La validez real la decide
 * la API en cada peticion (SesionGuard): si la sesion vencio, la API responde
 * 401, el proxy borra la cookie y la consola vuelve a /ingreso.
 */
export function middleware(req: NextRequest) {
  if (req.cookies.get('vc_sesion')?.value) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = '/ingreso';
  url.search = '';
  return NextResponse.redirect(url);
}

export const config = { matcher: ['/consola', '/consola/:path*'] };
