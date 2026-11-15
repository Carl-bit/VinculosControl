import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, Caveat, Figtree, Fraunces, Inter, Nunito } from 'next/font/google';

import './globals.css';

/* next/font descarga las fuentes al compilar y las sirve desde el mismo origen: sin llamadas a terceros. */
const figtree = Figtree({ subsets: ['latin'], variable: '--f-figtree', display: 'swap' });
const bricolage = Bricolage_Grotesque({ subsets: ['latin'], weight: ['600', '700', '800'], variable: '--f-bricolage', display: 'swap' });
const caveat = Caveat({ subsets: ['latin'], weight: ['700'], variable: '--f-caveat', display: 'swap' });
const nunito = Nunito({ subsets: ['latin'], variable: '--f-nunito', display: 'swap' });
const fraunces = Fraunces({ subsets: ['latin'], variable: '--f-fraunces', display: 'swap' });
const inter = Inter({ subsets: ['latin'], variable: '--f-inter', display: 'swap' });

export const metadata: Metadata = {
  title: 'Vinculos · plataforma modular para centros de psicología',
  description: 'Tu plataforma se arma por vínculos: fichas, agenda, equipo, match y sitio del centro. Activa solo los bloques que tu centro necesita.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function Raiz({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={[figtree, bricolage, caveat, nunito, fraunces, inter].map((f) => f.variable).join(' ')}>
      <body>{children}</body>
    </html>
  );
}
