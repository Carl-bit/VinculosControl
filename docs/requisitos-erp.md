# Requisitos del ERP para el plano de control

Especificacion de lo que el ERP (`C:\Users\cagaj\Desktop\SW Proyecto`) tiene que
exponer para que el plano de control avance. Regla de `CLAUDE.md`: lo que falta
en el ERP se anota aqui y no se simula en el plano de control. Cada requisito se
implementa en el repo del ERP, con sus propias reglas, despues de confirmarlo.

Resumen del estado en `docs/roadmap.md` (tabla "Requisitos del ERP que bloquean").

Ultima actualizacion: 2026-11-13.

## R10. Demo: resembrar (B) y reconstruir por escenario (A)

Decidido 2026-11-13: **B como rutina y A como "reconstruir demo"**. Ninguna
de las dos borra filas en una BD viva: el ERP prohibe el hard delete de datos
clinicos ("Fichas clinicas: NUNCA hard delete") y lo hace cumplir con 51
triggers `BEFORE DELETE` (`bloquear_delete_clinico`); un `TRUNCATE` se los
saltaria, por eso queda descartado. Tampoco se agrega una excepcion a esos
triggers (ni flag de sesion ni `es_demo` dentro del trigger): el mismo codigo
corre en los silos reales.

Las dos conservan las llaves: KEK y `recuperacion.pub` del disco no se tocan y
las filas de `llaves_datos` (DEK envueltas por la KEK, nunca material en
claro) siguen siendo las mismas. Nunca se pasa por ESPERANDO_LLAVES.

### Marca de demo (comun a A y B)

- Columna `identidad_silo.es_demo boolean NOT NULL DEFAULT false` (migracion
  aditiva sobre la tabla de R11). Sin GRANT a `app_user`; la fija solo el
  dueno al crear un silo de prueba (`servidor.sh`, o el job `aprovisionar`
  con un manifiesto marcado demo). Un silo real nunca la tiene en `true`.
- Segunda marca, fuera de la BD: el slug en `EJECUTOR_DEMOS` del `.env` del
  host B (no se configura desde la consola).
- Siempre: ambas marcas, sin exportacion del centro en curso, fuera de la
  ventana de respaldo (02:00), no mas de una corrida por hora.

### B. Resembrar (rutina, sin excepcion en el ejecutor)

Objetivo: que el demo siga vigente (las horas del seed dependen de la fecha y
los pacientes con horas impagas pasan a morosos con los dias) sin borrar nada.

- Comando `npm run demo:resembrar` (`prisma/demo-resembrar.ts`) en el
  servicio `seed` (`docker-compose.servidor.yml`, como hoy), nunca en el
  backend en ejecucion.
- Avanza el tiempo como lo haria un centro real, solo con las funciones y
  estados del ERP (sin DELETE): cierra o cancela lo que quedo pendiente en el
  pasado, regulariza los pagos de demo, vuelve a abrir bloques y agrega horas
  en las proximas semanas. Lo que crearon los visitantes queda como historia
  (en un centro real tampoco se borra).
- Conserva cuentas y contrasenas (las del escenario vigente).
- Imprime solo conteos (usuarios, profesionales, citas futuras), nunca la
  contrasena ni codigos. Salida 0 solo si los conteos son los esperados.
- Costo: la BD del demo crece de a poco. Cuando pese o se ensucie, A.

### A. Reconstruir demo con un escenario (presentaciones)

Objetivo: preparar el demo para un publico concreto (por ejemplo, un centro
infanto-juvenil o uno de adultos con match) con sus propias cuentas, para que
cada persona vea el demo con el rol que le corresponde.

1. **Escenarios de semilla** en el ERP: `backend/prisma/demo/escenarios/<nombre>.json`,
   validados al cargar. Solo datos ficticios: nombre del centro, modulos que
   se muestran, profesionales (especialidad, modalidad, tarifa), pacientes
   ficticios (RUT con DV generado, nunca personas reales), carga de agenda y
   **cuentas de la presentacion** (rol y parte local del correo:
   `direccion@`, `profesional.infantil@`, `paciente.demo@`, etc.). El seed de
   hoy queda como escenario `centro-prueba` (por defecto).
2. **Credenciales**: la contrasena de las cuentas del escenario la fija el
   operador en el host B (`SEED_PASSWORD` del `.env` del demo). Nunca pasa
   por el plano de control ni se imprime en logs; la consola solo muestra los
   correos y roles del escenario para entregarlos al publico.
3. **Reconstruir** (`infra/scripts/demo/reconstruir.sh <slug> <escenario>` en
   el ERP, como dueno):
   1. verifica las dos marcas de demo;
   2. exporta las filas de `llaves_datos`, `custodios_llave`,
      `eventos_llaves` (envueltas, nunca en claro) e `identidad_silo`;
   3. recrea solo el volumen `db_data` del demo, migra y restaura esas filas;
   4. corre `seed.ts` y el seed del escenario; comprueba canarios y conteos.
   La KEK y `recuperacion.pub` del disco no se tocan.

### En el plano de control (despues de R10)

- Ejecutor: verbo `resembrar_demo(slug)` (B), que corre exactamente
  `docker compose --profile seed run --rm --no-deps seed npm run demo:resembrar`
  sobre `erp-<slug>`; y verbo `reconstruir_demo(slug, escenario)` (A), que
  corre exactamente `reconstruir.sh`. Unica excepcion acotada a "sin verbo de
  borrado" (opcion C): solo slugs en `EJECUTOR_DEMOS`, solo el volumen de BD,
  nombre de escenario validado contra la lista del repo del ERP.
- Jobs `RESEMBRAR_DEMO` y `RECONSTRUIR_DEMO`: P0 (doble marca, sin job activo,
  fuera de la ventana de respaldo, uno por hora) -> estado -> verbo ->
  `/api/salud` 200 y conteos.
- Consola: B con confirmacion simple; A pide el escenario y confirmacion
  escribiendo el slug, avisa que se cortan las sesiones abiertas y muestra
  correos y roles del escenario.
- Auditoria doble: plano de control y log local del ejecutor.

## R2 y R3. Solicitudes de modulos desde el silo (tarea 31)

**Hecho 2026-11-13** (ERP: migraciones `20261113002200_identidad_silo` y
`20261113002300_solicitudes_modulo`, `core/interno`, `solicitudes-modulo.*`,
Configuracion > Modulos; plano de control: agente, API y consola). Pendiente
solo aplicar con R4.

Decidido 2026-11-12: la solicitud nace en el silo, el agente la recoge (modelo
pull) y el operador la aprueba con un job `reconfigurar`. Confirmado
2026-11-13: R2 y R3 se implementan tal como estan aqui.

Como quedo la base de `/api/internal/*`: el token es por silo; el silo guarda
solo su SHA-256 en `identidad_silo.interno_token_sha256` (lo fija
`identidad_silo.js` en `migrate` desde `INTERNO_TOKEN_SHA256` del `.env`; se
rota cambiando el `.env`). La API lo valida con `interno_token_valido()` y cada
funcion interna lo vuelve a validar y exige que no haya contexto de usuario.
El agente lee el token de `TOKENS_INTERNOS_DIR/<slug>.token`.

Antes de R2 y R3 va la base comun de `/api/internal/*` (tambien la usan R4 y
R5): modulo `interno` en el backend, guard por token del silo (el silo guarda
solo el hash; el agente lo genera, como JWT y contrasenas de BD), sin contexto
de usuario, funciones SECURITY DEFINER. El bloqueo en Traefik ya esta (R11).

### En el ERP

1. **Tabla `solicitudes_modulo`** (migracion aditiva): `id uuid`, `modulo
   modulo_centro`, `accion` (`ACTIVAR` | `DESACTIVAR`), `motivo text` (corto,
   opcional), `pedida_por_rol` (`ADMIN`), `pedida_en timestamptz`, `estado`
   (`PENDIENTE`, `APROBADA`, `RECHAZADA`, `APLICADA`), `respuesta text`,
   `respondida_en`. Sin nombre ni id del usuario que la pide en lo que sale del
   silo: solo el rol.
2. **Pantalla del ADMIN** (Configuracion > Modulos): boton "Solicitar" en cada
   modulo apagado (y "Solicitar desactivar" en los encendidos), con las
   dependencias a la vista (no se puede pedir MATCH sin EQUIPO). Muestra el
   estado de cada solicitud.
3. **R2: `GET /api/internal/solicitudes?desde=<fecha>`**: lista las solicitudes
   (sin datos personales). Token interno por silo; solo en la red Docker del
   host B; funcion SECURITY DEFINER de solo lectura.
4. **R3: `POST /api/internal/solicitudes/:id/respuesta`** (ruta definitiva; el roadmap la abreviaba) con `{ estado,
   respuesta }`: el plano de control (via el agente) devuelve APROBADA,
   RECHAZADA o APLICADA para que el ADMIN la vea.

### En el plano de control (despues de R2 y R3)

- El agente lee R2 de cada silo en su reporte y las manda al host A.
- Modelo `SolicitudModulo` (silo, modulo, accion, rol, fecha, estado) y bandeja
  por silo en la consola: validar dependencias, aprobar o rechazar.
- Aprobar crea una revision del manifiesto y un job `reconfigurar` (R4).
- El agente devuelve la respuesta al silo con R3.

## R11. Identidad del silo y mismo esqueleto (hecho en el ERP, 2026-11-13)

Problema de fondo: la red `proxy` unia el backend y el front de todos los
silos. `backend` resolvia al de cualquier silo (login de `estres` validado en
`demo`) y un front podia llegar a la API de otro centro por IP. El alias
`api-silo` era el parche.

Hecho en el ERP (`infra/docker-compose.yml` y relacionados):
- Imagenes comunes `vinculos-api:${VINCULOS_VERSION}` y
  `vinculos-web:${VINCULOS_VERSION}` (antes `erp-backend:<slug>` por silo).
- Tres redes por silo: `erp-<slug>_interna` (db, migrate, backend; unica con
  salida), `erp-<slug>_silo` (front -> API, alias `api-silo`, internal) y
  `erp-<slug>_borde` (backend + front + Traefik, internal, label
  `cl.vinculos.red=borde`). `proxy` queda solo para el plano del host
  (cloudflared, Traefik). Dos silos nunca comparten red.
- Traefik se une a `erp-<slug>_borde` con `docker network connect` despues del
  `up` y se suelta antes del `down` (`servidor.sh`; en produccion, el
  ejecutor).
- Labels `cl.vinculos.silo`, `cl.vinculos.servicio`, `cl.vinculos.version` en
  cada contenedor. El agente y cAdvisor agrupan por label.
- `application_name=erp-<slug>-backend` (y `-migrate`) en las conexiones.
- Tabla `identidad_silo` (categoria B, sin GRANT, inmutable): `migrate`
  registra el slug la primera vez y falla si la BD es de otro silo (respaldo
  cruzado, `.env` equivocado). Backend y front no arrancan.
- `/api/internal/*` nunca se publica: router de Traefik con prioridad e
  `ipallowlist` 127.0.0.1/32 (403 desde el tunel). El agente entrara por la
  red de borde con el token del silo (base de R2 a R5).

Pendiente en el plano de control:
- Ejecutor: verbos `conectar_borde(slug)` y `soltar_borde(slug)` (Traefik y
  agente), parte de `levantar` / `bajar`. Al recrear Traefik, reconectar todas
  las redes con label `cl.vinculos.red=borde`.
- Agente: agrupar metricas por `cl.vinculos.silo`; job VERIFICAR: comprobar que
  Traefik esta en `erp-<slug>_borde` de cada silo.
- `infra/templates/silo.compose.tpl`: derivarla del compose nuevo del ERP.

## R1 y R9. Imagen unica por digest

Confirmado 2026-11-12: una sola imagen para todos los centros (`vinculos-api`,
`vinculos-web`), identificada por tag inmutable + digest. El aislamiento de cada
centro esta en sus contenedores, red, base, volumenes y secretos.

- R1: CI construye y publica las imagenes en el registro privado del host B;
  el compose del silo usa `image: registro/vinculos-api@sha256:...`, sin `build`.
- R9 (hecho 2026-11-13, con R11): el front lee en runtime el nombre
  (`configuracion_centro.nombre_centro` via `/api/publico/centro`, respaldo
  `CENTRO_NOMBRE`), el tema (`TEMA`) y el dominio (`SITE_URL`). La imagen ya no
  recibe build args del centro. El tema pasara a `configuracion_centro` con R4.
- Falta de R1: CI que publique en el registro del host B y compose con
  `image: <registro>/vinculos-api@sha256:...` sin `build`.
- Habilita en el ejecutor los verbos `preparar` y `levantar`, y el job
  `aprovisionar`.

## R4 y R5. Modulo `/api/internal/*`

- R4 `POST /api/internal/config` y `GET /api/internal/config` (**hecho
  2026-11-13**): cuerpo `{ revision, hash, modulos, reglas }`, respuesta
  `{ resultado: APLICADA | SIN_CAMBIOS, revision, hash }`.
  `aplicar_config_interna()` aplica `modulos_activos` y las reglas de una lista
  cerrada (las columnas de CAMPOS_REGLAS) en un solo UPDATE, con dependencias de
  modulos y los CHECK de siempre; registra revision y hash en `identidad_silo`;
  misma revision y hash = SIN_CAMBIOS; nunca acepta una revision menor o igual
  con otro hash. Tema y marca **no** se aplican aun (el tema sigue en `TEMA`
  del `.env`; marca por zona la edita el ADMIN). Migracion
  `20261113002500_config_interna`, caso 178 y e2e.
- R5 `POST /api/internal/admin-inicial` (**hecho 2026-11-13**): cuerpo
  `{ email, nombre }` (el admin inicial del manifiesto), respuesta
  `{ invitada, vence }` (nunca el enlace). `invitar_admin_inicial()` crea la
  cuenta ADMIN sin contrasena y la invitacion de un uso (72 h, el mismo flujo
  de `/cuenta/activar`); el correo lo manda el silo. 409 si ya hay una cuenta
  madre activada o una pendiente con otro correo; mismo correo reemite.
  Migracion `20261113002400_admin_inicial`, caso 177 y e2e.
- Comun: token por silo, solo en la red Docker del host B, nunca con
  credenciales de dueno en runtime ni con cuentas de usuarios del centro.

## R8. Tema "editorial"

Esta disenado (boceto del landing) pero no implementado en
`frontend/src/app/temas/`. Hasta entonces el manifiesto aprueba solo moderno y
cuaderno.

## R12 y R13. Salida de un centro (S2 y S3)

Hoy la salida se registra a mano en la consola (Salidas, 2026-11-14). Para
automatizar sin datos personales:

- R12 `POST /api/internal/salida` `{ soloLectura: true, fechaCorte }`: el silo
  pasa a solo lectura (sin reservas, pagos ni cambios; lectura y exporte
  siguen). Funcion SECURITY DEFINER, idempotente, auditada en el silo. El
  centro avisa a sus pacientes (S2).
- R13 `GET /api/internal/exportaciones`: lista corta de `registro_exportaciones`
  (id, estado, creada, tamano, huella SHA-256), sin contenido ni clave. El
  agente la reporta: la consola deja de pedir la huella a mano y el job
  `actualizar` se bloquea con un exporte EN_CURSO (`ERP_REGLAS_Y_DESPLIEGUE.md`).
- Comun: token por silo, red de borde, sin contexto de usuario.

## R14. `respaldar.sh` con la db detenida (hallado 2026-11-15)

Hallado en la prueba de salida de punta a punta (silo en GRACIA, contenedores
detenidos). En `infra/scripts/continuidad/respaldar.sh`:

- `docker compose ... exec -T db pg_dump ... | openssl enc ...`: con la db
  detenida, `exec` falla, pero `set -eu` en `sh` solo mira el ultimo comando
  del pipe (`openssl`), que cifra la entrada vacia y sale con 0.
- El archivo queda de 32 bytes (cabecera `Salted__` + bloque de relleno) y pasa
  el chequeo `[ -s "$SALIDA" ]`. Probado: `false | openssl enc -aes-256-cbc
  -pbkdf2 ...` deja 32 bytes y estado 0.
- Consecuencias: cada noche de la gracia (30 dias) queda un respaldo vacio con
  su `.sha256`, se sube al destino externo y `find -mtime +7 -delete` borra los
  respaldos reales del host a los 7 dias. Si la salida se revierte despues, en
  el host solo quedan respaldos vacios. Lo mismo pasa si la db de un silo
  activo esta caida a las 02:00.

Pedido al ERP (cualquiera sirve, mejor ambos):

1. Comprobar `pg_dump` antes de cifrar: volcar a un archivo temporal dentro
   del `umask 077` y cifrarlo solo si `exec` salio con 0 (o `set -o pipefail`
   si el script pasa a bash), y exigir un tamano minimo razonable.
2. No respaldar un silo detenido: si `docker compose ps --status running db`
   no lo trae, salir con un mensaje claro y codigo distinto de cero, sin crear
   archivo ni rotar.
3. Opcional: que `instalar.sh` tenga `pausar`/`reanudar` de las lineas
   `# vinculos:<slug>` para la gracia (hoy la baja las quita a mano).

En el plano de control (hecho 2026-11-15): la regla de alertas abre S2
`respaldo_vacio:<slug>` si el ultimo respaldo pesa menos de 1 KiB, para que
un respaldo vacio de un silo activo no pase por bueno.
