# vinculos-control

Plano de control de Vinculos (diseño en `CONTEXTO.md`, estado del ERP en
`ERP_REGLAS_Y_DESPLIEGUE.md`). Primera entrega: **monitoreo** del host de
silos y de cada silo. Manifiestos, jobs y landing vienen despues.

| Pieza | Donde corre | Que hace |
|---|---|---|
| `apps/api` | Host A | NestJS + Prisma (Postgres `control`). Recibe al agente, sondea `/api/salud` de cada silo adoptado, abre y cierra alertas |
| `apps/web` | Host A | Consola (estilo Terminal). Solo en `127.0.0.1`; desde afuera, Cloudflare Access |
| `apps/landing` | Host A (publico) | Unico sitio publico: landing para vender, solicitud de fase 1 (tambien por el enlace que comparte el operador) y enlace privado de fase 2. App, puerto y red propios; solo llega a `/landing/*` de la API |
| `packages/manifest` | Compartido | Schema del manifiesto, modulos y dependencias (zod) |
| `apps/agente` | Host B | Descubre los stacks `erp-<slug>`, reporta contenedores, host, p95 y respaldos. Solo numeros y booleanos |

Hosts separados siempre (CLAUDE.md). En pruebas: host A = PC de desarrollo,
host B = Ubuntu de los silos. Al pasar los silos a un VPS, el host A se muda
al Ubuntu.

## Que se vigila

| Senal | Fuente | Alerta |
|---|---|---|
| `/api/salud` (estado, bd, canarios, latencia), por Cloudflare como un usuario | API, cada 60 s | S1: 2 fallos seguidos o canarios en falso |
| RAM contra el limite, CPU, reinicios, OOM de `db`, `backend`, `frontend` | Agente, cada 60 s | S1 detenido; S2 RAM > 90 %, reinicio u OOM |
| Disco, RAM y carga del host B | Agente | S2 disco > 80 % |
| p50/p95/max por ruta (ultimos 5 min, desde los logs del backend) | Agente (calcula alla; no viaja ninguna linea de log) | S3 p95 > 300 ms con 20+ peticiones |
| Ultimo respaldo de `respaldar.sh` (nombre, fecha, tamaño, sha256) | Agente | S3 sin respaldo en 26 h |
| Latido del agente | Agente, cada 30 s | S1 sin latido en 2 min |

Reglas en `apps/api/src/alertas/reglas.ts` (funcion pura, con tests). Las
series se guardan 7 dias.

## Host A (este PC)

```sh
cp infra/host-a/.env.example infra/host-a/.env      # CONTROL_DB_PASSWORD y CONSOLA_SECRETO largos
docker compose -f infra/host-a/docker-compose.yml --env-file infra/host-a/.env up -d --build
docker exec vinculos-control-api-1 node dist/cli/crear-agente.js host-b   # token del agente: se muestra una vez
docker exec vinculos-control-api-1 node dist/cli/crear-operador.js tu@correo.cl "Tu nombre"   # contrasena: se muestra una vez
```

- Landing publica (solicitud y enlace de fase 2, app separada de la consola): http://127.0.0.1:3300
- Consola: http://127.0.0.1:3100 (login en dos pasos: contrasena + codigo de 6 digitos por correo)
- Correo local (Mailpit, donde llegan los codigos): http://127.0.0.1:8026. En produccion, SES por SMTP
  (`SMTP_*` y `SES_CONFIGURATION_SET` en `infra/host-a/.env`).
- Acceso: 5 contrasenas erradas bloquean la cuenta 15 min; el codigo vence en 10 min y sirve una vez;
  la sesion expira con 30 min sin actividad o a las 12 h. Todo queda en Auditoria.
- Con el mismo correo, `crear-operador` rota la contrasena, quita el bloqueo y cierra sus sesiones.
- La API queda en el puerto 4000 de la red local para el agente. En Windows,
  abrir ese puerto solo en redes privadas (PowerShell como administrador):
  `New-NetFirewallRule -DisplayName "vinculos-control api" -Direction Inbound -Protocol TCP -LocalPort 4000 -Profile Private -Action Allow`

## Host B (Ubuntu de los silos)

```sh
git clone https://github.com/Carl-bit/VinculosControl.git && cd VinculosControl
cp infra/host-b/.env.example infra/host-b/.env      # CONTROL_URL, AGENTE_TOKEN, RESPALDOS_HOST, EJECUTOR_TOKEN (openssl rand -hex 32)
docker compose -f infra/host-b/docker-compose.yml --env-file infra/host-b/.env up -d --build
docker logs -f vinculos-agente-agente-1             # "reporte: 2 silo(s)" cada minuto
```

El agente lee Docker solo a traves de `docker-socket-proxy` (GET de
`/containers` y `/networks`), corre como usuario `node` y monta los respaldos
en solo lectura. No ejecuta nada que venga del host A: reclama jobs y corre
solo los pasos de su lista cerrada.

Lo que escribe en Docker lo hace el **ejecutor de silos** (`apps/ejecutor`,
opcion C de `docs/propuesta-escritura-docker.md`): es el unico con el socket,
no publica puertos, solo lo alcanza el agente por la red interna `ejecutor` con
`EJECUTOR_TOKEN`, y solo conoce los verbos `estado`, `reiniciar` (backend y
frontend de `erp-<slug>`; nunca db, nunca borra), `conectar_borde`,
`soltar_borde` y `reconectar_bordes` (une a Traefik y al agente a la red
`erp-<slug>_borde` de cada silo; R11). Cada verbo queda en su
auditoria local:
`docker exec vinculos-agente-ejecutor-1 cat /var/log/ejecutor/verbos.jsonl`.

En la consola, los silos aparecen como "sin adoptar": **Adoptar** empieza el
sondeo de `/api/salud` y las alertas.

## Desarrollo

```sh
pnpm install
docker compose -f infra/host-a/docker-compose.yml --env-file infra/host-a/.env up -d db mailpit
pnpm api dev          # apps/api/.env (ver .env.example; SMTP_HOST=127.0.0.1, SMTP_PUERTO=1026)
pnpm api operador:crear tu@correo.cl "Tu nombre"
pnpm web dev          # consola en :3100. apps/web/.env.local: API_URL y el mismo CONSOLA_SECRETO
pnpm manifest build   # paquete compartido (lo usan la API y la landing); repetir si cambia
pnpm landing dev      # landing en :3300. apps/landing/.env.local: API_URL y el mismo LANDING_SECRETO
pnpm test             # reglas de alerta (jest) y agente (node:test)
```

Avance y pendientes en `docs/roadmap.md`; registro detallado (para la memoria) en `docs/registro-implementacion.md`.

**Otro computador o despues de un pull:** `docs/entorno-local.md` levanta todo
(ERP + plano de control) desde cero, lista lo que no viaja con git y como
probar la tarea 31 en local.
