/** @type {import('next').NextConfig} */
export default {
  // standalone solo en la imagen (Dockerfile): en Windows exige permisos de symlink.
  output: process.env.NEXT_STANDALONE === '1' ? 'standalone' : undefined,
  poweredByHeader: false,
  async headers() {
    return [
      {
        // El enlace de fase 2 lleva el token en la URL: que no viaje como Referer ni se indexe.
        source: '/manifiesto/:token*',
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
    ];
  },
};
