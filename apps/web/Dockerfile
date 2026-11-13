# Consola web (host A). Next standalone. Usa packages/manifest (modulos, reglas, P0).
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY packages/manifest/package.json packages/manifest/
RUN pnpm install --frozen-lockfile --filter @vc/web...
COPY packages/manifest packages/manifest
COPY apps/web apps/web
RUN pnpm --filter @vinculos/manifest build && NEXT_STANDALONE=1 pnpm --filter @vc/web build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
USER node
CMD ["node", "apps/web/server.js"]
