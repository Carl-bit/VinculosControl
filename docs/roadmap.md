# Roadmap de vinculos-control (actualizado 2026-11-12)

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
| Solicitud de modulos (tarea 31 del ERP) | Nace en el silo: el ADMIN la pide en el ERP, el ERP la expone en `/api/internal/solicitudes`, el agente la recoge y la reporta al host A (modelo pull), la consola la muestra y el operador la aprueba con un job `reconfigurar` |

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
| Consola: resumen, silos (lista, detalle, adoptar/soltar), alertas | Hecho | Version basica, sin login |
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
| Aviso por correo al operador cuando llega una solicitud | Pendiente | Hoy solo el contador en la consola |

## Fase 3. Modulos por solicitud del centro (tarea 31) (Pendiente)

| Pieza | Estado | Nota |
|---|---|---|
| Agente: leer `/api/internal/solicitudes` de cada silo y reportarlas | Bloqueado (ERP) | Requisito R2 |
| API: modelo `SolicitudModulo` (silo, modulo, accion, pedido por rol, fecha, estado) | Pendiente | Sin datos personales: rol, no nombre |
| Consola: bandeja de solicitudes por silo, validar dependencias, aprobar o rechazar | Pendiente | No quitar un modulo del que dependa otro activo |
| Aprobar crea revision del manifiesto + job `reconfigurar` | Pendiente | Depende de fase 4 |
| Respuesta al silo (estado de la solicitud visible para el ADMIN) | Bloqueado (ERP) | Requisito R3 |

## Fase 4. Cola de jobs y agente ejecutor (base Hecha 2026-11-12; jobs que escriben, Bloqueados)

| Pieza | Estado | Nota |
|---|---|---|
| Cola en Postgres: `Job` y `PasoJob` (pasos idempotentes, registrados, log corto sin secretos) | Hecho | Migracion `20261112215609_cola_de_jobs` |
| Reclamo con `FOR UPDATE SKIP LOCKED` y reserva de 2 min renovada en cada reporte; si vence, otro reclamo retoma desde el paso pendiente | Hecho | `POST /agente/jobs/reclamar`, `POST /agente/jobs/:id/pasos/:codigo` |
| P0 en el plano de control al crear el job (si falla, el job no parte) | Hecho | Schema v1, dependencias, modulos del MVP y hash de la revision aprobada |
| Agente: lista cerrada de pasos (un codigo desconocido se reporta FALLIDO sin ejecutar), un job a la vez, se detiene con 409 (cancelado) | Hecho | `apps/agente/src/jobs.ts`, version 0.2.0 |
| Job VERIFICAR (solo lectura): integridad del manifiesto, red proxy, nombre libre, imagen (omitido por R1) y capacidad del host | Hecho | El proxy sigue en solo lectura: se agrego `NETWORKS: 1` con `POST: 0` |
| Consola: vista Aprovisionamiento (lista con pasos) y job (pasos + log, reintentar desde el paso fallido, cancelar); boton "Verificar en el host B" en el manifiesto aprobado | Hecho | Probado con el agente real (2026-11-12): reintento solo repite el paso fallido; cancelar un pendiente |
| Tests: reglas de la cola (API) y ejecutor del agente (hash compartido, lista cerrada, 409, no repetir pasos OK) | Hecho | Sin tests de integracion contra Postgres efimero todavia |
| Ejecutor de silos (`apps/ejecutor`, opcion C): unico con el socket de Docker, verbos cerrados `estado` y `reiniciar`, red interna con el agente, token propio, sin puertos, filesystem de solo lectura, auditoria local en JSON | Hecho | 5 tests. Sin verbo de borrado. Respeta la ventana de respaldo (01:45 a 02:30 Chile) |
| Job REINICIAR_SILO: P0 en el plano de control (silo reportado, sin job activo, fuera de la ventana de respaldo) + E1 estado, E2 reiniciar backend y frontend, E3 en marcha; boton "Reiniciar" en Silos | Hecho | Migracion `20261113013203_job_reiniciar_silo`. Probado con un stack de prueba (db no se reinicio) |
| Job `reiniciar_demo` | Bloqueado (ERP) | Decidido 2026-11-13, enfoque B: resembrar los datos ficticios conservando llaves (sin borrar volumenes, sin P5 en cada reinicio). Requiere R10. Precauciones: doble marca de demo (BD + `EJECUTOR_DEMOS` del host B), fuera de la ventana de respaldo, confirmacion escribiendo el slug, uno por hora, auditoria doble, comprobar salud y conteos |
| Job `aprovisionar` P0 a P10, ESPERANDO_LLAVES en P5 | Bloqueado (ERP) | R1, R4, R5; el ejecutor necesita los verbos `preparar` y `levantar` (sin build: imagenes por digest) |
| Job `reconfigurar` | Bloqueado (ERP) | R4 |

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
| Soporte: ticket con la autorizacion del ADMIN (alcance, 1 a 72 h), vencimiento y resultado sin datos del centro | Hecho | La autorizacion la declara el operador: verificarla contra el silo requiere `/api/internal/*` |
| Configuracion: plazos, seguridad, correo (con prueba), sesiones abiertas (revocar), operadores, cambio de la propia contrasena | Hecho | 2026-11-13. Cierra el pendiente de la fase 1 (revocar y rotar desde la consola) |
| `reiniciar_demo` | Pendiente | |

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
| R1 | Imagenes unicas (`vinculos-api`, `vinculos-web`) con nombre del centro en runtime, no build arg | Aprovisionar, releases |
| R2 | `/api/internal/solicitudes`: solicitudes de modulo del ADMIN (modulo, accion, rol, fecha), token por silo | Tarea 31 |
| R3 | `/api/internal/solicitudes/:id` para devolver el estado (aprobada, rechazada, aplicada) | Tarea 31 |
| R4 | `/api/internal/config` con funciones SECURITY DEFINER para `modulos_activos` y reglas | Reconfigurar, aprovisionar |
| R5 | `/api/internal/admin-inicial` (invitacion del ADMIN) | Aprovisionar P9 |
| R6 | Notas de version en el panel del ADMIN | Releases 
| R7 | Agregados periodicos para la consola (hoy `soporte_resumen()` exige autorizacion) | Resumen, soporte |
| R8 | Implementar el tema "editorial" (ya disenado en el boceto del landing) en `frontend/src/app/temas/` | Aprobar centros que lo eligieron |
| R10 | `demo:resembrar`: vaciar los datos ficticios del demo y volver a sembrar, conservando llaves y configuracion; marca `es_demo` en la BD (spec en `docs/requisitos-erp.md`) | `reiniciar_demo` |
| R9 | Tema y nombre del centro en runtime (hoy build args `NEXT_PUBLIC_TEMA`, `NEXT_PUBLIC_CENTRO_NOMBRE`): parte de R1 | Imagen unica |

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

## Siguiente paso

1. Implementar en el ERP R10 (demo), R2/R3 (tarea 31) y R1/R9 segun `docs/requisitos-erp.md`, previa confirmacion.
2. R1 en el ERP (imagen unica por digest + nombre y tema en runtime, R9): habilita los verbos `preparar` y `levantar` del ejecutor y el job `aprovisionar`.
3. Tarea 31 de punta a punta: R2 y R3 en el ERP y la bandeja por silo en la consola.

-----
Siguiente

  Las dos piezas sin bloqueos que siguen por esfuerzo:
  - R10 (demo), con plan corto antes de codificar.
  - Tests de integración de la API de control.