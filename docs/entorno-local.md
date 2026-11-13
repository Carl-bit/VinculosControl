# Entorno local desde cero (otro computador, despues de un pull)

Guia para dejar funcionando, en un PC nuevo, todo lo necesario para desarrollar
y probar: el ERP (repo `SW Proyecto`) y el plano de control (este repo). Sirve
tambien para revisar que nada vital quedo fuera de git.

Ultima revision: 2026-11-13. Si un paso choca con el ERP, manda el ERP
(`SW Proyecto/README.md` y `SW Proyecto/docs/operacion/servidor_pruebas.md`).

## 0. Que queda corriendo

| Pieza | Repo | Como corre | Direccion local |
|---|---|---|---|
| BD de desarrollo del ERP (`erp-centro-prueba-db-1`) | ERP | Docker | `127.0.0.1:5432` |
| API del ERP | ERP | Node, fuera de Docker (`npm run dev:api`) | http://localhost:3001/api |
| Front del ERP (centro, panel ADMIN, portal) | ERP | Node (`npm run dev:front`) | http://localhost:3000 |
| Mailpit del ERP (codigos de ingreso del centro) | ERP | `tools/mailpit` | http://localhost:8025 (SMTP 1025) |
| BD `control` | Control | Docker (host A) | `127.0.0.1:5440` |
| API del plano de control | Control | Docker (host A) | http://127.0.0.1:4000 |
| Consola del operador | Control | Docker (host A) | http://127.0.0.1:3100 |
| Sitio publico (formulario; landing en fase 6) | Control | Docker (host A) | http://127.0.0.1:3200 |
| Mailpit de la consola (codigo del login) | Control | Docker (host A) | http://127.0.0.1:8026 (SMTP 1026) |
| Agente, ejecutor y socket-proxy | Control | Docker (host B, mismo PC en pruebas) | sin puertos |

Silos completos en Docker (stack `erp-<slug>` con Traefik y tunel) son
opcionales en local: seccion 8.

## 1. Requisitos (Windows)

- Git for Windows (trae `sh`, `sha256sum`, `openssl`). Los scripts `.sh` se
  corren desde Git Bash o con `sh` en PowerShell.
- Docker Desktop corriendo.
- Node 22: `winget install OpenJS.NodeJS.22` (terminal nueva despues).
- pnpm 10 (plano de control): `corepack enable` y luego `corepack prepare pnpm@10.12.1 --activate`.
- PostgreSQL 18 (solo las herramientas: `initdb`, `pg_ctl`, `psql` en el PATH)
  para los tests de BD y e2e del ERP. Si se instala el servicio de Windows,
  detenerlo: el 5432 lo usa la BD de desarrollo en Docker.
- Puertos libres: 3000, 3001, 3100, 3200, 4000, 5432, 5440, 1025, 1026, 8025, 8026.

## 2. Clonar

Los dos repos lado a lado (las rutas de los ejemplos asumen el Escritorio):

```sh
git clone <repo del ERP>              "SW Proyecto"
git clone <repo de vinculos-control>  "Vinculos Control"
```

## 3. Lo que NO viaja con git (y como se regenera)

Nada de esto se sube; cada PC lo genera. Si falta, se recrea con la seccion indicada.

| Que | Donde | Se regenera en |
|---|---|---|
| `.env` y `.env.local` de cada app | ambos repos | 4 y 5 (copiar los `.env.example`) |
| KEK, `recuperacion.pub`, partes Shamir, `respaldo.key` | ERP `infra/secrets/<slug>/` | 4 (`reset_dev.sh`) o `servidor.sh` |
| `.env` de los silos de prueba | ERP `infra/servidor/silos/` | `servidor.sh` (seccion 8) |
| Tokens de `/api/internal` | ERP `infra/servidor/internos/`, Control `infra/host-b/internos/` | 7 |
| Respaldos de BD | ERP `infra/respaldos/` | cron de `respaldar.sh` |
| Datos (BD de desarrollo, BD `control`) | volumenes de Docker | 4, 5 (seed y CLI) |
| Cuentas de la consola (operadores) | BD `control` | 5 (`crear-operador`) |

Los `.gitignore` de los dos repos cubren todo lo anterior (revisados
2026-11-13) con una red de seguridad extra para `*.token`, `*.key`, `*.pem`,
`kek`, `*.shamir` y respaldos. Antes de publicar un repo: seccion 10.

## 4. ERP en desarrollo

Detalle en `SW Proyecto/README.md` ("Levantar en local"). Resumen:

```sh
cd "SW Proyecto"
cp infra/.env.example infra/.env
cp backend/.env.example backend/.env          # SMTP_URL="smtp://localhost:1025"
cp frontend/.env.example frontend/.env.local
npm install && npm --prefix backend install && npm --prefix frontend install
sh infra/scripts/reset_dev.sh --si            # BORRA y recrea la BD de desarrollo + llaves de dev
npm --prefix backend run seed:demo            # centro demo (docs/pruebas/usuarios_demo.md)
powershell -ExecutionPolicy Bypass -File infra\scripts\dev\instalar_mailpit.ps1   # una vez
npm run dev                                   # mailpit + API (:3001) + front (:3000)
```

El slug de la BD de desarrollo es el `CLIENTE_SLUG` de `infra/.env`
(`centro-prueba`); el agente la ve como el silo `centro-prueba` (su contenedor
`erp-centro-prueba-db-1`).

## 5. Plano de control: host A

```sh
cd "Vinculos Control"
pnpm install
cp infra/host-a/.env.example infra/host-a/.env   # CONTROL_DB_PASSWORD, CONSOLA_SECRETO y SITIO_SECRETO largos y distintos
docker compose -f infra/host-a/docker-compose.yml --env-file infra/host-a/.env up -d --build
docker exec vinculos-control-api-1 node dist/cli/crear-operador.js tu@correo.cl "Tu nombre"   # contrasena: se muestra UNA vez
docker exec vinculos-control-api-1 node dist/cli/crear-agente.js host-b                       # token del agente: UNA vez
```

- Consola: http://127.0.0.1:3100. Ingreso: correo + contrasena, luego el codigo
  de 6 digitos que llega a http://127.0.0.1:8026.
- Las migraciones de la BD `control` corren solas al arrancar la API
  (`prisma migrate deploy` en el contenedor). Tras un pull con migraciones
  nuevas: `up -d --build api`.

## 6. Plano de control: host B (en el mismo PC)

```sh
cp infra/host-b/.env.example infra/host-b/.env
```

Valores para local:

| Variable | Valor local |
|---|---|
| `CONTROL_URL` | `http://host.docker.internal:4000` |
| `AGENTE_TOKEN` | el que mostro `crear-agente` |
| `RESPALDOS_HOST` | ruta a `SW Proyecto/infra/respaldos` (puede estar vacia) |
| `EJECUTOR_TOKEN` | `openssl rand -hex 32` |
| `TOKENS_INTERNOS_HOST` | vacio (usa `infra/host-b/internos/`) |
| `SILO_INTERNO_URL` | `http://host.docker.internal:3001/api/internal` (la API del ERP corre fuera de Docker) |
| `EJECUTOR_UNIR_BORDE` | sin cambios (solo importa con silos completos, seccion 8) |

```sh
docker compose -f infra/host-b/docker-compose.yml --env-file infra/host-b/.env up -d --build
docker logs -f vinculos-agente-agente-1   # "reporte: 1 silo(s)" y "solicitudes: ..." cada minuto
```

En la consola, el silo `centro-prueba` aparece "sin adoptar".

## 7. Probar la tarea 31 en local (solicitudes de modulos, R2/R3)

1. Token interno del silo de desarrollo (una vez; el silo guarda solo el hash):

   ```sh
   cd "Vinculos Control"
   mkdir -p infra/host-b/internos
   # tr -d '\r\n': openssl de Git for Windows termina en CRLF; con \r el hash no
   # coincide y la API responde 400 al header del agente.
   openssl rand -hex 32 | tr -d '\r\n' > infra/host-b/internos/centro-prueba.token
   wc -c < infra/host-b/internos/centro-prueba.token   # debe decir 64
   HASH=$(sha256sum < infra/host-b/internos/centro-prueba.token | cut -d' ' -f1)
   cd "../SW Proyecto/backend"
   npx prisma migrate deploy                        # migraciones nuevas del ERP (identidad_silo, solicitudes_modulo)
   CLIENTE_SLUG=centro-prueba INTERNO_TOKEN_SHA256=$HASH node --env-file=.env prisma/scripts/identidad_silo.js
   ```

   `identidad_silo.js` usa `MIGRATION_DATABASE_URL` de `backend/.env` (dueno).
   Debe decir "token interno registrado". Reiniciar la API del ERP no hace falta.
   Comprobar (debe dar `{"solicitudes":[]}` y HTTP 200; sin token o con otro, 401):

   ```sh
   curl -s -H "Authorization: Bearer $(cat infra/host-b/internos/centro-prueba.token)" http://127.0.0.1:3001/api/internal/solicitudes
   ```
2. En el ERP (http://localhost:3000), entrar como `admin@centro-prueba.cl`,
   clave `dev-password` (codigo en http://localhost:8025): Configuracion >
   "Modulos, contrato y soporte" > Modulos contratados. En el centro de
   desarrollo ya estan activos todos los modulos del MVP (COBROS y WHATSAPP no
   se pueden pedir), asi que la prueba natural es **Solicitar desactivar** en
   Match. Desactivar Equipo queda bloqueado (Match y la pagina publica dependen
   de el) y una segunda solicitud del mismo modulo da 409.
3. En un minuto, la consola (Silos > `centro-prueba`) muestra la solicitud en
   "Solicitudes de modulos". **Aprobar** o **Rechazar** con un texto para el ADMIN.
4. En el siguiente ciclo del agente, el ADMIN ve el estado y el texto en la
   misma lista del ERP.
5. **Marcar aplicada** antes de cambiar `modulos_activos`: el silo la rechaza
   y la consola muestra el motivo ("Los modulos activos del centro aun no
   reflejan la solicitud"). Aplicar el cambio como dueno (hoy a mano; con R4,
   el job `reconfigurar`) y en el siguiente ciclo queda APLICADA en los dos
   lados:

   ```sh
   docker exec erp-centro-prueba-db-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "UPDATE configuracion_centro SET modulos_activos = array_remove(modulos_activos, '"'"'MATCH'"'"')"'
   # Para volver a dejar Match activo despues de la prueba:
   docker exec erp-centro-prueba-db-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "UPDATE configuracion_centro SET modulos_activos = modulos_activos || '"'"'MATCH'"'"'::modulo_centro"'
   ```

Lo mismo sin navegador (util para repetir la prueba despues de clonar):

```sh
node scripts/prueba-local/tarea31.mjs erp-solicitar MATCH DESACTIVAR
OPERADOR=tu@correo.cl OPERADOR_CLAVE='...' node scripts/prueba-local/tarea31.mjs consola-listar
OPERADOR=tu@correo.cl OPERADOR_CLAVE='...' node scripts/prueba-local/tarea31.mjs consola-decidir APROBADA "Se revisa esta semana"
node scripts/prueba-local/tarea31.mjs erp-listar          # tras un ciclo del agente: APROBADA y el texto
docker logs --tail 5 vinculos-agente-agente-1             # "solicitudes: centro-prueba ok (1 respuesta(s))"
```

Resultado de la corrida del 2026-11-13 en este PC: todos los pasos
anteriores OK (R2 -> plano de control -> decision -> R3 -> ADMIN, error de
R3 visible en la consola y APLICADA tras el cambio).

### Ejecutor (verbos de red de borde) sin silos completos

Se prueba con una red de borde de mentira y un contenedor con el nombre de
Traefik; al final se borra todo:

```sh
docker network create --internal --label cl.vinculos.red=borde --label cl.vinculos.silo=prueba-borde erp-prueba-borde_borde
docker run -d --name vinculos-servidor-traefik-1 busybox:1.36 sleep 600
docker exec vinculos-agente-agente-1 node -e "fetch('http://ejecutor:7070/v1/silos/prueba-borde/conectar_borde',{method:'POST',headers:{authorization:'Bearer '+process.env.EJECUTOR_TOKEN}}).then(r=>r.text()).then(console.log)"
docker network inspect erp-prueba-borde_borde --format '{{range .Containers}}{{.Name}} {{end}}'   # traefik y el agente
docker exec vinculos-agente-agente-1 node -e "fetch('http://ejecutor:7070/v1/silos/prueba-borde/soltar_borde',{method:'POST',headers:{authorization:'Bearer '+process.env.EJECUTOR_TOKEN}}).then(r=>r.text()).then(console.log)"
docker rm -f vinculos-servidor-traefik-1 && docker network rm erp-prueba-borde_borde
MSYS_NO_PATHCONV=1 docker exec vinculos-agente-ejecutor-1 tail -5 /var/log/ejecutor/verbos.jsonl   # auditoria local
```

## 8. Silos completos en Docker (opcional)

Para probar redes por silo, Traefik y el ejecutor como en el servidor: seguir
`SW Proyecto/docs/operacion/servidor_pruebas.md` (`servidor.sh levantar <slug>`).
`servidor.sh` genera el `.env` del silo, el token interno en
`SW Proyecto/infra/servidor/internos/<slug>.token` y une Traefik y Mailpit a la
red `erp-<slug>_borde`. Luego, en host B:

- `TOKENS_INTERNOS_HOST` = ruta a `SW Proyecto/infra/servidor/internos`.
- `SILO_INTERNO_URL` vacio (el agente entra por la red de borde).
- Unir el agente a las redes de borde con el ejecutor:

  ```sh
  docker exec vinculos-agente-agente-1 node -e "fetch('http://ejecutor:7070/v1/bordes/reconectar',{method:'POST',headers:{authorization:'Bearer '+process.env.EJECUTOR_TOKEN}}).then(r=>r.text()).then(console.log)"
  ```

  `EJECUTOR_UNIR_BORDE` debe nombrar los contenedores reales
  (`docker ps --format '{{.Names}}'`).

Sin tunel de Cloudflare los silos no tienen certificado ni dominio publico;
para ver su front se usa el servidor de pruebas.

## 9. Tests

```sh
# Plano de control
cd "Vinculos Control" && pnpm test                 # API (jest), agente y ejecutor (node:test)
# ERP
cd "SW Proyecto/backend" && npm run test:bd        # BD: cluster Postgres 18 temporal (initdb en el PATH)
npm run test:e2e                                   # API: Jest + Supertest contra BD efimera
npm test                                           # unitarios
cd ../frontend && npx vitest run && npx tsc --noEmit
```

## 10. Problemas comunes

- **La consola no acepta la contrasena.** La cuenta existe en la BD `control`
  (volumen de Docker) y la contrasena se muestra una sola vez. Si se roto o se
  olvido: `docker exec vinculos-control-api-1 node dist/cli/crear-operador.js <correo> "<nombre>"`
  (mismo correo: rota la contrasena, quita el bloqueo y cierra sus sesiones).
  5 intentos fallidos bloquean la cuenta 15 minutos. En un PC nuevo la BD
  `control` parte vacia: crear el operador de nuevo.
- **`http://127.0.0.1:3200` abre /solicitud.** Es provisorio: el landing por
  bloques es la fase 6 del roadmap y aun no existe; hasta entonces la raiz del
  sitio redirige al formulario. `/solicitud` se mantiene como enlace directo
  para compartir.
- **El agente dice "no resuelve: el agente no esta en erp-<slug>_borde".**
  Con silos completos falta `conectar_borde` (seccion 8). En desarrollo, falta
  `SILO_INTERNO_URL`.
- **R2 da 401.** El hash del token no esta en el silo (`identidad_silo.js` con
  `INTERNO_TOKEN_SHA256`) o el archivo `<slug>.token` no coincide.
- **R2 da 400 sin cuerpo (o el agente dice "fetch failed").** El archivo del
  token tiene un `\r` al final (openssl de Git for Windows): `wc -c` da 65 en
  vez de 64. Regenerarlo con `tr -d '\r\n'` y volver a registrar el hash.
- **"fetch failed" en el primer ciclo del agente.** La API del ERP aun no
  arranca (`npm run dev` tarda); se resuelve solo en el ciclo siguiente.
- **`infra/host-b/.env` sin `EJECUTOR_TOKEN`.** `docker compose up` falla. Si el
  ejecutor ya corre, el valor esta en su entorno: `docker inspect vinculos-agente-ejecutor-1`.
- **`migrate` termina con "La BD pertenece al silo X".** El `.env` o el volumen
  son de otro silo (por ejemplo, un respaldo cruzado). No forzar.
- **El 5432 esta ocupado.** Detener el servicio de Postgres de Windows.

## 11. Antes de publicar un repo (push, export, zip)

```sh
git status --ignored --short | grep -E "\.env|secrets|internos|silos/|respaldos|\.token|\.key|\.pem|kek"   # deben salir como !! (ignorados)
git ls-files | grep -iE "(^|/)\.env($|\.)|secret|\.token$|\.key$|\.pem$|kek|\.dump$" | grep -v "\.env\.example$"   # debe salir vacio
```

Un zip o una copia de carpeta NO respeta `.gitignore`: para entregar el codigo,
usar `git archive` o un clone limpio, nunca la carpeta de trabajo (lleva `.env`,
llaves y tokens).
