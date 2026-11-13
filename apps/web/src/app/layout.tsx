import type { Metadata } from 'next';
import { JetBrains_Mono } from 'next/font/google';

import './globals.css';

const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' });

export const metadata: Metadata = {
  title: 'vinculos-control',
  robots: { index: false, follow: false },
};

export default function Raiz({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={mono.variable}>
      <body>{children}</body>
    </html>
  );
}
