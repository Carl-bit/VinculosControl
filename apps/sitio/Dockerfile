# Sitio publico (landing + formulario fase 1). Separado de la consola. Next standalone.
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/sitio/package.json apps/sitio/
COPY packages/manifest/package.json packages/manifest/
RUN pnpm install --frozen-lockfile --filter @vc/sitio...
COPY packages/manifest packages/manifest
COPY apps/sitio apps/sitio
RUN pnpm --filter @vinculos/manifest build && NEXT_STANDALONE=1 pnpm --filter @vc/sitio build

FROM node:22-alpine
WORKDIR /app
# HOSTNAME=0.0.0.0: sin esto Next escucha solo en la IP del nombre del contenedor (el 502 del ERP).
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /repo/apps/sitio/.next/standalone ./
COPY --from=build /repo/apps/sitio/.next/static ./apps/sitio/.next/static
USER node
CMD ["node", "apps/sitio/server.js"]
