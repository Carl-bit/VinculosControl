# Agente del host B. Imagen chica: Node + JS compilado, sin dependencias de runtime.
FROM node:22-alpine AS build
WORKDIR /app
COPY apps/agente/package.json apps/agente/tsconfig.json apps/agente/tsconfig.build.json ./
RUN npm install --no-save --no-audit --no-fund typescript@5.7 @types/node@22
COPY apps/agente/src ./src
RUN npx tsc -p tsconfig.build.json

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
USER node
CMD ["node", "dist/index.js"]
