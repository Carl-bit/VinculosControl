# ERP Vinculos: reglas de negocio, despliegue y lo que el plano de control debe saber

Fecha: 2026-11-07. Fuente: repo `vinculos` (`C:\Users\cagaj\Desktop\SW Proyecto`),
sus docs (`docs/`), la BD (migraciones y `schema.prisma`) y las decisiones del
usuario tomadas durante el desarrollo.

Complementa `CONTEXTO.md` (diseno del plano de control). Este documento
describe **como es el ERP hoy**, no como se imagino. Si los dos chocan, manda
el ERP (la BD) y la diferencia se resuelve en la seccion 9 antes de codificar
la pieza afectada.

Formato ASCII (sin rayas largas ni comillas tipograficas), como pide `CLAUDE.md`.

---

## 1. Estado del ERP

| Tema | Estado |
|---|---|
| Version en `package.json` | `0.1.0` (backend y frontend). El primer tag del registro fija la version real |
| Migraciones | 68 en `backend/prisma/migrations/`. Algunas historicas son destructivas (ej. `quitar_lista_espera`); la regla "solo aditivas" rige desde el primer silo real |
| Modulos construidos | Nucleo, Fichas y Pacientes, Agenda y Espacios, Equipo, Match, Pagina publica, WhatsApp (flag, apagado). Sin Cobros: borrado del ERP el 2026-11-16 (migracion `20261116000000_mvp_sin_cobros`) |
| Tenant de validacion | "Centro de Prueba" (seed demo, `npm run seed:demo`). Kibou y otros clientes reales vienen despues |
| Fase actual | Post 03b-6 y AUD-02. Plan hacia el piloto: `docs/operacion/plan_trabajo_piloto.md`. Post-MVP: `docs/backlog_post_mvp.md` |
| Produccion | No existe aun. Proximo paso: VPS de prueba (equipo propio) con SMTP real, luego Lightsail |

Stack del silo: NestJS + Prisma + PostgreSQL 18, Next.js (App Router), Traefik v3.6 (v3.3 no habla con Docker 29).

---

## 2. Que es un silo hoy (composicion real)

Un silo NO es un solo contenedor. Es el stack `erp-<slug>` de
`infra/docker-compose.yml` con su propio `.env`:

| Servicio | Que hace | Red |
|---|---|---|
| `db` | Postgres 18 con `pg_stat_statements`. Volumen `db_data` | `interna` (nunca expuesta) |
| `migrate` | Corre y termina: `prisma migrate deploy` + contrasena de `app_user` + `identidad_silo.js` (registra el slug; falla si la BD es de otro silo). Unico con credenciales del dueno | `interna` |
| `backend` | API Nest en `:3001`, ruta `/api`. Solo `app_user` (sujeto a RLS), `connection_limit=12`, `application_name=erp-<slug>-backend`. Monta la KEK como Docker secret | `interna` + `borde` + `silo` (alias `api-silo`) |
| `frontend` | Next en `:3000`, todo lo que no es `/api`. Nombre, tema y dominio en runtime (`CENTRO_NOMBRE`, `TEMA`, `SITE_URL`) | `borde` + `silo` |

Volumenes: `db_data`, `exportaciones` (archivos cifrados temporales, maximo 24 h).
Secretos por silo, fuera de git: `infra/secrets/<slug>/kek`, `recuperacion.pub`, `respaldo.key`.
Imagenes comunes (R11, 2026-11-13): `vinculos-api:${VINCULOS_VERSION}` y `vinculos-web:${VINCULOS_VERSION}`; nada del centro se hornea en la imagen.
Redes, todas del silo (nombre de compose): `erp-<slug>_interna` (unica con salida), `erp-<slug>_silo` (internal) y `erp-<slug>_borde` (internal, label `cl.vinculos.red=borde`). Traefik se une a `erp-<slug>_borde` con `docker network connect` despues del `up` y se suelta antes del `down`. La red `proxy` es solo del plano del host (cloudflared + Traefik): ningun silo entra en ella.
Labels en cada contenedor: `cl.vinculos.silo`, `cl.vinculos.servicio`, `cl.vinculos.version`.
`/api/internal/*` bloqueado en Traefik (router con prioridad + `ipallowlist` 127.0.0.1/32): el agente entra por la red de borde.
`/api/internal/*` (2026-11-13): token por silo; el silo guarda solo su SHA-256 en `identidad_silo` (`INTERNO_TOKEN_SHA256` del `.env`, lo aplica `migrate`). Hoy expone R2 (`GET /api/internal/solicitudes`) y R3 (`POST /api/internal/solicitudes/:id/respuesta`); R4 y R5 se agregan sobre la misma base.

Roles de Postgres por silo:
- `POSTGRES_USER`: superusuario, solo existe dentro del contenedor `db` (init).
- `vinculos_owner`: dueno; solo `migrate`, seed, scripts de llaves y respaldo. Nunca para leer datos.
- `app_user`: la API. Sujeto a RLS, sin DELETE/UPDATE sobre datos clinicos ni auditoria.
- `soporte_vinculos`: NOLOGIN por defecto; solo funciones de diagnostico con autorizacion del centro (seccion 6).

Variables del silo (`infra/.env.example` + `backend/.env.example`):
`CLIENTE_SLUG`, `CENTRO_NOMBRE`, `DOMINIO`, `POSTGRES_*`, `OWNER_DB_PASSWORD`,
`APP_DB_PASSWORD` (solo caracteres URL-safe), `JWT_SECRET` (32+, unico por silo),
`JWT_ACCESO_MINUTOS=15`, `SESION_INACTIVIDAD_MINUTOS=30`,
`LOGIN_LIMITE_POR_MINUTO=10`, `PUBLICO_LIMITE_POR_MINUTO=60`,
`BLOQUEO_TEMPORAL_TTL_SEGUNDOS=300`, `SMTP_URL`, `CORREO_REMITENTE`,
`SES_CONFIGURATION_SET`, `JITSI_*`, `DOCUMENTO_ENLACE_HORAS=72`, `ADJUNTO_MAX_MB=10`.
En produccion: `JOBS_HABILITADOS=true`, `JOBS_MANUALES=false` (con `true` la API
no arranca en produccion), Swagger apagado (`NODE_ENV=production`).

Presupuesto de memoria (AUD-02, medido): un silo completo usa ~460-520 MB.
Plan objetivo Lightsail **1 GB / 1 vCPU, un silo por host**. Limites previstos
por contenedor: API 256M, front 256M, Postgres 256M (`shared_buffers=64MB`,
`max_connections=24`, `work_mem=2MB`). No volver a 512 MB. Puede subir tras las
pruebas de capacidad por centro.

Salud: `GET /api/salud` (publico, sin rate limit). Responde
`{ estado, bd, canarios }`, 200 o 503. Solo booleanos. Canarios = la KEK montada
descifra los valores de prueba.

---

## 3. Reglas de negocio del ERP (el plano de control no las rompe ni las ve)

### 3.1 Aislamiento y datos
- Un silo = una BD. Cero consultas entre silos. Sin `tenant_id` compartido.
- RLS real en Postgres (`SET LOCAL app.current_usuario_id` / `app.current_rol` por transaccion). El filtro del service es segunda capa.
- Columnas con RUT, contacto, dato bancario o texto clinico van cifradas en la aplicacion (AES-256-GCM, DEK por categoria envueltas con la KEK del silo). Respaldos llevan esas columnas cifradas.
- Categorias de datos A/B/C (`docs/seguridad/criterio_clasificacion.md`).
- Nada clinico en logs, localStorage ni analitica. Sin analitica de terceros.

### 3.2 Roles
ADMIN (cuenta madre), GESTION (apagado por defecto: `rol_gestion_habilitado`),
PROFESIONAL, PRACTICANTE, PACIENTE, RESPONSABLE (adulto responsable de un menor).
Multirrol permitido; el rol activo se elige y cambiarlo emite token nuevo.
- Segundo factor por correo (6 digitos, 10 min, 5 intentos, 10 codigos de respaldo): obligatorio equipo, opcional paciente/responsable. TOTP existe pero apagado (`TOTP_HABILITADO=false`). R10 (2026-11-19): un silo de demostracion (`ES_DEMO=true` en el backend y `silo_es_demo()` en la BD) no lo pide.
- Sesion unica por usuario: un login nuevo corta el anterior. Conexiones registradas sin IP ni ciudad.
- Practicantes: acceso con `fecha_expiracion_acceso`; revocar = deshabilitar, nunca borrar historial.

### 3.3 Fichas clinicas
- La ficha solo la ve su tratante. Ficha ajena solo por `derivaciones` (protocolo formal), nunca por cambio de rol. El admin ve codigos de ficha.
- Nunca hard delete. Evoluciones append-only y versionadas.
- Retencion minima 15 anos desde la ultima atencion (Ley 20.584, Decreto 41). Purga manual desde un listado.
- Todo acceso a datos clinicos queda en `accesos_ficha`. Deteccion: mas de 40 pacientes distintos por cuenta en una hora genera alerta ACCESO_ANOMALO al ADMIN.
- Cerrar la cuenta de un profesional borra su trayectoria y respaldos de titulos ("del profesional no se retiene nada como persona"); las fichas que atendio quedan.

### 3.4 Agenda y reservas
- Fuente de verdad: `EXCLUDE USING gist` (btree_gist) sobre espacio + rango. El soft-lock con TTL es solo UX. Choque = 409 con alternativas.
- La hora se confirma con el pago. Reserva sin cuenta = cita RETENIDA sin paciente; el pago validado (o el correo verificado si paga en el centro) crea paciente + ficha. No hay aprobacion aparte de pacientes nuevos.
- Cita que agenda el equipo: PENDIENTE_PAGO hasta 12 h antes (avisos 48 h y 24 h); sin pago al vencer **no se libera**, queda deuda.
- Moroso = sesion pasada con saldo > 0 (gracia 0 por defecto). Bloquea agendar la siguiente; ADMIN/GESTION pueden saltarlo con motivo auditado.
- Menor de 18: no se confirma la cita sin un registro en `adultos_responsables`. Copia de datos: menor de 14 solo sus adultos; 14 a 17 el paciente y sus adultos.
- Lista de espera retirada (post-MVP).
- Feriados nacionales calculados por la BD (job `generar_feriados`); regionales/puntuales los agrega el ADMIN.

### 3.5 Equipo
- Un profesional no sale en el sitio publico hasta que la cuenta madre valida registro SIS (RNPI) + titulo. RNPI hoy manual (sin apikey de la Superintendencia).
- El perfil lo gestiona el profesional; el admin solo pide correcciones. A la segunda solicitud sin cambios, la cuenta madre puede editar y avisa el motivo.
- Certificado de alumno regular y convenio de practica: versionados y cifrados; no definen el acceso (lo definen las fechas de la practica).

### 3.6 Dinero
- Vinculos no recibe dinero. MVP sin pagos ni finanzas (2026-11-16): el ERP no tiene modulo de Cobros (ni tablas, ni funciones, ni pasarela, ni estado PENDIENTE_PAGO). La hora que pide el paciente queda SOLICITADA y la aprueba su profesional. Las tarifas, FONASA y la boleta reembolsable son solo informativas.
- Cobros post-MVP: modulo nuevo, con las reglas de finanzas que cierre el usuario.

### 3.7 Titulares de datos (Ley 21.719, vigente 1-dic-2026)
- Centro = Responsable; Vinculos = Encargado.
- Solicitudes ARCOP con plazo en dias habiles; titular sin cuenta se identifica por RUT; la respuesta va solo al correo registrado.
- Bloqueo de tratamiento: impide gestiones nuevas; lo agendado se mantiene.
- Terminos de servicio y DPA viven **en el silo** (version por centro). El operador los publica como dueno; un ADMIN los acepta (`aceptaciones_contrato`); mientras haya version sin aceptar, el panel lo exige.

### 3.8 Correo
- SMTP de la plataforma (SES previsto, Mailpit en local). Remitente de la plataforma con el nombre del centro y Reply-To del centro.
- Plantillas sin contenido clinico (CHECK en la BD). Documentos clinicos solo por enlace con sesion o enlace temporal.
- El paciente contacta al profesional por formulario in-app (se reenvia al correo); no hay respuesta in-app.

---

## 4. Parametros del centro (lo que el manifiesto puede fijar)

Todo vive en `configuracion_centro` (una fila). Mapeo con las `reglas` del
manifiesto de `CONTEXTO.md` (corregir el manifiesto, no el ERP):

| Columna real (snake_case) | Que controla |
|---|---|
| `nombre_centro`, `rut_centro` (cifrado) | Identidad |
| `modulos_activos` | Modulos. Enum `modulo_centro`: PAGINA_PUBLICA, FICHAS, AGENDA, EQUIPO, MATCH, WHATSAPP. Default todos menos WHATSAPP. **Sin GRANT UPDATE a la API: solo el operador lo cambia** |
| `rol_gestion_habilitado` | Activa GESTION |
| `plazo_aviso_cancelacion_horas` | Plazo para cancelar a tiempo (sin cargos) |
| `margen_traslado_min` | Margen entre sesiones |
| `recordatorio_horas_antes` | Recordatorio por correo |
| `plazo_respuesta_derivacion_horas` | Derivaciones |
| `plazo_consentimiento_horas`, `plazo_oposicion_horas` | Consentimiento de practicante y oposicion |
| `dias_gracia_cierre` | Cierre de cuentas |
| `comision_centro_porcentaje`, `comision_derivacion_tipo`, `comision_derivacion_valor` | Comision por paciente traido por el centro |
| `liquidar_exige_evolucion`, `liquidar_cargos_a_profesional` | Liquidaciones |
| `match_filtro_directo`, `dias_retencion_respuestas_match` | Match |
| `minutos_retencion_solicitud`, `retencion_mensajes_dias` | Retencion operativa |
| `edad_minima_cuenta` | Edad para cuenta propia |
| `medios_pago_habilitados`, `plazo_validacion_transferencia_horas`, `porcentaje_pago_confirmacion`, `horas_plazo_pago_equipo` | Pagos y confirmacion |
| `dias_gracia_morosidad`, `bloquear_agenda_morosos`, `morosidad_desde` | Morosidad |

Otros datos de configuracion inicial (tipo A del contexto): horario del centro,
contenido publico y marca por zona (colores con contraste exigido por la BD,
logo), tipos de atencion (la duracion de sesion vive aqui, no en un parametro
global), espacios/boxes, plantillas de mensaje, politicas (terminos, DPA).

Temas visuales del ERP (revisado 2026-11-12): "Moderno A" (Figtree, tokens CSS) y
"Cuaderno" (`frontend/src/app/temas/cuaderno.css`, build arg `NEXT_PUBLIC_TEMA`,
`TEMA` en el `.env` del silo). `editorial` esta disenado (boceto del landing)
pero no implementado en el ERP.

---

## 5. Metodologia de despliegue actual (manual, la que el agente debe automatizar)

Orden real hoy, en el host del silo. Cada paso tiene su doc en el ERP.

| # | Paso | Comando / doc |
|---|---|---|
| 1 | Red y proxy (una vez por host) | `docker network create proxy`; `infra/traefik/docker-compose.yml` (TLS 1.2+, `dinamico.yml`) |
| 2 | `.env` del silo | Copiar `infra/.env.example`; contrasenas y `JWT_SECRET` nuevos, nunca reutilizados |
| 3 | BD + migraciones | `docker compose -f infra/docker-compose.yml --env-file infra/.env up -d db migrate` |
| 4 | Llaves | `CUSTODIOS="Proveedor:operador,Centro:direccion,Sobre offline:caja fuerte" CLIENTE_SLUG=<slug> MODO=docker sh infra/scripts/llaves/aprovisionar.sh`: KEK, `recuperacion.pub`, 4 DEK con canario, 3 partes Shamir. Entregar cada parte por un canal distinto y `shred -u` de `partes_entregar/` (`docs/seguridad/runbooks_llaves.md`) |
| 5 | Levantar | `docker compose ... up -d` y `docker network connect erp-<slug>_borde <traefik>`. La API solo arranca si la huella de la KEK y los canarios coinciden (falla cerrado) |
| 6 | Verificar respaldo | Respaldo + restauracion de prueba con KEK y con 2 partes |
| 7 | Continuidad | `CLIENTE_SLUG DOMINIO DESTINO_RESPALDO ALERTA_URL MAILTO sh infra/scripts/continuidad/instalar.sh`: `respaldo.key`, cron de respaldo 02:00, `salud.sh` cada 5 min, recordatorio de prueba mensual |
| 8 | Contrato | `INSERT INTO politicas (tipo, version, texto)` de TERMINOS_SERVICIO y DPA como dueno en `migrate` (`docs/cumplimiento/contrato_centro.md`) |
| 9 | Admin inicial | Hoy por seed. No existe endpoint de invitacion inicial (ver seccion 9) |

Respaldos (`docs/cumplimiento/continuidad.md`): `pg_dump -Fc` diario 02:00 Chile,
cifrado AES-256 con openssl/PBKDF2 y `respaldo.key` (distinta de la KEK), copia a
un prefijo por silo, sha256. Retencion 7 dias en host, 35 en destino externo.
Prueba de restauracion mensual registrada en `eventos_llaves`. RPO 24 h, RTO 4 h habiles.

Monitoreo actual: `salud.sh` consulta `/api/salud`; dos fallos seguidos avisan por
`ALERTA_URL` (POST `{"texto": ...}`) y correo de cron. Pendiente del plan del
piloto: disco > 80 %, 5xx sostenidos, p95 por ruta desde `docker logs`,
`pg_stat_statements` (`docs/operacion/pg_stat_statements.md`).

Entrada de red decidida (AUD-02): Cloudflare con tunel `cloudflared`, sin puertos
abiertos en el host. Consecuencias: el challenge TLS-ALPN de Let's Encrypt no
funciona; el ERP ya valida por DNS (`dnschallenge` de Cloudflare con
`CF_DNS_API_TOKEN`, 2026-11-07). Traefik no publica puertos: cloudflared entra
por la red `proxy` a `https://traefik:443` con Origin Server Name = dominio
(`sniStrict`). La IP real llega en `X-Forwarded-For` (Traefik confia en las
redes privadas; rate limit), Cloudflare cache solo estaticos, DPA de
Cloudflare firmado antes de datos reales. Cloudflare ve el trafico en claro: es
subencargado.

Pruebas de capacidad (`prompts/04_pruebas.md`), hechas en local el 2026-11-07
(`docs/operacion/resultados_04_pruebas.md`): 0 citas solapadas, una 201 por ronda
de colision, `lectura_publica` p95 6,6 ms, picos de 98 MiB (API) y 100 MiB
(Postgres) de 256. Se repiten en Linux en la fase 5. Despues VPS de prueba con SES
real (SPF, DKIM, DMARC, puerto 587, salir del sandbox), sin datos reales y con
disco cifrado.

Silo de estres reutilizable (`infra/stress/` del ERP): `levantar.sh` arma un silo
efimero `erp-stress` con el compose real, las llaves por el runbook y el seed
demo; `verificar.sh` revisa solapes, reinicios y OOM; `bajar.sh` lo borra. Es el
mismo flujo que el agente debe automatizar (P3-P7), salvo que aqui las partes de
la llave se descartan. k6 corre como contenedor `grafana/k6` en la red del silo.

Servidor de pruebas (`infra/servidor/servidor.sh` del ERP, 2026-11-07; paso a
paso en `docs/operacion/servidor_pruebas.md`): Ubuntu, dos silos `estres`
(persistente, k6) y `demo` (`servidor.sh reiniciar demo`). El `docker-compose.yml`
de la raiz del ERP es el plano del host (Traefik + Mailpit compartido con clave);
cada silo sigue siendo su stack `erp-<slug>` con su `.env` generado en
`infra/servidor/silos/`. El seed corre en un contenedor (`seed`, etapa `build`
del Dockerfile), sin Node en el host: es el P7 que el agente debe replicar.

Senales para el monitoreo de la consola:
- 503 de la API = pool de conexiones saturado (Prisma P2028, `connection_limit=12`),
  con `Retry-After: 2`. Muchos 503 seguidos indican subir el limite o el plan.
- 409 por `40P01` (deadlock) bajo rafagas de reservas: normal en poca cantidad.
- Las listas `/pacientes`, `/auditoria/accesos` y `/notificaciones` ahora son
  paginadas (`{ items, siguienteCursor }`, maximo 100).

---

## 6. Soporte, incidentes y baja (lo que la consola debe registrar)

### Soporte (`docs/cumplimiento/soporte.md`)
- El soporte nunca ve datos personales ni clinicos, cifrados o no (decision D5).
- El ADMIN del centro otorga una autorizacion (motivo, alcance DIAGNOSTICO o CONFIGURACION, 1 a 72 h) en Configuracion > Soporte. Sin ella no se hace nada.
- El operador habilita `soporte_vinculos` con `VALID UNTIL` y corre solo `soporte_resumen()`, `soporte_notificaciones_con_error(dias)` y `soporte_configuracion()`. Todo queda en `registro_soporte`, visible para el ADMIN.
- Si el problema exige tocar datos: lo corrige el centro desde el panel, o se vuelve cambio de producto (migracion revisada). Conectarse como dueno fuera de mantencion es un incidente.
- La consola puede llevar las solicitudes de soporte (ticket, fechas, alcance pedido, resultado sin datos) y el canal externo de respuesta.

### Incidentes (`docs/cumplimiento/incidentes.md`)
| | S1 critico | S2 alto | S3 medio |
|---|---|---|---|
| Contencion | max 1 h | max 4 h | max 2 dias habiles |
| Aviso inicial al centro | **max 24 h** | **max 48 h** | informe mensual |
| Actualizaciones | cada 24 h | cada 48 h | - |
| Informe final | 10 dias habiles | 10 dias habiles | 20 dias habiles |

El registro de incidentes va fuera del silo: buen candidato para la consola
(sin datos personales; solo silo, severidad, fechas, plazos y estado).

### Baja (`docs/cumplimiento/baja_centro.md`)
1. El ADMIN genera la exportacion del centro ("Preparar ahora (urgente)"). Job asincrono dentro del silo; archivo `exportacion-centro-AAAA-MM-DD.vxp` cifrado con AES-256-GCM y clave del ADMIN (16+ caracteres, derivada con scrypt, no se guarda). Disponible 24 h, se borra al descargar. Contenido: todas las tablas salvo llaves, sesiones, tokens, codigos e intentos de login; columnas cifradas ya legibles; un PDF por ficha. Huella SHA-256 en `registro_exportaciones`.
2. El centro descifra con `infra/scripts/exportacion/descifrar.mjs` y firma el acta de recepcion (huella, conteos, quien recibe).
3. Gracia: 30 dias desde el acta salvo otro plazo en el contrato. Confirmar por escrito antes de borrar.
4. Eliminacion: `down`, borrar volumenes, respaldos locales y del bucket (con versiones), `shred -u` de `infra/secrets/<slug>/`, aviso a custodios para destruir sus partes, quitar dominio y crontab (`# vinculos:<slug>`).
5. Acta de eliminacion guardada fuera del silo (consola), copia al centro.

---

## 7. Lo que el plano de control puede guardar (y lo que no)

Puede (metadatos): slug, dominio, version/tag/digest, revision del manifiesto
aplicada, modulos activos, estado del ciclo de vida, resultado de `/api/salud`
(booleanos), CPU/RAM/disco por contenedor, latido del agente, resultado de
jobs, fechas y huellas de exportaciones, actas, version de terminos/DPA y
fecha de aceptacion, solicitudes de soporte, incidentes, custodios de llaves
(nombre y rol, nunca la parte).

No puede: nada de pacientes ni fichas, ni nombres del equipo del centro (salvo
el contacto comercial y el admin inicial que el centro entrega), ni la KEK,
`respaldo.key`, partes Shamir o contrasenas de BD, ni la clave del exporte, ni
el contenido de `registro_soporte` mas alla de lo que el ADMIN comparta.

Conteos operativos del silo (usuarios activos, citas por estado) existen en
`soporte_resumen()`, pero exigen autorizacion vigente del centro. Si la consola
quiere conteos periodicos sin autorizacion, debe acordarse en el DPA y
exponerse por una funcion nueva solo con agregados.

---

## 8. Subencargados y legal

Lista en `docs/cumplimiento/subencargados.md` (alimenta el DPA de cada centro):
AWS Lightsail (servidor y respaldos), AWS SES (correo), Let's Encrypt (solo
dominio), Cloudflare (tunel, ve trafico en claro), pasarela y boletas (post-MVP),
Meta WhatsApp (post-MVP). Sin analitica, IA ni agregadores de logs externos.
Agregar un proveedor = actualizar la lista y avisar al centro antes de que trate datos.

El plano de control suma sus propios proveedores (host A, SES para el 2FA de la
consola, Bitbucket). Si solo maneja metadatos de contacto comercial, no es
subencargado de datos de pacientes, pero el contacto del centro es dato personal:
anotarlo en la politica de privacidad del sitio de Vinculos.

Pendiente legal: texto final de terminos y DPA con asesoria, si la aceptacion de
un ADMIN basta como firma, plazo de eliminacion por defecto, menores (D-4),
retencion de respaldos de titulos.

---

## 9. Diferencias entre CONTEXTO.md y el ERP real

Resueltas el 2026-11-07: `CLAUDE.md` y `CONTEXTO.md` ya se alinearon con la columna "Propuesta". Las que dicen "Cambio en el ERP" o "Agregar al ERP" siguen pendientes en el repo `vinculos` y bloquean la automatizacion de ese paso (mientras tanto, el paso es manual).

| # | CONTEXTO.md dice | ERP hoy | Propuesta |
|---|---|---|---|
| 1 | "Misma imagen para todos" | `compose` hace `build` por silo (`erp-backend:${CLIENTE_SLUG}`) y el front recibe `NEXT_PUBLIC_CENTRO_NOMBRE` y `NEXT_PUBLIC_SITE_URL` como build args (quedan horneados) | Cambio en el ERP: imagen `vinculos-api:<ver>` y `vinculos-web:<ver>` publicadas por CI; nombre del centro y URL leidos en runtime (env del servidor o `/api/configuracion`). Prerequisito del registro y de la cascada |
| 2 | Un contenedor por silo | Cuatro servicios (db, migrate, backend, frontend) | Plantilla `silo.compose.tpl` a partir de `infra/docker-compose.yml` |
| 3 | Limites 512 MB / 1 vCPU por silo | Medido 460-520 MB; plan 1 GB y un silo por host | Host B de pruebas: 1 GB por silo (16 GB alcanzan para 2 de prueba + demo). En Lightsail, un host B por silo cambia el modelo "un agente por host": el agente corre en cada host de silo |
| 4 | `GET /health` | `GET /api/salud` | Usar `/api/salud` |
| 5 | `/internal/*` (`/internal/config`, `/internal/admin-inicial`) con token por silo | No existe. Modulos, terminos y DPA se cambian como dueno por SQL; admin inicial por seed | Agregar al ERP un modulo `interno` (red Docker, token por silo) que llame funciones SECURITY DEFINER: aplicar revision de manifiesto, invitar admin inicial (un uso, 72 h), publicar politicas, notas de version. Nunca credenciales de dueno en runtime |
| 6 | P3: el job genera los secretos | Regla del ERP: "Nada genera llaves automaticamente: solo estos scripts, a mano"; KEK con 3 partes Shamir y custodios | Separar: JWT y contrasenas de BD los puede generar el agente; KEK y partes siguen manuales (o se cambia la regla de forma explicita). El job queda en "ESPERANDO_LLAVES" hasta que el operador corre `aprovisionar.sh` |
| 7 | Respaldos con `age` | openssl AES-256 PBKDF2 con `respaldo.key` | Elegir uno. Mantener openssl evita reescribir `respaldar.sh`, `descifrar_respaldo.sh` y `verificar_respaldo.sh` |
| 8 | Exporte ZIP/7z AES-256, contrasena aleatoria por SMS/WhatsApp, formato canonico CSV | `.vxp` AES-256-GCM con clave del ADMIN, JSON por tabla + PDF por ficha, `descifrar.mjs` | El `.vxp` ya cumple (clave que el proveedor no conoce). El formato canonico seria un adaptador de salida aparte, post-MVP |
| 9 | Modulos `nucleo, fichas, agenda, equipo, match, cobros, sitio_publico` | Enum `PAGINA_PUBLICA, FICHAS, AGENDA, EQUIPO, MATCH, COBROS, WHATSAPP`; nucleo implicito | El paquete `@vinculos/manifest` usa el enum del ERP (o un mapeo fijo). Agregar WHATSAPP (sin dependencia definida). La BD solo exige MATCH -> EQUIPO y COBROS -> AGENDA; PAGINA_PUBLICA -> EQUIPO la valida el plano de control |
| 10 | Reglas `agenda.duracion_sesion_min`, `pagos.modelo: directo_profesional`, etc. | Columnas de la seccion 4; duracion por tipo de atencion; `modelo_cobro` CENTRO/DIRECTO/MIXTO | Reescribir `reglas` del manifiesto con los nombres de `configuracion_centro` |
| 11 | Temas moderno/cuaderno/editorial | "Moderno A" y "Cuaderno" (2026-11-12) + marca por zona | Manifiesto acepta `moderno` y `cuaderno` (`TEMAS` en `packages/manifest`); `editorial` solo como preferencia de fase 1 |
| 12 | Roles sin RESPONSABLE | RESPONSABLE existe | Agregar al dominio |
| 13 | Traefik con Let's Encrypt automatico, CNAME para dominio propio | Decision AUD-02: tunel Cloudflare, sin puertos | P8 cambia: ruta en el tunel + certificado por DNS o de origen. Dominio propio del centro requiere Cloudflare for SaaS (custom hostnames) o que el centro delegue DNS |
| 14 | Migraciones solo aditivas | Historial con migraciones destructivas | Regla rige desde el primer silo real; documentarlo en el ERP |
| 15 | Monitoreo de conteos | `soporte_resumen()` exige autorizacion | Ver seccion 7 |

---

## 10. Cosas que se pueden estar olvidando

- **Ley 21.719 entra en vigencia el 1-dic-2026**: el DPA, la lista de subencargados y el registro de incidentes deben existir antes del primer centro real.
- **Notas de version al ADMIN**: el contexto dice que el admin ve las notas en su panel; el ERP no tiene esa pantalla. Necesita endpoint interno + vista.
- **Silo demo**: el seed paga las horas de hoy y del proximo dia habil, asi que un reset nocturno no es obligatorio (basta cada 2 dias habiles). Si se hace cada noche, invalida sesiones abiertas (sesion unica).
- **Sesion unica**: cualquier script del agente que entre al silo con una cuenta de usuario corta la sesion de esa persona. El agente nunca debe usar cuentas de usuario; solo `/internal/*`.
- **Rate limit**: hoy en memoria por proceso. Si un silo tiene varias replicas, mover el contador a Postgres/Redis del silo y registrar que instancia corre la exportacion (`todo.txt`).
- **Exportacion programada**: por defecto corre en ventana nocturna segun el horario del centro; un `actualizar` no debe coincidir con una exportacion en curso (bloquear el job si `registro_exportaciones` tiene una EN_CURSO, consultable por funcion interna).
- **Jobs internos del silo** (crons de la API: recordatorios, feriados, canarios, anomalias, bajas, notificaciones) usan `pg_advisory_lock`. Un swap de contenedor a mitad de un job es seguro, pero conviene hacer el swap fuera de la ventana nocturna de exportaciones y respaldo (02:00).
- **Rollback de imagen**: solo es seguro si la migracion fue aditiva. El paso `actualizar` debe verificar en P0 que la version nueva no tiene migraciones marcadas como destructivas.
- **Custodia de llaves por silo**: la consola puede guardar quien custodia cada parte y las fechas de rotacion (DEK anual), prueba mensual de restauracion y simulacro trimestral (`runbooks_llaves.md`), para recordarlas.
- **Feriados y plazos habiles**: los plazos de derechos usan feriados del silo; no dependen del plano de control.
- **Correo del plano de control**: separar la identidad SES de la consola de la de los silos (configuration set propio) para que un rebote masivo de un centro no afecte el 2FA de la consola.
- **Pasarela**: aunque el centro conecte la suya, las credenciales viven en el silo (cifradas), nunca en el manifiesto ni en la consola.
- **RNPI**: si se obtiene la apikey de la Superintendencia, es por plataforma; decidir si va como secreto del silo o del proveedor.
- **Interfaz**: optimizada para 1920x1080, areas de 44 px, texto 15 px o mas, contraste AA, `prefers-reduced-motion`. Prohibidos los degradados morado-azul, Inter sola, iconos en tiles repetidos y easing de rebote.

---

## 11. Documentos del ERP a leer segun la pieza

| Pieza del plano de control | Leer en el ERP |
|---|---|
| Manifiesto y P5 | `backend/prisma/schema.prisma` (`ConfiguracionCentro`, enums), `docs/front/configuracion_centro_volcado.md` |
| P2-P7 (silo) | `infra/docker-compose.yml`, `infra/.env.example`, `backend/.env.example`, `docs/seguridad/cifrado.md`, `docs/seguridad/runbooks_llaves.md` |
| Respaldos y salud | `docs/cumplimiento/continuidad.md`, `infra/scripts/continuidad/` |
| Rendimiento y limites | `docs/operacion/auditoria_rendimiento.md`, `docs/operacion/plan_trabajo_piloto.md` |
| Correo | `docs/api/correo_ses.md`, `docs/api/integraciones.md` |
| Salida | `docs/cumplimiento/baja_centro.md`, `docs/cumplimiento/exportacion.md` |
| Soporte e incidentes | `docs/cumplimiento/soporte.md`, `docs/cumplimiento/incidentes.md` |
| Legal | `docs/cumplimiento/contrato_centro.md`, `plantillas/`, `subencargados.md`, `brechas_saas.md` |
| Permisos | `docs/seguridad/matriz_permisos.md`, `requisitos_02_apis.md` |
| Post-MVP | `docs/backlog_post_mvp.md` |
