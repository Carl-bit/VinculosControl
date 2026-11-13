# Roadmap de vinculos-control (actualizado 2026-11-13)

Memoria de avance del plano de control: que esta hecho, que falta y que
depende del ERP. Se actualiza al cerrar cada pieza (estado + fecha + nota).

Estados: **Hecho**, **Parcial**, **Pendiente**, **Bloqueado (ERP)** (necesita
algo que el ERP aun no tiene; se anota como requisito, no se simula aqui).

Especificacion de lo que falta en el ERP: `docs/requisitos-erp.md`.

Fuentes: `CONTEXTO.md` (diseno), `ERP_REGLAS_Y_DESPLIEGUE.md` (estado del ERP),
`system-reference/` (bocetos de landing, login y consola). Registro detallado
para la memoria: `docs/registro-implementacion.md`. Decision abierta sobre
escritura en Docker: `docs/propuesta-escritura-docker.md`.

## Decisiones de esta etapa (2026-11-12)

| Tema | Decision |
|---|---|
| Bocetos de `system-reference/` | Son referencia visual. Cuando chocan con lo construido, `CLAUDE.md` o `CONTEXTO.md`, manda lo construido. Ej.: el boceto usa `/health`, Tailscale y `vinculos:<version>`; vale `/api/salud`, Cloudflare Access y `vinculos-api`/`vinculos-web` |
| Acceso a la consola | Cloudflare Access delante + login propio (correo, contrasena, codigo de 6 digitos por correo). Sin red privada Tailscale/WireGuard |
| Fase 2: anti-spam del formulario publico | Limite por IP (5 por hora) + campo trampa (honeypot). Turnstile queda para despues |
| Fase 2: requisito para APROBADO | El operador registra version y fecha del contrato de encargo firmado fuera de la plataforma. La aceptacion del ADMIN dentro del silo se registra despues de aprovisionar |
| Fase 2: exposicion publica | Apps separadas: `apps/sitio` (landing, formulario fase 1, enlace fase 2; publica) y `apps/web` (solo consola, tras Cloudflare Access + login). Cada una llega a la API con su propio secreto |
| Fase 2: slug del centro | Lo fija el operador al pasar a fase 2 (propuesto desde el nombre), unico e inmutable desde APROBADO |
| Estilos (2026-11-12) | Fase 1 ofrece moderno, cuaderno, editorial, "tenemos nuestros colores" y "aun no lo se" (con aviso: se define en la primera sesion). El manifiesto solo aprueba temas que existen en el ERP: moderno y cuaderno |
| Compartir el formulario (2026-11-12) | Boton "Compartir solicitud" en la barra lateral de la consola |
| Escritura en Docker (2026-11-12) | Opcion C aprobada: ejecutor de silos en el host B, unico con el socket de Docker, con verbos cerrados (`docs/propuesta-escritura-docker.md`). Sin verbo de borrado |
| Retencion tras la salida (2026-11-12) | Se mantiene el protocolo vigente: tras la salida, Vinculos conserva los datos solo durante el periodo de gracia (30 dias) para entregar el exporte cifrado; luego S7 elimina. Sin custodia posterior. La retencion de 15 anos de las fichas es obligacion del centro, con su exporte |
| Ejecutor de silos (2026-11-12) | Primera etapa construida con verbos que no tocan datos ni llaves: `estado` y `reiniciar` (backend y frontend). `reiniciar_demo`: sin excepcion a la regla de llaves (decidido 2026-11-13); P5 manual tambien en el demo |
| Imagenes por centro vs imagen unica (2026-11-12) | Se mantiene R1 (el usuario lo confirmo: no se rompe "misma imagen para todos"): una imagen para todos, identificada por digest. El aislamiento de cada centro esta en sus contenedores (`erp-<slug>-*`), red, base, volumenes y secretos; el nombre y el tema del centro van en runtime (R9) |
| Solicitud de modulos (tarea 31 del ERP) | Nace en el silo: el ADMIN la pide en el ERP, el ERP la expone en `/api/internal/solicitudes`, el agente la recoge y la reporta al host A (modelo pull), la consola la muestra y el operador la aprueba con un job `reconfigurar`. R2 y R3 confirmados tal como estan especificados (2026-11-13) |
| Demo (2026-11-13) | Ademas de presentaciones, el demo (y los silos de prueba) quedan corriendo para ver en la consola, en tiempo real, los silos levantados y en uso. R10 = B + A. B (rutina): resembrar sin borrar nada, avanzando el tiempo con las funciones del ERP. A (presentaciones): reconstruir la BD del demo con un escenario de semilla (centro, equipo, pacientes ficticios y cuentas por publico), conservando las llaves. Nunca DELETE/TRUNCATE en una BD viva (triggers `bloquear_delete_clinico`) |
| Mismo esqueleto e identidad del silo (2026-11-13) | R11 hecho en el ERP: imagenes comunes `vinculos-api`/`vinculos-web`, nombre/tema/dominio en runtime (R9), redes propias por silo (`erp-<slug>_interna`, `_silo`, `_borde`; `proxy` solo del plano del host), labels `cl.vinculos.*`, `application_name` y tabla `identidad_silo` (migrate falla si la BD es de otro silo). Debe quedar asi en cada silo que cree la consola |

## Relacion con el roadmap del ERP (`SW Proyecto/docs/roadmap_mvp.md`)

| ERP | Tema | Aqui |
|---|---|---|
| 3 | Panel de control de accesos (sin datos de pacientes) | Fases 1 a 5: consola completa con login |
| 31 | Solicitar modulos desactivados | Fase 3 (plano de control) + requisitos R2 y R3 del ERP |

## Fase 0. Monitoreo (Hecho, primera entrega)

| Pieza | Estado | Nota |
|---|---|---|
| Compose host A (`db`, `api`, `web`) y host B (`socket-proxy`, `agente`) | Hecho | `infra/host-a`, `infra/host-b` |
| Agente: latido, descubrimiento de `erp-<slug>`, metricas de contenedor y host, p95, respaldos | Hecho | Solo lectura via `docker-socket-proxy` |
| API: `/agente/latido`, `/agente/reporte`, token por agente (`agente:crear`) | Hecho | |
| Sondeo de `/api/salud` de silos adoptados | Hecho | Cada 60 s |
| Reglas de alerta S1/S2/S3 | Hecho | `apps/api/src/alertas/reglas.ts`, con tests |
| Consola: resumen, silos (lista, detalle, adoptar/soltar), alertas | Hecho | Version basica; el login llego en la fase 1 |
| Web -> API con secreto compartido (`CONSOLA_SECRETO`) | Hecho | No reemplaza al login |

## Fase 1. Acceso y auditoria (Hecho 2026-11-12, salvo Cloudflare Access y revocar desde la consola)

| Pieza | Estado | Nota |
|---|---|---|
| Modelos `Operador`, `CodigoAcceso`, `Sesion`, `EventoAuditoria` | Hecho | Migracion `20261112183453_acceso_y_auditoria` (aditiva). Contrasena con scrypt de `node:crypto` (sin dependencias nativas) |
| CLI `operador:crear` (crea o rota: quita bloqueo y cierra sesiones) | Hecho | Contrasena aleatoria, se muestra una vez |
| Login paso 1: correo + contrasena, 5 intentos y bloqueo 15 min | Hecho | Mismo mensaje y mismo tiempo de respuesta si el correo no existe |
| Login paso 2: codigo de 6 digitos por correo, vence 10 min, un uso, 5 intentos, reenvio cada 45 s (max 3) | Hecho | Se guarda solo su HMAC. Mailpit en local (`127.0.0.1:8026`), SES por SMTP en produccion |
| Sesion: cookie httpOnly SameSite=Strict en la web, 30 min sin actividad, 12 h maximo, salir | Hecho | El token nunca llega al navegador como dato; la API guarda su sha256 |
| Proxy de la web: POST solo desde el mismo origen, IP del navegador a la auditoria | Hecho | |
| Auditoria: accesos, bloqueos, operadores, adoptar/soltar silo | Hecho | Las fases siguientes registran sus transiciones aqui |
| Vista Auditoria con filtros (Todos, Acceso, Operadores, Silos) | Hecho | |
| Tests de reglas de acceso (bloqueo, codigo, sesion, contrasenas) | Hecho | 21 tests puros en `apps/api/src/acceso/reglas.spec.ts`. Flujo completo probado a mano contra la API y el proxy |
| Revocar sesiones y rotar contrasena desde la consola | Hecho | 2026-11-13, vista Configuracion |
| Tests de integracion contra Postgres efimero | Pendiente | Conviene montarlos con la fase 4 (jobs) |
| Cloudflare Access delante de la consola | Pendiente | Configuracion de infra, no codigo |

## Fase 2. Solicitudes y manifiestos (Hecha 2026-11-12)

| Pieza | Estado | Nota |
|---|---|---|
| `packages/manifest` (`@vinculos/manifest`): schemas zod de fase 1, reglas y manifiesto completo; modulos y dependencias; RUT; hash canonico | Hecho | 15 tests (`pnpm manifest test`). Rangos de `reglas` = CHECK de `configuracion_centro` del ERP. El hash va en `@vinculos/manifest/hash` (usa `node:crypto`; el indice sirve tambien al navegador). `semilla` sin definir: se hace contra las tablas del ERP en P6 |
| Modelos `Centro` (14 estados), `TransicionCentro`, `RevisionManifiesto` | Hecho | Migracion `20261112200123_centros_y_manifiestos` (aditiva) |
| Maquina de estados del centro | Hecho | `apps/api/src/centros/estados.ts`, con tests. A mano desde la consola solo CONTACTADO, REUNION y DESCARTADO (con motivo) |
| `POST /publico/solicitudes` (fase 1): secreto del sitio, 5 por IP por hora, campo trampa, schema compartido | Hecho | Crea el centro en SOLICITUD + revision 1 (fase 1) con hash. Auditado como `centro.solicitud` |
| `apps/sitio` (puerto 3200): formulario de fase 1 con bloques de modulos (las dependencias se agregan solas), `?modulos=` precarga | Hecho | Tokens "Moderno A" del ERP y Figtree. `/` redirige a `/solicitud` hasta que exista el landing (fase 6) |
| Consola: vista Solicitudes (filtros, contador de nuevas) y detalle (fase 1, pipeline, historial, contactar, reunion, descartar) | Hecho | |
| MVP sin COBROS ni WHATSAPP en el formulario (`MODULOS_MVP`); la API los rechaza en la fase 1 | Hecho | Pedido del usuario 2026-11-12. El boceto del landing menciona cobros: quitarlo en la fase 6 |
| Enlace compartible del formulario desde la consola (precarga modulos, origen "enlace") | Hecho | `SITIO_URL` en la web |
| Slug del centro: lo fija el operador (sugerido desde el nombre), unico contra centros y silos, inmutable desde APROBADO | Hecho | |
| Enlace privado de fase 2: token sha256, 7 dias, uno vivo por centro, por correo al contacto, revocable; se revoca al aprobar | Hecho | Modelo `EnlaceFase2`, migracion `20261112210711_fase2_enlace_y_aprobacion`. 120 peticiones por IP por hora sobre tokens |
| `apps/sitio` `/manifiesto/<token>`: el centro guarda a medias y envia (REUNION -> DATOS_COMPLETOS si sus datos estan completos) | Hecho | Solo sus campos (entidad, responsables, dominio, modulos, color); `Referrer-Policy: no-referrer` y `noindex` |
| Editor del manifiesto en la consola: borrador completo (centro + version + reglas + contrato), revisiones fase 2 con hash, idempotente | Hecho | Formulario de reglas generado desde `CAMPOS_REGLAS` (defaults del ERP); reglas de cobros ocultas |
| Validacion P0 (`validarP0` del paquete): schema completo, dependencias, rangos del ERP, modulos del MVP, contrato | Hecho | La misma funcion usara el job aprovisionar |
| APROBADO: P0 ok + contrato; congela el manifiesto en una revision fase 3; guarda `hashAprobado` | Hecho | Probado de punta a punta en Docker (2026-11-12) |
| Aviso por correo al operador cuando llega una solicitud | Hecho 2026-11-13 | A cada operador activo; solo nombre del centro, tamano y modulos. Si el correo falla, la solicitud igual entra. Probado en local |

## Fase 3. Modulos por solicitud del centro (tarea 31) (Hecha 2026-11-13)

| Pieza | Estado | Nota |
|---|---|---|
| ERP: base de `/api/internal/*` (token por silo, hash en `identidad_silo`, `InternoGuard`, funciones SECURITY DEFINER, bloqueo en Traefik) | Hecho | Comun a R2-R5. Caso 176 de `seguridad_bd.sql` y e2e `solicitudes-modulo` |
| ERP: tabla `solicitudes_modulo`, `solicitar_modulo()` (ADMIN, dependencias, COBROS y WHATSAPP fuera del MVP), R2 y R3 | Hecho | R2 sin motivo ni quien la pidio |
| ERP: Configuracion > Modulos con "Solicitar" / "Solicitar desactivar", estado e historial | Hecho | `SolicitudesModulo.tsx` |
| Agente: R2 de cada silo con token -> `POST /agente/solicitudes` -> R3 | Hecho | `apps/agente/src/solicitudes.ts`; por la red de borde (o `SILO_INTERNO_URL` en desarrollo) |
| API: modelo `SolicitudModulo` (decision del operador vs estado confirmado por el silo, error de entrega) | Hecho | Migracion `20261113165019_solicitudes_modulo`; reglas puras con tests |
| Consola: bandeja en el detalle del silo (aprobar, rechazar, marcar aplicada) | Hecho | `componentes/solicitudes-modulo.tsx` |
| Aprobar crea revision del manifiesto + job `reconfigurar` | Hecho 2026-11-13 | Aprobar en la consola crea la revision nueva (fase 3) con el modulo cambiado y encola RECONFIGURAR; al terminar OK la solicitud pasa a APLICADA sola. La entrega al silo va de a un paso (APROBADA y despues APLICADA). Sin centro aprobado en la consola para ese silo, queda el camino manual. Probado en local de punta a punta en los dos sentidos |

## Fase 4. Cola de jobs y agente ejecutor (base Hecha 2026-11-12; jobs que escriben, Bloqueados)

| Pieza | Estado | Nota |
|---|---|---|
| Cola en Postgres: `Job` y `PasoJob` (pasos idempotentes, registrados, log corto sin secretos) | Hecho | Migracion `20261112215609_cola_de_jobs` |
| Reclamo con `FOR UPDATE SKIP LOCKED` y reserva de 2 min renovada en cada reporte; si vence, otro reclamo retoma desde el paso pendiente | Hecho | `POST /agente/jobs/reclamar`, `POST /agente/jobs/:id/pasos/:codigo` |
| P0 en el plano de control al crear el job (si falla, el job no parte) | Hecho | Schema v1, dependencias, modulos del MVP y hash de la revision aprobada |
| Agente: lista cerrada de pasos (un codigo desconocido se reporta FALLIDO sin ejecutar), un job a la vez, se detiene con 409 (cancelado) | Hecho | `apps/agente/src/jobs.ts` (agente 0.3.0 desde 2026-11-13) |
| Job VERIFICAR (solo lectura): integridad del manifiesto, red proxy, nombre libre, imagen (omitido por R1) y capacidad del host | Hecho | El proxy sigue en solo lectura: se agrego `NETWORKS: 1` con `POST: 0` |
| Consola: vista Aprovisionamiento (lista con pasos) y job (pasos + log, reintentar desde el paso fallido, cancelar); boton "Verificar en el host B" en el manifiesto aprobado | Hecho | Probado con el agente real (2026-11-12): reintento solo repite el paso fallido; cancelar un pendiente |
| Tests: reglas de la cola (API) y ejecutor del agente (hash compartido, lista cerrada, 409, no repetir pasos OK) | Hecho | Sin tests de integracion contra Postgres efimero todavia |
| Ejecutor de silos (`apps/ejecutor`, opcion C): unico con el socket de Docker, verbos cerrados, red interna con el agente, token propio, sin puertos, filesystem de solo lectura, auditoria local en JSON | Hecho | Verbos `estado` y `reiniciar` (2026-11-12) y de red de borde (fila de abajo). Sin verbo de borrado. Respeta la ventana de respaldo (01:45 a 02:30 Chile) |
| Job REINICIAR_SILO: P0 en el plano de control (silo reportado, sin job activo, fuera de la ventana de respaldo) + E1 estado, E2 reiniciar backend y frontend, E3 en marcha; boton "Reiniciar" en Silos | Hecho | Migracion `20261113013203_job_reiniciar_silo`. Probado con un stack de prueba (db no se reinicio) |
| Jobs `RESEMBRAR_DEMO` (B) y `RECONSTRUIR_DEMO` (A, con escenario) | Bloqueado (ERP) | Decidido 2026-11-13: B + A (`docs/requisitos-erp.md`, R10). Requiere R10. Precauciones: doble marca de demo (`identidad_silo.es_demo` + `EJECUTOR_DEMOS` del host B), fuera de la ventana de respaldo, uno por hora, auditoria doble, salud y conteos; A ademas confirma escribiendo el slug y es la unica excepcion acotada a "sin verbo de borrado" (solo el volumen de BD de un demo) |
| Job `aprovisionar` P0 a P10, ESPERANDO_LLAVES en P5 | Bloqueado (ERP) | R1 (falta registro + digest; R9, R11, R4 y R5 ya hechos); el ejecutor necesita los verbos `preparar`, `levantar` y `conectar_borde` (sin build: imagenes por digest) |
| Ejecutor: `conectar_borde`, `soltar_borde` y `reconectar_bordes` (Traefik y agente en `erp-<slug>_borde`) | Hecho 2026-11-13 | R11. Solo redes con labels de borde del silo; lista fija `EJECUTOR_UNIR_BORDE`; 11 tests y prueba local contra una red real. Falta llamarlos desde los jobs `aprovisionar`/salida (bloqueados) |
| Agente: silos agrupados por label `cl.vinculos.silo` (coherente con el proyecto de compose) | Hecho 2026-11-13 | Version 0.3.0 |
| Job VERIFICAR: comprobar Traefik en la red de borde de cada silo | Hecho 2026-11-13 | V2: red `proxy` + Traefik (`TRAEFIK_CONTENEDOR`) en cada red con label `cl.vinculos.red=borde` |
| `infra/templates/silo.compose.tpl` (P3) | Hecho 2026-11-13 | Generada por `infra/templates/generar.py` desde el compose del ERP: sin `build`, imagenes `${REGISTRO}/vinculos-*@${*_DIGEST}`. Validada con `docker compose config` |
| Job `RECONFIGURAR` (P0 manifiesto + silo, C1 aplicar, C2 confirmar) | Hecho 2026-11-13 | R4. Agente por `/api/internal/config` con el token del silo; no usa el ejecutor |

Hallazgo de la prueba: en el PC de pruebas el disco esta al 84 %, asi que V5 falla (umbral 80 %, el mismo de la alerta S2). Es correcto: hay que liberar disco antes de aprovisionar otro silo.

## Fase 5. Resto de la consola (Pendiente)

| Pieza | Estado | Nota |
|---|---|---|
| Estilos: 5 preferencias en el formulario; temas del ERP (moderno, cuaderno) seleccionables en el manifiesto; preferencia del centro visible | Hecho | 2026-11-12 |
| Compartir solicitud desde la barra lateral (enlace con modulos precargados) | Hecho | `GET /api/sitio` de la web entrega `SITIO_URL` |
| Consola alineada al boceto: navegacion agrupada (Operacion, Versiones, Salud, Ciclo de vida, Ajustes; lo que falta aparece apagado), Solicitudes en maestro-detalle, Manifiesto en dos columnas (formulario compacto; YAML y P0 en vivo al lado), vista Silos | Hecho | 2026-11-12, pedido del usuario: menos scroll, seguir el boceto salvo choque con reglas |
| Resumen: KPIs (silos, alertas, solicitudes nuevas, jobs activos, incidentes abiertos, host) y eventos recientes | Hecho | 2026-11-13 |
| Silo detalle: centro y manifiesto aprobado, jobs recientes, acciones (reiniciar contenedores, abrir incidente) | Hecho | 2026-11-13. Faltan version/digest (R1), suspender e iniciar salida (salidas) |
| Releases y canales: registro, promover, cascada (`actualizar`) | Pendiente | Seccion 7. Bloqueado por R1 |
| Salidas: S3 a S7, gracia 30 dias, actas, `eliminar` | Pendiente | Seccion 8 |
| Incidentes S1/S2/S3: hitos (contencion, aviso al centro, actualizaciones, informe final, cierre) con plazos en horas y dias habiles, semaforo, bitacora; abrir desde una alerta del monitoreo o desde el silo | Hecho | 2026-11-13. Migracion `20261113035502_incidentes_y_soporte`. Dias habiles sin feriados (pendiente) |
| Soporte: ticket con la autorizacion del ADMIN (alcance, 1 a 72 h), vencimiento y resultado sin datos del centro | Hecho | La autorizacion la declara el operador. La base de `/api/internal/*` ya existe (2026-11-13); verificarla contra el silo necesita un endpoint nuevo en el ERP (por especificar) |
| Configuracion: plazos, seguridad, correo (con prueba), sesiones abiertas (revocar), operadores, cambio de la propia contrasena | Hecho | 2026-11-13. Cierra el pendiente de la fase 1 (revocar y rotar desde la consola) |
| Demo: resembrar (B) y reconstruir con escenario (A) | Bloqueado (ERP) | R10; ver fase 4 (jobs `RESEMBRAR_DEMO` y `RECONSTRUIR_DEMO`) |

## Fase 6. Landing (Pendiente)

| Pieza | Estado | Nota |
|---|---|---|
| Landing SSG por bloques con dependencias como conexiones | Pendiente | Seccion 9. Tokens `data-tema`, estilo "Moderno A" |
| Por modulo: problema, flujo, captura del Centro de Prueba, quien lo usa | Pendiente | |
| Formulario de fase 1 precargado con los bloques elegidos | Pendiente | Depende de fase 2 |

## Fase 7. Pruebas de capacidad (Pendiente)

| Pieza | Estado | Nota |
|---|---|---|
| `pruebas/k6/` y corridas registradas por version | Pendiente | Seccion 13 |
| Capacidad real del host B (boceto: 6 a 10 silos) | Pendiente | |

## Requisitos del ERP que bloquean

| ID | Requisito | Bloquea |
|---|---|---|
| R1 | Imagenes unicas por digest: falta CI que publique en el registro del host B y compose sin `build` (nombres comunes y runtime ya hechos con R9/R11) | Aprovisionar, releases |
| R2 | Hecho 2026-11-13: `GET /api/internal/solicitudes` | - |
| R3 | Hecho 2026-11-13: `POST /api/internal/solicitudes/:id/respuesta` | - |
| R4 | Hecho 2026-11-13: `POST/GET /api/internal/config` (modulos y reglas; tema y marca aun no) | - |
| R5 | Hecho 2026-11-13: `POST /api/internal/admin-inicial` (lo usara P9 de `aprovisionar`) | - |
| R6 | Notas de version en el panel del ADMIN | Releases |
| R7 | Agregados periodicos para la consola (hoy `soporte_resumen()` exige autorizacion) | Resumen, soporte |
| R8 | Implementar el tema "editorial" (ya disenado en el boceto del landing) en `frontend/src/app/temas/` | Aprobar centros que lo eligieron |
| R10 | Demo B + A: `demo:resembrar` sin borrar (B) y `reconstruir.sh` con escenarios de semilla conservando llaves (A); marca `identidad_silo.es_demo` (spec en `docs/requisitos-erp.md`) | Jobs del demo |
| R9 | Hecho 2026-11-13 (con R11): nombre, tema y dominio del centro en runtime | - |
| R11 | Hecho 2026-11-13: mismo esqueleto e identidad del silo (redes, labels, `identidad_silo`, bloqueo de `/api/internal` en Traefik) | - |

## Bocetos de `system-reference/` contra lo construido

| Boceto | Vista | Estado |
|---|---|---|
| Login | Red privada | No aplica (Cloudflare Access) |
| Login | Credenciales, codigo, sesion iniciada | Hecho (`/ingreso`) |
| Panel de acceso | Resumen | Parcial |
| Panel de acceso | Solicitudes | Hecho (fase 2a) |
| Panel de acceso | Manifiestos | Hecho (dentro del detalle de cada solicitud) |
| Panel de acceso | Aprovisionamiento | Hecho (job VERIFICAR; sin botones de simular) |
| Panel de acceso | Silos, Silo detalle | Parcial |
| Panel de acceso | Configuracion | Hecho |
| Panel de acceso | Releases, Salidas | Pendiente (fase 5; releases depende de R1) |
| Panel de acceso | Monitoreo | Hecho (version basica) |
| Panel de acceso | Auditoria | Hecho |
| Landing | Todo | Pendiente (fase 6) |

## Diferencias encontradas con el ERP

- Temas: el ERP tiene "Moderno A" y "Cuaderno"; los docs decian solo Moderno (corregido 2026-11-12). "editorial" esta disenado (boceto del landing) pero no implementado en el ERP: requisito R8.
- `CLAUDE.md` dice que el default de `modulos_activos` es "todos menos WHATSAPP"; en el ERP hoy (MVP 2026-11-11) COBROS tambien viene apagado. El plano de control no asume defaults: el manifiesto lista los modulos explicitamente.

## Estado al 2026-11-13: que sigue y que lo bloquea

Hecho y probado en local (2026-11-13, `docs/entorno-local.md` seccion 7 y
`docs/registro-implementacion.md` seccion 11): tarea 31 de punta a punta,
R9, R11, base de `/api/internal/*`, verbos de red de borde del ejecutor.

**Sin commit:** todo lo de 2026-11-12 y 2026-11-13 esta solo en la carpeta de
trabajo de los dos repos (el plano de control tiene un unico commit inicial).
Es lo primero antes de clonar en otro PC.

Se puede avanzar sin decisiones nuevas (hay especificacion):

| Pieza | Repo | Toca schema, jobs o seguridad (plan corto y confirmacion, `CLAUDE.md`) |
|---|---|---|
| R10 demo: B `demo:resembrar` y A `reconstruir.sh` con escenarios, verbos y jobs | ERP + control | Si |
| Tests de integracion de la API de control contra Postgres efimero | Control | No |
| Fase 6 landing (boceto en `system-reference/Landing`; sin COBROS) | Control | No |
| Fase 5 salidas S3 a S7 (exporte `.vxp`, gracia, actas, `eliminar`) | ERP + control | Si (borrado: verbo nuevo del ejecutor, hoy prohibido) |

Necesita una decision o algo externo:

| Pieza | Que falta |
|---|---|
| R1 imagenes por digest, releases y canales, job `aprovisionar` completo | En curso: R9/R11 hechos (imagenes comunes, configuracion en runtime) y plantilla por digest lista. Falta el registro del host B (`registry:2` o Zot, CONTEXTO seccion 12) y el CI (Bitbucket) que publique tag + digest |
| Probar R11 en el servidor de pruebas | Decidido (usuario, 2026-11-13): al terminar el MVP, cuando se empiecen a levantar silos reales |
| Cloudflare Access delante de la consola | Configuracion en el panel de Cloudflare (no es un contenedor): pasos en `docs/plan-dominios-dns.md`, seccion 3 |
| R7 agregados periodicos para la consola | Acordarlo en el DPA (CONTEXTO seccion 12) |
| R8 tema "editorial" | Existe solo en las muestras del boceto; faltan los CSS completos del tema en el ERP (los genera el usuario) |
| Dominios (Vinculos y propio del centro, `.cl` en NIC Chile) | Plan en `docs/plan-dominios-dns.md`: subdominio `<slug>.vinculos.cl` siempre; dominio propio del centro con Cloudflare for SaaS. Faltan 3 decisiones (seccion 4 del plan) |
| Salida de un centro (S3 a S7) | Decidido (usuario, 2026-11-13): borrado por plazos, nunca automatico: cerrar accesos, entregar los datos de los pacientes y toda la informacion del centro, mantenerlos durante el plazo y solo despues el borrado definitivo con acta. Requiere su propio plan (y la excepcion acotada al "sin verbo de borrado") antes de codificar |

## Siguiente paso

0. Commit de lo hecho en los dos repos (ver "Sin commit" arriba).
1. Hecho 2026-11-13: tarea 31 probada en local. Pendiente: R11 en el servidor de pruebas (`servidor.sh levantar`: redes de borde, Traefik unido, 403 en `/api/internal`) y derivar `infra/templates/silo.compose.tpl` del compose nuevo.
2. R10 en el ERP: B (`demo:resembrar`) y A (escenarios + `reconstruir.sh`), luego los verbos y jobs del demo.
3. Hecho 2026-11-13: R5 y R4 (`/api/internal/config`, ya con la base interna hecha): habilita `reconfigurar` y aplicar las solicitudes aprobadas.
4. R1 (registro + digest): habilita `preparar`, `levantar` y el job `aprovisionar`.
5. Fase 6: landing en `apps/sitio` (hoy la raiz redirige a `/solicitud`, que se mantiene para compartir).
