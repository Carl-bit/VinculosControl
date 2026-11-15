# Registro de implementacion de vinculos-control

Registro tecnico de lo construido, con fechas, decisiones y evidencia de
pruebas. Pensado para integrarlo a la memoria del proyecto. El estado vivo
(que falta, que esta bloqueado) esta en `docs/roadmap.md`; el diseno completo,
en `CONTEXTO.md`; el estado del ERP, en `ERP_REGLAS_Y_DESPLIEGUE.md`.

Ultima actualizacion: 2026-11-14.

## 1. Que es y como se separa

Plano de control del ERP Vinculos: recibe solicitudes de centros, arma y
aprueba su manifiesto, y (con el agente del host de silos) verifica y, mas
adelante, aprovisiona cada silo `erp-<slug>`. Nunca guarda ni transporta datos
de pacientes: solo metadatos.

| Pieza | Puerto (pruebas) | Expuesta a | Rol |
|---|---|---|---|
| `apps/api` (NestJS + Prisma, Postgres `control`) | 4000 | red local (el agente la llama) | Toda la logica y la BD del plano de control |
| `apps/web` (Next.js) | 127.0.0.1:3100 | solo el operador (Cloudflare Access en produccion) | Consola del proveedor |
| `apps/sitio` (Next.js) | 127.0.0.1:3200 | publico (cuando se publique) | Formulario de solicitud (fase 1) y enlace privado de fase 2; luego el landing |
| `apps/agente` (Node) | sin puertos | host B | Monitoreo y ejecucion de jobs (modelo pull) |
| `apps/ejecutor` (Node) | 7070 solo en la red interna `ejecutor` | solo el agente | Unico con el socket de Docker; verbos cerrados (opcion C) |
| `packages/manifest` (`@vinculos/manifest`, zod) | - | compartido | Schema del manifiesto, modulos, reglas, P0 y hash |
| Mailpit | 127.0.0.1:8026 (UI), 1026 (SMTP) | local | Correos de la consola en pruebas (SES en produccion) |

Separacion de accesos a la API (cada canal con su propio secreto o token):
- Consola: `x-consola-secreto` (web <-> API) + sesion del operador (`x-consola-sesion`, desde una cookie httpOnly).
- Sitio publico: `x-sitio-secreto` (sitio <-> API), solo rutas `/publico/*`.
- Agente: `Authorization: Bearer <token>` (sha256 en la BD), solo rutas `/agente/*`.

## 2. Cronologia y decisiones

| Fecha | Hito | Decision o motivo |
|---|---|---|
| 2026-11-08 | Fase 0: monitoreo (agente, salud, alertas, consola basica) | Primera entrega |
| 2026-11-12 | Roadmap (`docs/roadmap.md`) | Memoria de avance; los bocetos de `system-reference/` son referencia visual y ceden ante lo construido |
| 2026-11-12 | Fase 1: login en dos pasos y auditoria | Cloudflare Access + login propio (se descarta la red privada del boceto) |
| 2026-11-12 | Fase 2a: formulario publico y Solicitudes | Anti-spam: limite por IP + campo trampa. Sitio en app separada (`apps/sitio`). MVP sin COBROS ni WHATSAPP |
| 2026-11-12 | Fase 2b: enlace de fase 2, editor del manifiesto, P0 y APROBADO | Slug lo fija el operador; APROBADO exige version y fecha del contrato firmado |
| 2026-11-12 | Consola alineada al boceto | Navegacion agrupada, Solicitudes maestro-detalle, Manifiesto en dos columnas con YAML y P0 en vivo |
| 2026-11-12 | Fase 4 (base): cola de jobs y job VERIFICAR | Solo lectura en Docker; la escritura queda para decidir (`docs/propuesta-escritura-docker.md`) |
| 2026-11-12 | Estilos | Fase 1: moderno, cuaderno, editorial, "tenemos nuestros colores", "aun no lo se". Manifiesto: solo temas implementados en el ERP (moderno, cuaderno); editorial esta disenado y falta implementarlo en el ERP |
| 2026-11-12 | Compartir el formulario | Boton "Compartir solicitud" en la barra lateral (precarga modulos, origen "enlace") |
| 2026-11-12 | Opcion C aprobada y primera etapa del ejecutor (estado, reiniciar) | Escritura en Docker solo por verbos cerrados; sin borrado. Se mantiene R1 (imagen unica). La salida conserva datos solo durante la gracia |
| 2026-11-13 | Fase 5 (parte): Configuracion, incidentes y soporte, detalle del silo y Resumen | Sin depender del ERP |
| 2026-11-12 | Fix en el ERP: 502 en los silos | `HOSTNAME=0.0.0.0` en el Dockerfile del frontend del ERP (Next standalone escuchaba en una sola red) |

## 3. Modelo de datos (Postgres `control`)

Migraciones (todas aditivas), en `apps/api/prisma/migrations/`:

| Migracion | Tablas |
|---|---|
| `20261108022454_monitoreo_inicial` | `silos`, `agentes`, `muestras_salud`, `metricas_contenedor`, `metricas_host`, `latencias_ruta`, `respaldos`, `alertas` |
| `20261112183453_acceso_y_auditoria` | `operadores`, `codigos_acceso`, `sesiones`, `eventos_auditoria` |
| `20261112200123_centros_y_manifiestos` | `centros` (14 estados), `transiciones_centro`, `revisiones_manifiesto` |
| `20261112210711_fase2_enlace_y_aprobacion` | `enlaces_fase2`; en `centros`: `revision_aprobada`, `hash_aprobado`, `aprobado_en` |
| `20261112215609_cola_de_jobs` | `jobs`, `pasos_job` |
| `20261113013203_job_reiniciar_silo` | valor `REINICIAR_SILO` en `tipo_job` |
| `20261113035502_incidentes_y_soporte` | `incidentes`, `eventos_incidente`, `solicitudes_soporte` |

Que se guarda y que no:
- Contrasenas de operador: scrypt con sal propia. Codigos de acceso: HMAC. Sesiones, tokens del agente y del enlace de fase 2: sha256. Ningun secreto en claro.
- Del centro: solo el contacto comercial y lo que el manifiesto pide (razon social, RUT, admin inicial, responsable de datos, custodio por nombre y rol). Nunca pacientes ni equipo.
- Revisiones del manifiesto: inmutables, con sha256 del JSON canonico. Fase 1 (formulario), fase 2 (borradores), fase 3 (aprobada).
- Logs de jobs: lineas cortas sin secretos (maximo 30 de 300 caracteres por paso).

## 4. Endpoints de la API

| Canal | Rutas |
|---|---|
| Consola, acceso | `POST /consola/acceso/credenciales`, `/codigo`, `/reenviar`, `/salir`; `GET /consola/acceso/yo` |
| Consola, monitoreo | `GET /consola/resumen`, `/consola/silos/:slug`, `/consola/alertas`; `POST /consola/silos/:slug/adoptar`, `/soltar` |
| Consola, centros | `GET /consola/centros`, `/consola/centros/:id`; `POST .../:id/transicion`, `.../:id/slug`, `.../:id/enlace`, `.../:id/enlace/revocar`, `.../:id/aprobar`; `PUT .../:id/manifiesto` |
| Consola, jobs | `GET /consola/jobs`, `/consola/jobs/:id`; `POST /consola/jobs`, `.../:id/reintentar`, `.../:id/cancelar` |
| Consola, auditoria | `GET /consola/auditoria?tipo=auth\|operador\|silo\|centro\|job\|incidente\|soporte` |
| Consola, incidentes y soporte | `GET /consola/incidentes`, `/consola/incidentes/:id`, `/consola/soporte`; `POST /consola/incidentes`, `.../:id/eventos`, `/consola/soporte`, `.../:id/cerrar` |
| Consola, configuracion | `GET /consola/config`; `POST /consola/config/sesiones/:id/revocar`, `/consola/config/clave`, `/consola/config/correo-prueba` |
| Publico (via `apps/sitio`) | `POST /publico/solicitudes`; `GET\|PUT /publico/manifiesto/:token`; `POST /publico/manifiesto/:token/enviar` |
| Agente | `POST /agente/latido`, `/agente/reporte`, `/agente/jobs/reclamar`, `/agente/jobs/:id/pasos/:codigo` |

## 5. Flujos implementados

### 5.1 Acceso a la consola (fase 1)
1. Correo + contrasena. 5 fallos seguidos bloquean la cuenta 15 min. Mismo mensaje y mismo tiempo de respuesta si el correo no existe.
2. Codigo de 6 digitos por correo: vence en 10 min, un uso, 5 intentos, reenvio cada 45 s (max 3).
3. Sesion: cookie httpOnly SameSite=Strict; expira con 30 min sin actividad o a las 12 h. Salir la revoca.
4. Cuentas: `operador:crear <correo> "<nombre>"` (contrasena al azar, se muestra una vez; con un correo existente rota la contrasena y cierra sus sesiones).

### 5.2 Solicitud (fase 1)
1. El centro llena `/solicitud` en `apps/sitio` (o el enlace que comparte el operador, con `?via=enlace&modulos=...`).
2. Pide: nombre, comuna, tamano del equipo, contacto, modulos de interes (MVP: Fichas, Agenda, Equipo, Match, Pagina publica; las dependencias se agregan solas), sitio web, preferencia de estilo y comentarios.
3. La API valida con el mismo schema (`fase1Schema`), limite de 5 por IP por hora y campo trampa (un bot recibe la misma respuesta, sin guardar nada).
4. Queda un centro en SOLICITUD con su revision 1.

### 5.3 Pipeline comercial y fase 2
1. En Solicitudes (maestro-detalle): Marcar como contactado -> Agendar reunion -> Abrir manifiesto. Descartar exige motivo.
2. En el Manifiesto: el operador fija el slug (sugerido desde el nombre, unico frente a centros y silos) y envia el enlace de fase 2 (token, 7 dias, uno vivo por centro, revocable).
3. El centro completa sus datos en `/manifiesto/<token>` (entidad, RUT, responsables, dominio, modulos, color). Puede guardar a medias. Al enviar completo, el estado pasa a DATOS_COMPLETOS.
4. El operador completa version, reglas (formulario generado desde los defaults del ERP), tema y contrato. Cada guardado es una revision con hash (idempotente si nada cambio).
5. P0 en vivo (`validarP0`): schema v1, dependencias, rangos de `configuracion_centro` del ERP, modulos del MVP, tema existente en el ERP y contrato firmado.
6. Aprobar: congela el manifiesto en una revision fase 3, guarda su hash, revoca el enlace y deja el slug fijo.

### 5.4 Jobs (fase 4, base)
1. Desde un manifiesto aprobado: "Verificar en el host B" crea un job VERIFICAR.
2. P0 corre en el plano de control al crear el job; si falla, el job no parte.
3. El agente reclama (`FOR UPDATE SKIP LOCKED`, reserva de 2 min renovada en cada reporte), ejecuta solo los pasos de su lista cerrada y reporta cada uno:
   V1 integridad (hash), V2 red de Traefik, V3 nombre del stack libre, V4 imagen (omitido: requisito R1), V5 capacidad del host (disco < 80 %, 1 GiB libre).
4. Reintentar repite solo el paso fallido; cancelar detiene al agente (409).
5. `aprovisionar` y `reconfigurar` aparecen bloqueados con su motivo; `reiniciar_demo` bloqueado por R10: resembrar datos ficticios conservando llaves (enfoque B, decidido 2026-11-13; `docs/requisitos-erp.md`).

### 5.6 Incidentes y soporte (CONTEXTO.md 8b)
1. Un incidente se abre desde una alerta del monitoreo (misma severidad; el plazo corre desde la alerta), desde el detalle de un silo o a mano.
2. Plazos: S1 contencion 1 h, aviso 24 h, actualizaciones cada 24 h, informe 10 dias habiles; S2 4 h, 48 h, 48 h, 10; S3 contencion 2 dias habiles, aviso en el informe mensual, informe 20 dias habiles. Semaforo: al dia, por vencer (ultimo 25 %), vencido.
3. Hitos en orden: la contencion antes del informe final, las actualizaciones despues del aviso, el cierre exige el informe final; cada hito se fija una vez. Todo queda en la bitacora y en auditoria.
4. Soporte: se registra con la autorizacion que el ADMIN dio en su silo (alcance DIAGNOSTICO o CONFIGURACION, 1 a 72 h); no se acepta una autorizacion vencida; el cierre guarda un resultado sin datos del centro.

### 5.7 Configuracion
Plazos, seguridad y correo (con envio de prueba); sesiones abiertas de los operadores (revocar); cambio de la propia contrasena (verifica la actual, 12+ caracteres, cierra las demas sesiones).

### 5.5 Reiniciar un silo (ejecutor, opcion C)
1. En Silos, "Reiniciar" crea un job REINICIAR_SILO (confirma que la base no se toca).
2. P0 en el plano de control: el agente reporta el silo hace menos de 10 min, no hay otro job activo y no es la ventana de respaldo (01:45 a 02:30 Chile).
3. El agente pide al ejecutor: E1 `estado`, E2 `reiniciar` (backend y luego frontend; nunca db), E3 `estado` hasta que ambos esten en marcha (60 s).
4. El ejecutor valida el slug, filtra por el proyecto `erp-<slug>`, hace una operacion a la vez y deja cada verbo en su auditoria local (JSON por linea).

## 6. Seguridad aplicada

- Escritura en Docker solo en el ejecutor: sin puertos publicados, red `internal` compartida solo con el agente, token propio, filesystem de solo lectura, `no-new-privileges`, verbos fijos sin parametros libres, sin borrado ni llaves.
- Reglas duras de `CLAUDE.md` cumplidas: sin datos de pacientes; todo cambio nace de una revision aprobada con hash; modelo pull (el host A nunca llama al host B); el agente usa Docker solo via `docker-socket-proxy` en modo lectura y ejecuta una lista cerrada; no toca llaves.
- POST de la web y del sitio solo desde el mismo origen; cuerpos limitados; IP del visitante para limites y auditoria.
- Enlace de fase 2 con `Referrer-Policy: no-referrer` y `noindex`; 120 peticiones por IP por hora sobre tokens.
- Auditoria (`eventos_auditoria`) de accesos, bloqueos, operadores, transiciones de centros, revisiones, enlaces, aprobaciones y jobs.

## 7. Pruebas

| Suite | Cantidad | Que cubre |
|---|---|---|
| `apps/api` (Jest) | 55 | Reglas de alerta, reglas de acceso (bloqueo, codigo, sesion, contrasenas), maquina de estados del centro, limite por IP, reglas de la cola de jobs |
| `packages/manifest` (node:test) | 25 | Modulos y dependencias, reglas (CHECK del ERP), fase 1, manifiesto, RUT, hash canonico, fase 2, P0, temas |
| `apps/agente` (node:test) | 10 | p95, stats de Docker, hash compartido, lista cerrada, detencion por 409, no repetir pasos OK |
| `apps/ejecutor` (node:test) | 5 | Slug estricto, orden backend -> frontend, nunca db, solo el proyecto pedido, ventana de respaldo |

Pruebas de punta a punta hechas a mano contra el stack Docker (2026-11-12):
login completo (incluye bloqueo y codigo reusado); formulario publico
(valida, trampa, campo extra, origen, limite); pipeline y descarte; fase 2
completa hasta APROBADO (enlace por Mailpit, guardado parcial, faltantes,
contrato, enlace invalido despues de aprobar); job VERIFICAR con el agente
real (fallo en V5 por disco al 84 %, reintento solo del paso fallido,
cancelacion); REINICIAR_SILO con el agente y el ejecutor reales sobre un stack
de prueba (backend y frontend reiniciados, db intacta; slug invalido, silo
inexistente y token falso rechazados; verbo registrado en la auditoria local);
fase 5 (incidente S1 con todos sus hitos y reglas de orden, fecha futura,
soporte con autorizacion vencida y valida, revocar una sesion, cambio de
contrasena con clave errada / corta / correcta y login con la nueva, correo de
prueba en Mailpit, conteos del Resumen).

Pendiente: tests de integracion contra un Postgres efimero (`CLAUDE.md`), a
montar junto con los jobs que escriben.

## 8. Como se levanta (pruebas)

```sh
# Host A (este PC)
docker compose -f infra/host-a/docker-compose.yml --env-file infra/host-a/.env up -d --build
docker exec vinculos-control-api-1 node dist/cli/crear-operador.js tu@correo.cl "Tu nombre"
docker exec vinculos-control-api-1 node dist/cli/crear-agente.js host-b
# Host B (agente)
docker compose -f infra/host-b/docker-compose.yml --env-file infra/host-b/.env up -d --build
```
Consola http://127.0.0.1:3100, sitio http://127.0.0.1:3200, correo http://127.0.0.1:8026.
Desarrollo con recarga: ver `README.md` (seccion Desarrollo).

## 9. Requisitos del ERP que bloquean lo siguiente

Ver `docs/roadmap.md`, seccion "Requisitos del ERP que bloquean": R1 imagenes
unicas por digest, R2/R3 solicitudes de modulos (tarea 31), R4
`/api/internal/config`, R5 admin inicial, R6 notas de version, R7 agregados
para la consola. Y la decision sobre escritura en Docker:
`docs/propuesta-escritura-docker.md`.

## 10. Diferencias encontradas con el ERP

- Default de `modulos_activos`: en el ERP (MVP) COBROS tambien viene apagado.
- Temas: el ERP tiene "Moderno A" y "Cuaderno" (los docs decian solo Moderno); "editorial" esta disenado (boceto del landing) pero no implementado.
- 502 en los silos tras agregar la red `silo`: arreglado en el Dockerfile del frontend del ERP (`HOSTNAME=0.0.0.0`).

## 11. 2026-11-13: mismo esqueleto (R11), ejecutor de bordes y tarea 31 de punta a punta

Decisiones del usuario: R10 = B (resembrar sin borrar) + A (reconstruir demo
con escenarios por publico, conservando llaves); R2/R3 tal como estaban
especificados; el silo creado desde la consola debe nacer con el esqueleto e
identidad de R11.

ERP (`SW Proyecto`):
- R11: imagenes comunes `vinculos-api`/`vinculos-web`, redes `erp-<slug>_interna`,
  `_silo`, `_borde` (la red `proxy` deja de unir silos), labels `cl.vinculos.*`,
  `application_name`, tabla `identidad_silo` (migrate falla si la BD es de otro
  silo), `/api/internal` bloqueado en Traefik. R9: nombre, tema y dominio en
  runtime en el front.
- Base de `/api/internal` (token por silo, hash en BD) + R2/R3 + pantalla del
  ADMIN. Tests: `correr_tests_bd.sh` (caso 176), e2e `solicitudes-modulo`,
  vitest.
- `servidor.sh`: une Traefik y Mailpit a cada red de borde y genera el token
  interno de cada silo.

Plano de control:
- Ejecutor: verbos `conectar_borde`, `soltar_borde`, `reconectar_bordes` (11 tests).
- Agente 0.3.0: silos por label; sincronizacion R2 -> API -> R3 cada 60 s.
- API: `SolicitudModulo` + `/agente/solicitudes` + `/consola/solicitudes-modulo`.
- Consola: bandeja de solicitudes en el detalle del silo.
- `docs/entorno-local.md` y revision de `.gitignore`/`.dockerignore` en ambos repos.

### Prueba local de punta a punta (2026-11-13)

Siguiendo `docs/entorno-local.md` en este PC (host A y host B locales, ERP en
desarrollo). Resultado: OK. Pasos verificados: token interno (401 sin token o
con otro, 200 con el del silo; rotacion), reglas del ADMIN (422 COBROS fuera
del MVP, 422 dependencia de Equipo, 409 segunda solicitud abierta), R2 -> API
(sin motivo ni autor), decision del operador por el proxy de la consola,
transicion invalida 409, R3 -> el ADMIN ve estado y texto, APLICADA sin cambio
rechazada con su motivo visible en la consola, APLICADA tras el cambio,
ejecutor contra una red de borde real (unir idempotente, red sin labels 409,
slug invalido 400, verbo desconocido 404, soltar, auditoria local), front del
ERP con tema y nombre en runtime.

Fallos encontrados y corregidos en la corrida:
1. Token con `\r` (openssl de Git for Windows): hash distinto y 400 en el
   header. Guia y `servidor.sh` usan `tr -d '\r\n'`.
2. El agente reenviaba `respondidaEn` de R2 y la API lo rechazaba (DTO sin
   campos extra). Ahora manda una lista explicita de campos; test cubierto.
3. El agente mostraba "HTTP 422" sin motivo: el ERP responde `mensaje`, no
   `message`. Corregido; test cubierto.
4. Las reglas nuevas del ERP respondian el 422/409 generico. Mensajes propios
   en `core/errores/sqlstate.ts` y `conflicto()` para la solicitud abierta;
   e2e los verifica.

Script para repetir sin navegador: `scripts/prueba-local/tarea31.mjs`.

### R5 admin inicial (2026-11-13)

ERP: `invitar_admin_inicial()` (token del silo, sin contexto) + `POST
/api/internal/admin-inicial`. Crea la cuenta ADMIN sin contrasena y la
invitacion de un uso de 72 h (mismo flujo que la invitacion de equipo); el
correo sale del silo y al plano de control solo vuelve `{ invitada, vence }`.
Tests: caso 177 (camino feliz en una subtransaccion que se deshace, porque el
fixture ya trae cuentas madre), e2e (401, 400, 409 con mensaje propio),
prueba en vivo contra el ERP de desarrollo (409 "ya tiene una cuenta madre").
Hallazgo: `emitir_token` anula la invitacion anterior dejandola vencer en
`max(creada + 1 s, now())`; dentro de una misma transaccion conviven 1 s.
Sin efecto practico; documentado en el caso 177.

### R4 config interna + job RECONFIGURAR (2026-11-13)

ERP: `aplicar_config_interna()` / `config_interna()` + `POST/GET
/api/internal/config` (modulos y reglas de una lista cerrada, un solo UPDATE,
dependencias, SIN_CAMBIOS idempotente, nunca hacia atras). Caso 178 y e2e.
Plano de control: job RECONFIGURAR (P0 manifiesto + silo, C1 aplicar, C2
confirmar); aprobar una solicitud crea la revision nueva del manifiesto y
encola el job; al terminar OK la solicitud pasa a APLICADA.

Prueba local de punta a punta (centro de prueba aprobado para `centro-prueba`):
desactivar MATCH (rev 2, job #4) y volver a activarlo (rev 3, job #5), ambos
OK sin tocar la BD a mano.

Fallos encontrados y corregidos:
1. Reglas aplicadas columna por columna violaban un CHECK entre columnas
   (recordatorio antes del plazo de cancelacion) en un estado intermedio.
   Ahora un solo UPDATE con todas las reglas.
2. El job cerraba la solicitud en APLICADA antes de que el silo recibiera
   APROBADA, y el silo no acepta PENDIENTE -> APLICADA (quedaba trabada). Ahora
   la entrega va de a un paso (`siguienteEntrega`, con test).

### Tests de integracion de la API (2026-11-14)

`pnpm api test:int`: services reales de Nest con Prisma real contra un
Postgres efimero (`postgres:18-alpine` en tmpfs, puerto libre, borrado al
terminar; `TEST_DATABASE_URL` para CI). Aplica todas las migraciones desde
cero en cada corrida. 51 tests en 4 archivos (acceso, cola de jobs, solicitudes
de modulo con RECONFIGURAR, centros), unos 15 s, estables en 3 corridas. El
correo se reemplaza por `CorreoFalso`; la ventana de respaldo, con un spy.
Detalle y como correrlos: `apps/api/test/integracion/README.md`.

Hallazgo: dos reportes finales simultaneos del mismo paso cierran el job dos
veces (`job.ok` auditado dos veces; en RECONFIGURAR, `cerrarSolicitudes` dos
veces). `reportarPaso` lee, decide y escribe sin condicionar la escritura al
estado. Hoy no ocurre (el agente reporta en serie), pero con `aprovisionar` el
cierre movera el centro de estado. Corregido el mismo dia: el
cierre es un `updateMany` condicionado a `estado = EN_CURSO` y solo el reporte
que lo cierra audita y cierra solicitudes. Lo cubre `jobs.int-spec.ts`.

### Salidas, etapa 1 (2026-11-14)

Expediente de la salida de un centro (CONTEXTO.md seccion 8) en la consola:
modelo `Salida` (migracion aditiva `20261114180000_salidas`), servicio con las
transiciones EN_SALIDA -> EXPORTADO -> GRACIA -> ELIMINADO (cada una con
transicion, auditoria e idempotencia), vista Salidas y "Iniciar salida" en el
silo. Los pasos fisicos siguen el procedimiento manual del ERP
(`baja_centro.md`); el ejecutor sigue sin verbo de borrado.

Controles: el acta exige que la huella firmada por el centro coincida con la
del exporte; "silo detenido" se rechaza si el agente vio contenedores
`running` en los ultimos 5 min, y al aceptarse suelta el silo del monitoreo;
eliminar exige gracia vencida, confirmacion escrita, checklist completo y el
slug escrito. Cada acta guarda su hash (JSON canonico).

Pruebas: 8 unitarios y 14 de integracion. Revision visual en una copia
aislada (Postgres desechable, API 4150, web 3150, sin tocar el stack local) a
1280, 1536 y 1920 px: sin desborde. Se encontro y corrigio una huella de 64
caracteres que tapaba su etiqueta en el detalle.

Requisitos nuevos del ERP: R12 (solo lectura) y R13 (exportaciones por
`/api/internal`), en `docs/requisitos-erp.md`.

### Salidas: ejecutor (B + C), reversion y actas por correo (2026-11-14)

Decisiones del usuario: opciones B (`detener`/`reanudar`, no borran) y C
(`eliminar` real, acotado) para el ejecutor; poder revertir una salida (baja por
error o arrepentimiento en la gracia); enviar las actas por correo.

- Ejecutor (`apps/ejecutor/src/ciclo.ts`): `detener`, `reanudar` y `eliminar`.
  `eliminar` exige el archivo `bajas/<slug>` en el host B (montado en solo
  lectura) con el hash del acta de recepcion, el mismo hash en la peticion, el
  silo detenido y fuera de la ventana de respaldo; valida todo antes de borrar
  y solo borra recursos del proyecto `erp-<slug>` y `respaldos/<slug>/`. Nunca
  llaves. 11 tests con Docker y disco simulados.
- Agente: pasos D1-D3 (DETENER_SILO), A1-A2 (REANUDAR_SILO), X1-X3 (ELIMINAR).
- API: jobs de una salida con P0 propio (lee la salida viva); al terminar OK,
  `SalidasCierre` pasa a GRACIA, registra la eliminacion o completa la
  reversion. Un fallo de ese cierre no se devuelve al agente (queda en la
  auditoria). Rutas de salidas por id; varias salidas por centro con una sola
  abierta (unico `(centro_id, abierta)`; un indice parcial no lo maneja Prisma).
  Migracion aditiva `20261114210000_salidas_reversion_y_ejecutor`.
- Actas de eliminacion y de reversion al responsable de datos del manifiesto
  (si no hay, al contacto), con hash; si el correo falla se reenvia.
- Consola: Detener silo / Ya lo detuve a mano, Eliminar silo (muestra el comando
  del consentimiento con el hash), acta S7 con los items probados por el job ya
  marcados y la evidencia del ejecutor, Revertir salida, historial de salidas
  revertidas.

Pruebas: API 74 unitarios y 70 de integracion; agente 13; ejecutor 22. Los
verbos nuevos no se probaron aun contra Docker real.

### R1: imagenes por digest y registro del host B (2026-11-15)

Decisiones del usuario: `registry:2`; por ahora se publica con un script en el
host B (la CI de publicacion despues); la CI del ERP sera GitHub Actions (el
ERP esta en GitHub, no en Bitbucket). Ruta real del ERP:
`Repositorios/Vinculos/Vinculos` (CLAUDE.md decia `Desktop/SW Proyecto`).

- ERP: `infra/docker-compose.yml` sin `build` (`${REGISTRO}/vinculos-api@${API_DIGEST}`,
  `${REGISTRO}/vinculos-web@${WEB_DIGEST}`); override `infra/docker-compose.build.yml`
  para desarrollo y silos de prueba (`servidor.sh`, `stress/`);
  `infra/scripts/imagenes/publicar.sh`; `docs/operacion/imagenes.md`.
- Control: servicio `registro` (`registry:2.8.3`, 127.0.0.1:5000, sin borrado,
  sin TLS ni usuario por estar solo en loopback) en `infra/host-b`;
  `generar.mjs` reemplaza a `generar.py` (no hay Python en el PC); la plantilla
  queda igual al compose del ERP.

Pruebas (Docker 29, containerd store): rechazos de version (sin sufijo con
arbol sucio, otra version, `dev`); publicacion real de `0.1.0-prueba.1`
(digests en `infra/imagenes/0.1.0-prueba.1.env`); republicar el mismo tag:
rechazado; silo desechable `r1prueba` solo con el compose base: imagen bajada
por digest, `migrate` aplico las migraciones e `identidad_silo`, label OCI con
el commit; `API_DIGEST` vacio: `invalid reference format` (falla cerrado).
Silo borrado al terminar. La imagen `0.1.0-prueba.1` queda en el registro (no
hay borrado por API; se pierde solo si se borra el volumen `registro_datos`).
