# Tests de integracion de la API

Services reales de Nest con Prisma real contra un Postgres efimero. El correo
se reemplaza por `CorreoFalso` (captura los codigos de 6 digitos). Separados de
los unitarios: `pnpm api test` sigue sin Docker.

## Correr

```
pnpm api test:int            # todos (unos 15 s)
pnpm api test:int -- jobs    # solo un archivo
```

Requiere Docker Desktop arriba. El `globalSetup` levanta `postgres:18-alpine`
desechable (`vc-api-test-<pid>`, etiqueta `vc.test=api`, datos en tmpfs, puerto
libre en 127.0.0.1), aplica todas las migraciones con `prisma migrate deploy` y
el teardown lo borra. No toca la BD `control` (5440) ni la del ERP (5432).

Si una corrida se corta a la fuerza y queda un contenedor:

```
docker ps -a --filter label=vc.test=api
docker rm -f $(docker ps -aq --filter label=vc.test=api)
```

## CI

Con `TEST_DATABASE_URL` no se levanta contenedor: se usa esa base (vacia), por
ejemplo Postgres como servicio del pipeline de Bitbucket.

## Archivos

| Archivo | Cubre |
|---|---|
| `entorno.ts` | Modulo de Nest, `CorreoFalso`, `limpiar` (TRUNCATE por test), semillas |
| `acceso.int-spec.ts` | Login completo, bloqueo, codigo (un uso, vence, 5 intentos), reenvio, sesion |
| `jobs.int-spec.ts` | P0, SKIP LOCKED, reserva y retoma, reportes, idempotencia, cancelar, reintentar |
| `solicitudes.int-spec.ts` | Tarea 31 de punta a punta con RECONFIGURAR (R2/R3/R4) |
| `centros.int-spec.ts` | Solicitud de fase 1, transiciones manuales y auditoria |

La ventana de respaldo (01:45 a 02:30 Chile) se fija con un spy sobre
`enVentanaRespaldo`, para que la hora real no cambie el resultado.

Un test marcado `it.failing` documenta un bug conocido: pasa mientras el bug
exista. Al corregirlo, Jest lo marca en rojo y hay que quitar `.failing`.
