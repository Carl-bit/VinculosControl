# Ejecutor de silos del host B (opcion C). Node + JS compilado, sin dependencias de runtime.
# Es el unico contenedor con el socket de Docker: verbos cerrados (src/verbos.ts).
FROM node:22-alpine AS build
WORKDIR /app
COPY apps/ejecutor/package.json apps/ejecutor/tsconfig.json apps/ejecutor/tsconfig.build.json ./
RUN npm install --no-save --no-audit --no-fund typescript@5.7 @types/node@22
COPY apps/ejecutor/src ./src
RUN npx tsc -p tsconfig.build.json

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
# Corre como root dentro del contenedor: el socket de Docker es root:docker en el host.
# El riesgo se acota con verbos cerrados, red interna y token, no con el usuario.
CMD ["node", "dist/index.js"]
