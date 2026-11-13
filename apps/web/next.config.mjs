/** @type {import('next').NextConfig} */
export default {
  // standalone solo en la imagen (Dockerfile): en Windows exige permisos de symlink.
  output: process.env.NEXT_STANDALONE === '1' ? 'standalone' : undefined,
  poweredByHeader: false,
};
