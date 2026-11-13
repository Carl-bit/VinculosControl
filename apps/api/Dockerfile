# API del plano de control (host A). Build en el monorepo pnpm (con packages/manifest).
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/manifest/package.json packages/manifest/
RUN pnpm install --frozen-lockfile --filter @vc/api...
COPY packages/manifest packages/manifest
COPY apps/api apps/api
RUN pnpm --filter @vinculos/manifest build \
  && pnpm --filter @vc/api exec prisma generate && pnpm --filter @vc/api build \
  && pnpm deploy --filter @vc/api --prod --legacy /out && cp -r apps/api/dist apps/api/prisma /out/ && cd /out && npx prisma generate

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /out ./
USER node
# Migraciones al arrancar (idempotente); luego la API.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
