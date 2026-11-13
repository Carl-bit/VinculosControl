import type { Metadata } from 'next';
import { Figtree } from 'next/font/google';

import './globals.css';

/** Figtree: next/font la descarga al compilar y la sirve desde el mismo origen (como el ERP). */
const figtree = Figtree({ subsets: ['latin'], variable: '--font-figtree', display: 'swap' });

export const metadata: Metadata = {
  title: 'Vinculos · plataforma para centros de salud mental',
  description: 'Tu plataforma se arma por vinculos: elige los modulos que tu centro necesita.',
};

export default function Raiz({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" data-tema="moderno" className={figtree.variable}>
      <body>{children}</body>
    </html>
  );
}
