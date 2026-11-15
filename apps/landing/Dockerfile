# Landing publica de Vinculos (apps/landing). Sitio aparte del formulario compartido (apps/sitio) y de la consola. Next standalone.
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/landing/package.json apps/landing/
COPY packages/manifest/package.json packages/manifest/
RUN pnpm install --frozen-lockfile --filter @vc/landing...
COPY packages/manifest packages/manifest
COPY apps/landing apps/landing
RUN pnpm --filter @vinculos/manifest build && NEXT_STANDALONE=1 pnpm --filter @vc/landing build

FROM node:22-alpine
WORKDIR /app
# HOSTNAME=0.0.0.0: sin esto Next escucha solo en la IP del nombre del contenedor (el 502 del ERP).
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /repo/apps/landing/.next/standalone ./
COPY --from=build /repo/apps/landing/.next/static ./apps/landing/.next/static
USER node
CMD ["node", "apps/landing/server.js"]
