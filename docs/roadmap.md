# Roadmap de vinculos-control (actualizado 2026-11-15)

Memoria de avance del plano de control: que esta hecho, que falta y que
depende del ERP. Se actualiza al cerrar cada pieza (estado + fecha + nota).

Estados: **Hecho**, **Parcial**, **Pendiente**, **Bloqueado (ERP)** (necesita
algo que el ERP aun no tiene; se anota como requisito, no se simula aqui).

Especificacion de lo que falta en el ERP: `docs/requisitos-erp.md`.

Fuentes: `CONTEXTO.md` (diseno), `ERP_REGLAS_Y_DESPLIEGUE.md` (estado del ERP),
`system-reference/` (bocetos de landing, login y consola). Registro detallado
para la memoria: `docs/registro-implementacion.md`. Decision abierta sobre
escritura en Docker: `docs/propuesta-escritura-docker.md`.

## Revisiones pendientes al retomar (anotadas 2026-11-14; 1 a 5 hechas 2026-11-15)

Lo construido el 2026-11-14 que paso los tests pero falta comprobar en el
entorno real, en este orden:

1. **Reconstruir y migrar.** Hecho 2026-11-15: host A (`api`, `web`) aplico
   `20261114210000_salidas_reversion_y_ejecutor` (la de salidas ya estaba);
   host B (`agente`, `ejecutor`) con `bajas/` creada.
2. **Verbos del ejecutor contra Docker real.** Hecho 2026-11-15 con un silo
   desechable `erp-desechable` (misma forma que el compose del ERP: db
   postgres con healthcheck, backend y frontend de relleno, tres redes,
   `db_data` y `exportaciones`) y un contenedor de relleno con el nombre de
   Traefik (en el PC no corre Traefik). Cada verbo dos veces:
   - `detener`: borde soltado, frontend/backend/db en `exited`, volumenes
     intactos; la segunda vez informa "ya estaba detenido".
   - `reanudar`: db `healthy` 6 s antes de backend y frontend; borde unido;
     idempotente. `/api/salud` no se probo (backend de relleno, sin ERP).
   - `eliminar`: sin `bajas/<slug>` 403, otro hash 403, en marcha 409, cuerpo
     malo 400, otro slug 403. Con todo en regla borro 3 contenedores,
     `db_data`, `exportaciones`, las tres redes (el filtro por label de
     compose las trae) y `respaldos/desechable/`; `centro-prueba`, sus
     volumenes y el plano del host siguieron. La segunda vez: inventario vacio
     sin error. Auditoria local en `verbos.jsonl` con el inventario.
   - **BUG encontrado y corregido:** `index.ts` soltaba el borde antes de
     revisar las precondiciones, asi que un `eliminar` rechazado (403/409)
     dejaba a un silo en marcha sin Traefik ni agente. Ahora `eliminar` recibe
     `soltarBorde` y lo corre solo tras pasar todas las precondiciones. Test
     nuevo en `ciclo.test.ts` (23 del ejecutor). Repetido contra Docker real:
     tras los rechazos el borde queda intacto.
   - Reintento tras un exito perdido: hecho 2026-11-15. Si `eliminar` no
     encuentra nada que borrar, el ejecutor busca en `verbos.jsonl` el ultimo
     `eliminar` OK de ese slug que si borro y agrega al log "eliminacion previa
     (<fecha>): ..." (y `inventarioPrevio`), que llega al acta S7. 24 tests del
     ejecutor; probado contra el ejecutor real.
3. **Salida de punta a punta en la consola.** Hecho 2026-11-15 con el centro
   de prueba "Centro Desechable" (insertado en ACTIVO en la BD `control`, sin
   aprovisionar por R1) y el silo `erp-desechable`, con un operador de
   pruebas (2FA por Mailpit). Los pasos van por los mismos endpoints que usa
   la consola (el selector de fecha no se pudo manejar sin capturas) y cada
   vista se reviso como texto:
   - Salida #1: S1 -> acta de recepcion (repetida: idempotente) -> Detener
     silo (job #4 DETENER_SILO OK, GRACIA) -> reversion desde GRACIA (job #5
     REANUDAR_SILO OK: db sana antes de backend/frontend, borde unido, centro
     ACTIVO, silo adoptado de nuevo, acta de reversion con hash y correo).
   - Salida #2: S1 -> reversion desde EN_SALIDA en el acto (ACTIVO, acta).
   - Salida #3: S1 -> acta -> Detener (job #6) -> Eliminar silo sin
     confirmacion 422 y con gracia vigente 422 -> confirmacion -> gracia
     adelantada en la BD (solo esta prueba) -> ELIMINAR sin `bajas/` (job #7
     FALLIDO en X2, borde intacto) -> `bajas/desechable` con el hash del acta
     -> reintento desde X2 (OK, solo se borro `erp-desechable`) -> acta S7
     (detenido, volumenes y respaldos del host marcados `job:7`, evidencia de
     7 lineas; repetida: mismo hash) -> correo del acta de eliminacion al
     contacto en Mailpit. La lista de Salidas muestra la eliminada y las dos
     revertidas como historial.
   - Observado: `eliminacionJobId` se guarda solo cuando ELIMINAR termina OK.
     Con el job #7 FALLIDO en X2 (sin borrar nada) la reversion queda
     bloqueada ("ya empezo a borrar"): conservador, se deja asi.
   - Limpieza: centro 2, sus jobs, metricas, alertas y la fila `desechable` de
     `silos` borrados; operador de pruebas desactivado y sin sesiones; la
     auditoria se conserva. Contenedor de relleno de Traefik y
     `bajas/desechable` borrados.
4. **Monitoreo durante la gracia.** Hecho 2026-11-15: al detener, la S3 abierta
   del silo se cerro en la siguiente revision (30 s) y no se abrieron alertas
   con los contenedores detenidos; al revertir el silo vuelve a adoptarse.
   **Hallazgo del ERP (R14):** `respaldar.sh` con la db detenida no falla:
   `openssl` cifra la entrada vacia, deja 32 bytes que pasan `[ -s ]`, se
   suben al destino y la rotacion de 7 dias borra los respaldos reales del
   host. Requisito en `docs/requisitos-erp.md`. En el control: alerta S2
   `respaldo_vacio:<slug>` si el ultimo respaldo pesa menos de 1 KiB (test en
   `alertas/reglas.spec.ts`).
5. **Vistas con datos reales.** Hecho 2026-11-15: 12 vistas (Salidas con la
   eliminada y una revertida, Silos, Silo, Jobs, Job, Resumen, Monitoreo,
   Auditoria, Incidentes, Configuracion, Solicitudes) medidas a 1280, 1536 y
   1920 px. Corregido: Auditoria desbordaba 12 px a 1280 por correos, IPs y
   hashes sin espacios (clase `.partir` con `overflow-wrap: anywhere`), y el
   tamano del exporte decia "0.0 GiB" para 2 MiB (nuevo `tamano()` en
   `lib/api.ts`, tambien en el respaldo del silo).
6. **ERP sin cobros:** hecho 2026-11-16. Los e2e de pedir hora siguen el flujo
   sin pago y el ERP ya no tiene nada de cobros (ver "MVP sin pagos ni
   finanzas" abajo).

## Decisiones de esta etapa (2026-11-12)

| Tema | Decision |
|---|---|
| Bocetos de `system-reference/` | Son referencia visual. Cuando chocan con lo construido, `CLAUDE.md` o `CONTEXTO.md`, manda lo construido. Ej.: el boceto usa `/health`, Tailscale y `vinculos:<version>`; vale `/api/salud`, Cloudflare Access y `vinculos-api`/`vinculos-web` |
| Acceso a la consola | Cloudflare Access delante + login propio (correo, contrasena, codigo de 6 digitos por correo). Sin red privada Tailscale/WireGuard |
| Fase 2: anti-spam del formulario publico | Limite por IP (5 por hora) + campo trampa (honeypot). Turnstile queda para despues |
| Fase 2: requisito para APROBADO | El operador registra version y fecha del contrato de encargo firmado fuera de la plataforma. La aceptacion del ADMIN dentro del silo se registra despues de aprovisionar |
| Fase 2: exposicion publica | Apps separadas: `apps/sitio` (landing, formulario fase 1, enlace fase 2; publica) y `apps/web` (solo consola, tras Cloudflare Access + login). Cada una llega a la API con su propio secreto | Desde 2026-11-15 hay un solo sitio publico, `apps/landing`, con la landing, el formulario compartido y el enlace de fase 2 (`apps/sitio` se junto con ella): ver Fase 6
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
| Tests de integracion contra Postgres efimero | Hecho | 2026-11-14. Ver "Tests de integracion de la API" |
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
| MVP sin WHATSAPP en el formulario (`MODULOS_MVP`); la API lo rechaza en la fase 1 | Hecho | Pedido del usuario 2026-11-12. COBROS ya no existe (2026-11-16) |
| Enlace compartible del formulario desde la consola (precarga modulos, origen "enlace") | Hecho | `SITIO_URL` en la web |
| Slug del centro: lo fija el operador (sugerido desde el nombre), unico contra centros y silos, inmutable desde APROBADO | Hecho | |
| Enlace privado de fase 2: token sha256, 7 dias, uno vivo por centro, por correo al contacto, revocable; se revoca al aprobar | Hecho | Modelo `EnlaceFase2`, migracion `20261112210711_fase2_enlace_y_aprobacion`. 120 peticiones por IP por hora sobre tokens |
| `apps/sitio` `/manifiesto/<token>`: el centro guarda a medias y envia (REUNION -> DATOS_COMPLETOS si sus datos estan completos) | Hecho | Solo sus campos (entidad, responsables, dominio, modulos, color); `Referrer-Policy: no-referrer` y `noindex` |
| Editor del manifiesto en la consola: borrador completo (centro + version + reglas + contrato), revisiones fase 2 con hash, idempotente | Hecho | Formulario de reglas generado desde `CAMPOS_REGLAS` (defaults del ERP); reglas de cobros ocultas |
| Validacion P0 (`validarP0` del paquete): schema completo, dependencias, rangos del ERP, modulos del MVP, contrato | Hecho | La misma funcion usara el job aprovisionar |
| APROBADO: P0 ok + contrato; congela el manifiesto en una revision fase 3; guarda `hashAprobado` | Hecho | Probado de punta a punta en Docker (2026-11-12) |
| Aviso por correo al operador cuando llega una solicitud | Hecho | `avisarOperadores` en `centros.service.ts`: correo a cada operador activo con nombre, tamano y modulos; si falla, la solicitud queda igual. Verificado 2026-11-14 en `centros.int-spec.ts` |

## Fase 3. Modulos por solicitud del centro (tarea 31) (Hecho 2026-11-14)

| Pieza | Estado | Nota |
|---|---|---|
| Agente: leer `/api/internal/solicitudes` de cada silo y reportarlas | Hecho | R2 del ERP |
| API: modelo `SolicitudModulo` (silo, modulo, accion, pedido por rol, fecha, estado) | Hecho | Sin datos personales: rol, no nombre |
| Consola: bandeja de solicitudes por silo, aprobar o rechazar en un modal (sin `window.prompt`) | Hecho | 2026-11-14. Cada solicitud dice si es automatica (centro con manifiesto aprobado) o manual |
| Aprobar crea revision del manifiesto + job `reconfigurar` | Hecho | Probado 2026-11-14: desactivar MATCH en `centro-prueba` (rev 2, job #3 OK, APLICADA en los dos lados, Match fuera del lateral y de la pagina publica) |
| "Aplicar con RECONFIGURAR" para aprobaciones que quedaron sin job | Hecho | 2026-11-14. `POST /consola/solicitudes-modulo/:slug/:id/aplicar`; no repite la revision si ya tiene el cambio. Con centro aprobado, "marcar aplicada" a mano se rechaza (409) |
| Si el silo rechaza APLICADA con 4xx, la solicitud vuelve a APROBADA con el motivo | Hecho | 2026-11-14. Antes se reintentaba cada minuto para siempre. Red o 5xx se siguen reintentando |
| Respuesta al silo (estado visible para el ADMIN) | Hecho | R3. En el ERP: "Desactivacion solicitada / en proceso" en amarillo (tono `pendiente`), luego "Desactivado" y se puede volver a pedir |
| ERP: paginas de un modulo apagado abiertas por URL directa (`/admin/match`, agenda, fichas) muestran la vista vacia en vez de "modulo no contratado" | Hecho | 2026-11-16 (ERP `cfe82ac`): panel y portal avisan "Esta seccion no esta activa en tu centro" |

## Fase 4. Cola de jobs y agente ejecutor (base Hecha 2026-11-12; jobs que escriben, Bloqueados)

| Pieza | Estado | Nota |
|---|---|---|
| Cola en Postgres: `Job` y `PasoJob` (pasos idempotentes, registrados, log corto sin secretos) | Hecho | Migracion `20261112215609_cola_de_jobs` |
| Reclamo con `FOR UPDATE SKIP LOCKED` y reserva de 2 min renovada en cada reporte; si vence, otro reclamo retoma desde el paso pendiente | Hecho | `POST /agente/jobs/reclamar`, `POST /agente/jobs/:id/pasos/:codigo` |
| P0 en el plano de control al crear el job (si falla, el job no parte) | Hecho | Schema v1, dependencias, modulos del MVP y hash de la revision aprobada |
| Agente: lista cerrada de pasos (un codigo desconocido se reporta FALLIDO sin ejecutar), un job a la vez, se detiene con 409 (cancelado) | Hecho | `apps/agente/src/jobs.ts`, version 0.2.0 |
| Job VERIFICAR (solo lectura): integridad del manifiesto, red proxy, nombre libre, imagen (omitido por R1) y capacidad del host | Hecho | El proxy sigue en solo lectura: se agrego `NETWORKS: 1` con `POST: 0` |
| Consola: vista Aprovisionamiento (lista con pasos) y job (pasos + log, reintentar desde el paso fallido, cancelar); boton "Verificar en el host B" en el manifiesto aprobado | Hecho | Probado con el agente real (2026-11-12): reintento solo repite el paso fallido; cancelar un pendiente |
| Tests: reglas de la cola (API) y ejecutor del agente (hash compartido, lista cerrada, 409, no repetir pasos OK) | Hecho | Integracion contra Postgres efimero: hecha 2026-11-14 (seccion propia) |
| Ejecutor de silos (`apps/ejecutor`, opcion C): unico con el socket de Docker, verbos cerrados `estado` y `reiniciar`, red interna con el agente, token propio, sin puertos, filesystem de solo lectura, auditoria local en JSON | Hecho | 5 tests. Sin verbo de borrado. Respeta la ventana de respaldo (01:45 a 02:30 Chile) |
| Job REINICIAR_SILO: P0 en el plano de control (silo reportado, sin job activo, fuera de la ventana de respaldo) + E1 estado, E2 reiniciar backend y frontend, E3 en marcha; boton "Reiniciar" en Silos | Hecho | Migracion `20261113013203_job_reiniciar_silo`. Probado con un stack de prueba (db no se reinicio) |
| Job `reiniciar_demo` | En curso | 2026-11-16: R10 B hecho en el ERP (`demo_resembrar.js`, marca `es_demo`, `servidor.sh resembrar`). Falta el lado del control: demos aprovisionados y gestionados desde la consola (ver "Demos desde el control"). Antes: Decidido 2026-11-13, enfoque B: resembrar los datos ficticios conservando llaves (sin borrar volumenes, sin P5 en cada reinicio). Requiere R10. Precauciones: doble marca de demo (BD + `EJECUTOR_DEMOS` del host B), fuera de la ventana de respaldo, confirmacion escribiendo el slug, uno por hora, auditoria doble, comprobar salud y conteos |
| Ejecutor: verbos `preparar` y `levantar` (P0 imagen, P2, P3, P4, P6) | Hecho (probado en la corrida real) | 2026-11-15. `apps/ejecutor/src/aprovisionar.ts`. `preparar(slug, {version, dominio, nombre, tema})`: digests de `imagenes/<version>.env` confirmados en el registro por el daemon, `.env` 600 con secretos generados en el host B (conservados al reintentar), token interno para el agente, plantilla renderizada con las rutas del ERP, `compose config` y solo imagenes por digest. Se niega con un `erp-<slug>` que no creo el ejecutor y con un cambio de version de un silo con contenedores. `levantar(slug, bd|todo)`: `up` sin build, espera `migrate` en 0; sin KEK responde 409 ESPERANDO_LLAVES (el daemon no crea backend ni frontend). El ejecutor corre `docker compose` sin shell y nunca monta `infra/secrets/`. 19 tests nuevos (43 del ejecutor). Probado contra Docker real con `r1prueba`: preparar x2, ajeno 409, version sin publicar 404, levantar bd x2, todo sin llaves 409. Falta probar `todo` con llaves (P5 lo corre el operador) |
| Job `aprovisionar` P0 a P10, ESPERANDO_LLAVES en P5 | Hecho (falta prueba real completa) | 2026-11-15. Decisiones del usuario: solo version `fija` hasta tener releases (un canal falla en P0); P8 lo verifica el agente y, si el dominio no responde, el job espera al operador (estado nuevo `ESPERANDO_OPERADOR`, boton "Dominio listo"), nunca ACTIVO_SIN_DOMINIO; P9 verifica un respaldo con `.sha256` (si no, FALLIDO y reintento). Pasos: P0 control (manifiesto + version fija, nombre y tema que acepta el ejecutor, slug y dominio libres), P1 control (APROVISIONANDO, silo registrado sin adoptar), P2 agente (integridad, capacidad, `preparar`; P3 va dentro; reporta version y digests), P4 (`levantar bd`), P5 operador (boton "Llaves listas" con custodios, nunca partes), P6 (`levantar todo` + `/api/salud` por el borde; sin KEK vuelve a P5), P7 (R4), P8, P9, P10 (R5; reintento con cuenta ya activa = OK); cierre: ACTIVO, silo adoptado con version y digests. La API impone el orden de los pasos y el agente renueva la reserva en pasos largos. Cancelar: el centro vuelve a APROBADO y lo creado en el host B queda (nada se borra solo). Migracion aditiva `20261115160000_aprovisionar`. Tests: API 84 unitarios y 108 de integracion (10 nuevos), agente 16, ejecutor 43. Prueba real: API, web, agente y ejecutor reconstruidos y migracion aplicada; encontrado y corregido un DTO declarado despues del controlador (la API no arrancaba). Corrida real completa (job #8, e2eprov, 0.1.0): P0 a P10 OK y centro ACTIVO, con P8 por un Traefik real simulado en el PC (CA local, sin tunel) y P9 con respaldo real. Bugs hallados y corregidos: DTO antes del controlador, atajo `SILO_INTERNO_URL` global (ahora `SILO_INTERNO_SLUGS`), `respaldar.sh` en Windows (ERP), cronometros fijos en la consola. Falta repetirlo con el tunel real cuando exista |
| Job `reconfigurar` (P0, C1 aplicar y C2 confirmar por `/api/internal/config`) | Hecho | R4 del ERP. Probado 2026-11-14 en local (job #3) |

Hallazgo de la prueba: en el PC de pruebas el disco estaba al 84 %, asi que V5 fallaba (umbral 80 %, el mismo de la alerta S2). Resuelto 2026-11-16: el agente reporta 25,8 % (`metricas_host`), V5 ya no bloquea.

## Tests de integracion de la API (Hecho 2026-11-14)

Plan aprobado 2026-11-14, antes de los jobs que escriben (`aprovisionar`,
`eliminar`). 51 tests en 4 archivos al cerrar (89 en 7 desde 2026-11-15), estables en 3 corridas
seguidas. Como correrlos: `apps/api/test/integracion/README.md`.

| Pieza | Estado | Nota |
|---|---|---|
| Infra: `globalSetup` levanta `postgres:18-alpine` desechable (tmpfs, puerto libre, etiqueta `vc.test=api`), `prisma migrate deploy` desde cero, teardown lo borra; `TEST_DATABASE_URL` para CI | Hecho | `*.int-spec.ts`, `jest.int.config.js`, `pnpm api test:int`. `pnpm api test` sigue sin Docker (65 unitarios). No toca la BD `control` (5440) ni la del ERP (5432) |
| Services reales de Nest con Prisma real; `CorreoFalso`; `TRUNCATE ... RESTART IDENTITY` por test; en serie; ventana de respaldo fijada con un spy | Hecho | `test/integracion/entorno.ts` |
| Migraciones: todas aplican desde cero | Hecho | Lo prueba cada corrida |
| Acceso (13): flujo completo, bloqueo tras 5, correo inexistente igual, codigo un uso (tambien con dos peticiones juntas) / 10 min / 5 intentos, reenvio 45 s y max 3, sesion 30 min y 12 h, operador desactivado, correo caido no deja desafio vivo | Hecho | |
| Cola (22): P0 sin aprobado, schema y hash alterado, 409 con job activo, silo sin reporte y ventana de respaldo, `SKIP LOCKED` con dos reclamos paralelos, retoma con reserva vencida, agente ajeno 403, cancelado 409 `detener`, reintento desde el paso fallido, idempotencia | Hecho | |
| Solicitudes de modulo + RECONFIGURAR (8): punta a punta, entrega de a un paso, `aplicar` no repite revision ni job, APLICADA a mano con centro aprobado 409, rechazo 4xx revierte y 5xx se reintenta, camino manual | Hecho | |
| Centros (8): fase 1 crea SOLICITUD + revision 1 + auditoria + aviso, transiciones invalidas sin rastro, descartar con motivo, carrera entre dos operadores | Hecho | |
| BUG: dos reportes finales simultaneos del mismo paso cierran el job dos veces (`job.ok` x2; en RECONFIGURAR, `cerrarSolicitudes` x2) | Hecho | Encontrado y corregido 2026-11-14 (fallaba 10 de 10). El cierre del job ahora es `updateMany({ where: { id, estado: 'EN_CURSO' } })` y solo sigue (auditoria, `cerrarSolicitudes`) si `count === 1`. Test en `jobs.int-spec.ts` |
| Pipeline de Bitbucket con Postgres como servicio | Hecho | 2026-11-15. `bitbucket-pipelines.yml`: en cada push y PR, install congelado, `prisma generate`, build del manifiesto, `pnpm -r test`, integracion con Postgres 18 como servicio (`TEST_DATABASE_URL`), tipos de web y sitio y `pnpm -r build`. Simulado en contenedores sobre una copia limpia: OK. La primera corrida encontro que agente y API necesitan `packages/manifest/dist` (en el PC ya estaba compilado). Sin publicar imagenes: depende de R1 y de como llega CI al host B sin puertos abiertos (decision abierta) |
| Coberturas: reporte del agente (`agente.int-spec.ts`, 7: token, cuerpo solo con campos de la lista, escritura, reporte -> alertas), fase 2 (`fase2.int-spec.ts`, 6: slug, enlace rotado/vencido/revocado, solo sha256 del token, borrador por ambas partes, envio, P0 y aprobacion, dos aprobaciones a la vez) e incidentes y soporte (`incidentes.int-spec.ts`, 6) | Hecho | 2026-11-15. 89 de integracion en 7 archivos (unos 26 s), estables en 3 corridas |
| BUG: dos registros simultaneos del mismo hito de un incidente creaban dos eventos; dos cierres de soporte quedaban los dos auditados | Hecho | Encontrado y corregido 2026-11-15 (misma clase que la carrera de los jobs). `registrar` usa `updateMany` condicionado al estado revisado (hito sin fecha, no cerrado, informe para cerrar) y el que pierde recibe 409 sin evento; `cerrarSoporte` condiciona a `ABIERTA` |

## Fase 5. Resto de la consola (Pendiente)

| Pieza | Estado | Nota |
|---|---|---|
| Estilos: 5 preferencias en el formulario; temas del ERP (moderno, cuaderno) seleccionables en el manifiesto; preferencia del centro visible | Hecho | 2026-11-12 |
| Compartir solicitud desde la barra lateral (enlace con modulos precargados) | Hecho | `GET /api/sitio` de la web entrega `SITIO_URL` |
| Consola alineada al boceto: navegacion agrupada (Operacion, Versiones, Salud, Ciclo de vida, Ajustes; lo que falta aparece apagado), Solicitudes en maestro-detalle, Manifiesto en dos columnas (formulario compacto; YAML y P0 en vivo al lado), vista Silos | Hecho | 2026-11-12, pedido del usuario: menos scroll, seguir el boceto salvo choque con reglas |
| Resumen: KPIs (silos, alertas, solicitudes nuevas, jobs activos, incidentes abiertos, host) y eventos recientes | Hecho | 2026-11-13 |
| Espacios para notebooks de 13 a 16" (1920x1200 a 150/125/100 % = 1280, 1536 y 1920 px CSS): lateral fijo de 240 a 280 px, margenes fluidos, columna lateral acotada, texto 14 px desde 1680 px, menos aire vertical en pantallas bajas | Hecho | 2026-11-14. Revisado en Resumen, Silo, Manifiesto y Job a 1280, 1536 y 1920: sin desborde horizontal. `Dialogo` reutilizable para modales |
| Pasar a `Dialogo` los otros `window.confirm`/`prompt` (reiniciar silo x2, cancelar job, aprobar manifiesto, abrir incidente) | Hecho | Revisado 2026-11-14: en `apps/` no queda ningun `window.confirm/prompt/alert`, `<select>` ni input de fecha/numero nativo |
| Silo detalle: centro y manifiesto aprobado, jobs recientes, acciones (reiniciar contenedores, abrir incidente) | Hecho | 2026-11-13. Faltan version/digest (R1) y suspender. "Iniciar salida" hecho 2026-11-14 |
| Releases y canales: registro, promover, cascada (`actualizar`) | Hecho (falta corrida real de ACTUALIZAR) | 2026-11-15. Decisiones del usuario: respaldo previo por un verbo del ejecutor (auxiliar sin red que monta solo `respaldo.key`), cascada semiautomatica, confirmacion del operador de que no hay exporte en curso (hasta R13), releases detectados por el agente. Agente: lee `infra/imagenes/*.env` y los informa (`POST /agente/releases`); tag con otros digests = conflicto (no se promueve ni aplica). Consola Releases: promover demo -> beta -> estable (una version con sufijo no llega a estable), "Aplicar al canal" (cascada de a un silo; el siguiente al terminar OK; si uno falla se detiene y sigue al reintentarlo). Silo: version, digests, canal y "Actualizar". APROVISIONAR acepta canal (P0 lo resuelve y lo fija en el job). Job ACTUALIZAR: U0 control, UC manual solo en un minor, U1 respaldar, U2 actualizar (.env, anterior.env), U3 migrate, U4 recrear, U5 salud; si U3-U5 fallan el agente revierte y el reintento rehace desde U2. Ejecutor: verbos `respaldar`, `actualizar`, `revertir` (51 tests). Migracion aditiva `20261115200000_releases`. Tests: API 89 unitarios y 118 de integracion, agente 20. Real: releases 0.1.0 y 0.1.0-prueba.1 detectados por el agente con sus digests. Falta: corrida real de ACTUALIZAR (necesita publicar una 0.1.1) y R6 (notas de version al ADMIN) |
| Salidas, etapa 1: expediente y actas en la consola (S1 a S8) | Hecho | 2026-11-14. Ver "Salidas" abajo |
| Salidas, etapa 2: S6-S7 por el ejecutor y reversion | Hecho | 2026-11-14 (opciones B + C). S3 automatico con R13 y S2 con R12 (2026-11-16, filas abajo) |
| Notas de version al ADMIN (R6) | Hecho | 2026-11-16. Decision del usuario: las escribe el operador en Releases ("notas para el ADMIN", texto plano hasta 4000, auditado; migracion aditiva `20261116120000_r6_notas_version`). Van con el job ACTUALIZAR y el agente las entrega en el paso nuevo U6 (`/api/internal/notas-version`); si el silo no las acepta (ERP sin R6) el job sigue OK con el motivo en el log. El ADMIN las ve en Configuracion > Vinculos > Novedades de la plataforma. Tests: API 89 + 121, agente 23 |
| S2 automatico: silo en solo lectura durante la salida (R12) | Hecho | 2026-11-16. Job `SOLO_LECTURA` (P0 en el control, L1 en el agente por `/api/internal/salida`; migracion aditiva `20261116110000_r12_solo_lectura`). Se encola al iniciar la salida (`ACTIVAR:<fecha de corte>`) y al revertirla (`QUITAR`; con el silo detenido, al terminar REANUDAR_SILO). No bloquea la salida: si hay otro job activo queda en la auditoria (`salida.solo_lectura_no_encolada`); un ERP sin R12 (404) falla L1 con la explicacion. Decision del usuario: los derechos de los pacientes siguen abiertos. Tests: API 89 + 120, agente 22 |
| Incidentes S1/S2/S3: hitos (contencion, aviso al centro, actualizaciones, informe final, cierre) con plazos en horas y dias habiles, semaforo, bitacora; abrir desde una alerta del monitoreo o desde el silo | Hecho | 2026-11-13. Migracion `20261113035502_incidentes_y_soporte`. Dias habiles sin feriados (pendiente) |
| Soporte: ticket con la autorizacion del ADMIN (alcance, 1 a 72 h), vencimiento y resultado sin datos del centro | Hecho | La autorizacion la declara el operador: verificarla contra el silo requiere `/api/internal/*` |
| Configuracion: plazos, seguridad, correo (con prueba), sesiones abiertas (revocar), operadores, cambio de la propia contrasena | Hecho | 2026-11-13. Cierra el pendiente de la fase 1 (revocar y rotar desde la consola) |
| `reiniciar_demo` | Hecho | 2026-11-16: job REINICIAR_DEMO (P0 control: demo activo, uno por hora; R1 agente: verbo `resembrar_demo`) y boton en Demos |
| Demos a medida desde la consola | Hecho (falta corrida real) | 2026-11-16, decision del usuario: vista Demos con cuentas madre (1-3), profesionales (1-20) y pacientes (0-300). Crea el centro (origen demo) con manifiesto ficticio aprobado (bloque `demo`, canal `demo` permitido solo con el bloque) y encola APROVISIONAR; en P10 el agente pide `cargar_demo` al ejecutor en vez de invitar al ADMIN. Ejecutor: `EJECUTOR_DEMOS` del host B decide que slugs son demo (`ES_DEMO=true` en su .env, `identidad_silo.es_demo`); `cargar_demo` corre el generador del ERP (`dist/demo/generador-demo.js`) con la contrasena generada en el host B y pasada por el entorno; correos, roles y contrasena quedan en `silos/<slug>/demo-cuentas.txt` (600) y al control llegan solo conteos por rol. Tests: manifest 26, API 89 + 123, agente 24, ejecutor 58. `eliminar` borra tambien `silos/<slug>/` (.env con secretos, compose, anterior.env, demo-cuentas.txt) y `tokens/<slug>.token` (2026-11-16); las llaves siguen siendo manuales |
| Dias habiles con feriados de Chile en los plazos de incidentes | Hecho | 2026-11-15. `incidentes/feriados.ts`: port de `feriados_legales` del ERP (Pascua, solsticio por Meeus, traslados de las leyes 19.668, 20.299, 20.983 y 20.215); igual al ERP en 2024-2040 (comparado contra su BD). Los de una ley puntual o regionales van en `FERIADOS_EXTRA` del .env del host A. 7 tests |

## Salidas (etapa 1 Hecha 2026-11-14)

Plan aprobado 2026-11-14. La consola lleva el expediente y las actas; los pasos
fisicos siguen `docs/cumplimiento/baja_centro.md` del ERP (manual). Nunca el
contenido del exporte ni su clave.

| Pieza | Estado | Nota |
|---|---|---|
| Modelo `Salida` (uno por centro): S1 corte y motivo; S3-S4 fecha, tamano y huella del exporte; S5 acta (firma, quien recibe por la direccion, conteos, hash); S6 gracia, silo detenido, confirmacion escrita; S7 acta de eliminacion (checklist + hash) | Hecho | Migracion `20261114180000_salidas` (aditiva: tabla nueva) |
| Transiciones con auditoria: ACTIVO/ACTIVO_SIN_DOMINIO/SUSPENDIDO -> EN_SALIDA (slug escrito) -> EXPORTADO (acta con huella igual a la del exporte) -> GRACIA (silo detenido) -> ELIMINADO (gracia vencida + confirmacion escrita + checklist completo + slug) | Hecho | Optimistas (409 si otro cambio el estado). Cada paso idempotente: mismos datos = sin cambios; otros datos = 409 |
| Gracia: 30 dias desde la firma del acta, editable por contrato (1 a 365) | Hecho | Plazo por defecto aun "a confirmar en los terminos" (seccion 12 del contexto) |
| S6 comprobado con datos reales: se rechaza si el agente reporto contenedores `running` del silo en los ultimos 5 min; al detener, el silo sale del monitoreo (sin alertas falsas en la gracia) | Hecho | |
| Consola: vista Salidas (lista con dias de gracia y semaforo; detalle con linea de tiempo S1-S8, datos de las actas y formularios en `Dialogo` con controles propios); "Iniciar salida" en el detalle del silo | Hecho | Revisado a 1280, 1536 y 1920 px: sin desborde. Se corrigio una huella larga que tapaba su etiqueta |
| Tests: 8 unitarios (`salidas/reglas.spec.ts`), 22 de integracion (`salidas.int-spec.ts`: jobs simulados, reversion, actas por correo), 11 del ejecutor (`ciclo.test.ts`) | Hecho | |
| S2 solo lectura del silo | Hecho | R12, 2026-11-16 |
| S3 huella y estado del exporte traidos por el agente (sin tipearlos) y bloquear `actualizar` con un exporte en curso | Hecho | 2026-11-16 (R13). El agente lee `/api/internal/exportaciones` cada minuto y lo informa (`POST /agente/exportaciones`, tabla `exportaciones_silo`, migracion aditiva `20261116100000_r13_exportaciones`). ACTUALIZAR: un exporte PENDIENTE o EN_PROCESO da 409 al crear, falla U0 y el agente lo revisa en vivo en U1 antes del respaldo; un silo con un ERP anterior a R13 (404) sigue con la confirmacion del operador. Cascada: ya no exige la confirmacion; un silo que no informa la detiene. Salida S3: la consola ofrece los exportes terminados para llenar fecha, tamano y huella. Tests: API 89 + 119, agente 21 |
| S6/S7 por el ejecutor: verbos `detener`, `reanudar` (B) y `eliminar` (C); jobs DETENER_SILO, REANUDAR_SILO y ELIMINAR | Hecho | 2026-11-14, decidido por el usuario. `eliminar` exige `infra/host-b/bajas/<slug>` con el hash del acta de recepcion (consentimiento local, solo lectura), el silo detenido y fuera de la ventana de respaldo; borra contenedores, volumenes, redes y `respaldos/<slug>/` del proyecto; nunca llaves, bucket, DNS ni crontab. Su log va al acta S7 y marca 3 items del checklist. Sin ejecutor siguen los caminos a mano. Diseno en `docs/propuesta-escritura-docker.md` |
| Copia del acta de eliminacion al centro por correo | Hecho | 2026-11-14, decidido por el usuario. Al eliminar se envia al responsable de datos del manifiesto aprobado (si no hay, al contacto); solo metadatos y hash. Si falla, la eliminacion queda igual, el fallo queda en la auditoria y se reenvia desde la consola. 3 tests de integracion |
| Revertir una salida (baja por error o arrepentimiento) | Hecho | 2026-11-14. Con la solicitud escrita del centro y el slug. EN_SALIDA/EXPORTADO: vuelve al estado previo en el acto; GRACIA con silo detenido: job REANUDAR_SILO y vuelve al quedar sano (o a mano si el agente lo ve en marcha). Acta de reversion con hash y copia por correo. Bloqueada tras empezar ELIMINAR. Varias salidas por centro (una abierta: unico `(centro_id, abierta)`); la maquina de estados suma EN_SALIDA/EXPORTADO/GRACIA -> estado previo. Migracion `20261114210000_salidas_reversion_y_ejecutor` (aditiva) |

## Fase 6. Landing (Hecha 2026-11-15)

Decision del usuario (2026-11-15): la landing es el sitio para vender y donde el
centro hace su solicitud. Ese mismo dia, tambien por decision del usuario, el
formulario compartido y el enlace de fase 2 (antes `apps/sitio`, `:3200`) se
juntaron en la landing: un solo sitio publico, un contenedor y un dominio
menos. `apps/sitio`, su red, `SITIO_SECRETO` y `/publico/*` de la API ya no
existen; `SITIO_URL` paso a ser `LANDING_URL`.

| Pieza | Estado | Nota |
|---|---|---|
| App propia `apps/landing` (127.0.0.1:3300), SSG, contenedor y red Docker propios | Hecho | Desde la landing solo se alcanza la API (probado: no llega a db, web ni mailpit). Cabeceras: `frame-ancestors 'self'`, nosniff, Referrer-Policy, Permissions-Policy |
| Canal propio en la API: `POST /landing/solicitudes` con `LANDING_SECRETO` (header `x-landing-secreto`), limite 5 por hora por IP con contador propio, campo trampa, origen `landing` | Hecho | Probado contra la API real. El proxy de la landing exige mismo origen y JSON en las escrituras y acota el cuerpo; fuera de `/landing/*` no llega a nada |
| Secciones del boceto: inicio con tablero de bloques, un dia por rol, cada bloque explicado (problema, flujo, quien lo usa, maqueta), seleccion, estilos (Moderno, Cuaderno, Editorial en preparacion, color propio) con vista de la pagina en ese estilo, como trabajamos + seguridad, conversacion | Hecho | Sin Cobros (MVP sin finanzas). "Demo" y "Ver demo en vivo" llevan a `https://demo.charlielearns.work` (silo de demostracion de estilos; `NEXT_PUBLIC_DEMO_URL` al compilar). `estres.charlielearns.work` es solo para estresar y monitorear el servidor: no se enlaza. Las "capturas" son maquetas con datos ficticios, no pantallas reales. Todos los colores son tokens de `globals.css` |
| Dependencias de bloques desde `@vinculos/manifest` (las mismas de P0): agregar Match trae Equipo, quitar Equipo quita Match y Sitio | Hecho | Probado en el navegador |
| Conversacion = solicitud de fase 1 con la seleccion de la pagina; valida con `fase1Schema` antes de enviar | Hecho | Probado de punta a punta 2026-11-15: la solicitud llego a la BD `control` (SOLICITUD, origen `landing`, revision 1 con los 5 bloques, tamano, sitio y estilo elegidos), con auditoria y correo "nueva solicitud" al operador en Mailpit. La consola muestra el origen como "Landing publica" |
| Anchos: 375, 1280, 1536 y 1920 px en los 5 estilos | Hecho | Sin desborde horizontal |
| Formulario compartido y fase 2 en la landing | Hecho | 2026-11-15. El enlace que comparte el operador es una pagina aparte dentro de la landing, `<LANDING_URL>/solicitud` (misma conversacion y misma API `/landing/solicitudes`, sin bloques marcados: los elige el centro; `noindex`), y llega con origen `enlace`. En la consola, "Compartir solicitud" solo copia, abre o cierra el enlace (decision del usuario: precargar modulos no sirve si no se sabe que quiere el centro). El enlace de fase 2 es `<LANDING_URL>/manifiesto/<token>` (misma pagina que tenia el sitio, clases `f2-` y tokens Moderno A acotados) por `GET/PUT/POST /landing/manifiesto/...`, 120 intentos por hora por IP, `no-referrer` y `noindex`. Probado en el navegador: `/solicitud` parte sin bloques, la seleccion agrega requisitos y la solicitud llega con origen `enlace`; enlace de fase 2 por correo (apunta a :3300) -> datos enviados (DATOS_COMPLETOS) -> contrato y aprobacion en la consola (APROBADO, revision 4) -> el enlace responde 410. `landing.int-spec.ts`: 9 tests |
| BUG: guardar el manifiesto desde la consola daba 404 | Hecho | Hallado 2026-11-15 en esa prueba: el editor manda POST, la API solo tenia PUT y el proxy de la web reenvia solo GET y POST. La API acepta ahora POST (y sigue aceptando PUT) en `/consola/centros/:id/manifiesto` |
| Publicar la landing (tunel de Cloudflare, dominio) | Pendiente | Infra |
| Pie provisorio y paginas legales | Hecho (provisorio) | 2026-11-15, pedido del usuario: pie con Plataforma, Legal (`/legal/privacidad`, `/legal/terminos`, `/legal/tratamiento`, paginas "documento en preparacion", `noindex`) y Contacto, en la landing, `/solicitud` y las legales. Datos provisorios en un solo lugar (`datos.ts`: `CONTACTO_CORREO`, `PIE`, `LEGALES`). Falta el texto legal real (seccion 12 del contexto) |
| Contacto | Hecho (provisorio) | Decidido 2026-11-15: por ahora la comunicacion es por correo (sin WhatsApp) y toda solicitud entra por la plataforma (el pie lo dice). Correo ficticio `contacto@vinculos.example` (dominio reservado, no llega a nadie) hasta tener el real; se cambia con `NEXT_PUBLIC_CONTACTO_CORREO` al compilar |

## Fase 7. Pruebas de capacidad (Pendiente)

| Pieza | Estado | Nota |
|---|---|---|
| `pruebas/k6/` y corridas registradas por version | Pendiente | Seccion 13 |
| Capacidad real del host B (boceto: 6 a 10 silos) | Pendiente | |

## Requisitos del ERP que bloquean

| ID | Requisito | Bloquea |
|---|---|---|
| R1 | Imagenes unicas por digest: compose sin `build`, `publicar.sh` y registro `registry:2` en el host B (`docs/requisitos-erp.md`) | Hecho 2026-11-15 (sin CI: GitHub Actions + GHCR + `importar.sh` despues, no bloquea) |
| R2 | `/api/internal/solicitudes`: solicitudes de modulo del ADMIN (modulo, accion, rol, fecha), token por silo | Hecho 2026-11-13 |
| R3 | `/api/internal/solicitudes/:id` para devolver el estado (aprobada, rechazada, aplicada) | Hecho 2026-11-13 |
| R4 | `/api/internal/config` con funciones SECURITY DEFINER para `modulos_activos` y reglas | Hecho 2026-11-13 (tema y marca aun no se aplican por aqui) |
| R5 | `/api/internal/admin-inicial` (invitacion del ADMIN) | Hecho 2026-11-13 |
| R6 | Notas de version en el panel del ADMIN | Hecho 2026-11-16 |
| R7 | Agregados periodicos para la consola (hoy `soporte_resumen()` exige autorizacion) | Resumen, soporte |
| R8 | Implementar el tema "editorial" (ya disenado en el boceto del landing) en `frontend/src/app/temas/` | Aprobar centros que lo eligieron |
| R10 | `demo:resembrar`: vaciar los datos ficticios del demo y volver a sembrar, conservando llaves y configuracion; marca `es_demo` en la BD (spec en `docs/requisitos-erp.md`) | `reiniciar_demo` |
| R9 | Tema y nombre del centro en runtime | Hecho 2026-11-13 (con R11) |
| R12 | Modo solo lectura del silo por `/api/internal/*` (S2 de la salida) | Hecho 2026-11-16 |
| R13 | `/api/internal/exportaciones`: estado, fecha, tamano y huella del ultimo exporte, sin contenido | Hecho 2026-11-16 |
| R11 | Identidad del silo y redes propias (`identidad_silo`, `_interna`/`_silo`/`_borde`) | Hecho 2026-11-13 |
| R14 | `respaldar.sh` no debe dejar un respaldo vacio con la db detenida (pipe sin `pipefail`; 32 bytes pasan `[ -s ]`) ni rotar los buenos | Hecho 2026-11-16 (sale con 3 con la db detenida; minimo 1024 bytes; rota solo tras un respaldo bueno) |

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
| Panel de acceso | Salidas | Hecho (etapa 1, 2026-11-14) |
| Panel de acceso | Releases | Hecho 2026-11-15; revisado a 1280/1536/1920 el 2026-11-16 sin desborde |
| Panel de acceso | Monitoreo | Hecho (version basica) |
| Panel de acceso | Auditoria | Hecho |
| Landing | Todo | Hecho 2026-11-15 (`apps/landing`, sin Cobros ni demo; ver fase 6) |

## Diferencias encontradas con el ERP

- Temas: el ERP tiene "Moderno A" y "Cuaderno"; los docs decian solo Moderno (corregido 2026-11-12). "editorial" esta disenado (boceto del landing) pero no implementado en el ERP: requisito R8.
- El default de `modulos_activos` en el ERP es "todos menos WHATSAPP" (COBROS ya no existe desde 2026-11-16). El plano de control no asume defaults: el manifiesto lista los modulos explicitamente.

## MVP sin pagos ni finanzas (2026-11-16)

Decision del usuario: nada de pagos ni finanzas en el MVP. En el ERP se borro
todo (BD, backend, front, seed; detalle en `roadmap_mvp.md` del ERP). En el
plano de control:

| Pieza | Estado | Nota |
|---|---|---|
| `@vinculos/manifest`: sin modulo COBROS (enum, dependencia COBROS -> AGENDA, nombre) ni reglas de cobros (`modelo_cobro`, penalizacion, inasistencia, comisiones, liquidacion, medios de pago, morosidad) | Hecho | `CAMPOS_REGLAS` = lista cerrada de `aplicar_config_interna()` del ERP. 25 tests |
| API, consola y landing | Hecho | `MODULOS` de solicitudes sin COBROS; el editor del manifiesto ya no filtra reglas de cobros. API 89 unitarios y 118 de integracion |
| Manifiestos y solicitudes guardados con cobros | Revisado | Ninguno en la BD `control` |
| Silos de prueba del host B | Pendiente | Necesitan la imagen nueva del ERP: la migracion corre en ACTUALIZAR (`migrate`). La BD de `centro-prueba` (la de desarrollo) ya la tiene |

## Alcance del MVP (decision 2026-11-16)

Entran al MVP los requisitos del ERP R12 (solo lectura en la salida), R13
(estado del exporte), R10 (`reiniciar_demo`) y R6 (notas de version al ADMIN).
R8 (tema Editorial) queda fuera: el usuario lo disenara despues y se generara
desde la plataforma. Llave FINANCIERO retirada del ERP (ninguna finanza en el
MVP, en ningun lado).

## Entorno de pruebas en un VPS (decision 2026-11-16)

Para las pruebas de desarrollo todo corre en un solo VPS: plano de control
(host A) y silos (host B) en el mismo servidor, como proyectos de compose
separados. Se mantiene el modelo pull: el agente llega a la API por HTTPS (por
el tunel de Cloudflare), nunca por la red local. La separacion en dos hosts
sigue siendo la regla para produccion.

## Siguiente paso (2026-11-15)

Prioridad (decision del usuario, 2026-11-15): terminar el MVP antes de buscar
infra. Mientras no este completo no se publica la landing ni se arma el VPS.
Para la demostracion se mantienen como estan: gracia de 30 dias por defecto y
la reversion bloqueada si un ELIMINAR fallo en X2 (aunque no haya borrado).


1. Hecho: tests de integracion de la API (y arreglo de la carrera de
   reportes finales simultaneos).
2. Hecho: Salidas completas (expediente, actas por correo, ejecutor B + C,
   reversion). Hecho 2026-11-15: feriados de Chile en los plazos
   de incidentes, pipeline de Bitbucket y coberturas de integracion. Sin
   bloqueos: landing (fase 6). Abierto: plazo de gracia por defecto en los
   terminos. Hecho 2026-11-15: verbos del ejecutor y salida de punta a punta
   contra Docker real (ver "Revisiones pendientes al retomar").
3. Hecho 2026-11-15: R1 (compose por digest, `publicar.sh`, registro en el
   host B). Hecho 2026-11-15: `preparar`/`levantar` del ejecutor y el job
   `aprovisionar`. Siguiente: corrida real completa (publicar 0.1.0, el
   operador aprovisiona desde la consola y genera las llaves); despues releases
   (canales, y `fija` como retencion temporal, no como opcion permanente). En el ERP: R10 habilita `reiniciar_demo`. R12 y
   R13 (salidas). R14 (respaldar.sh con la db detenida). R6
   (notas de version) y R8 (tema editorial).
4. Infra: Cloudflare Access delante de la consola.
5. Pendiente del ERP (experiencia): paginas de un modulo apagado abiertas por
   URL directa muestran la vista vacia en vez de "modulo no contratado".
