# vinculos-control

Plano de control de Vinculos: sitio publico, consola del proveedor y worker que aprovisiona, reconfigura, actualiza, monitorea, exporta y elimina silos de centros. Diseno completo en `CONTEXTO.md` (leer la seccion pertinente antes de cada tarea, no entero). Estado real del ERP que se controla (reglas, despliegue, parametros, diferencias ya resueltas) en `ERP_REGLAS_Y_DESPLIEGUE.md`. Si ambos chocan, manda el ERP (`C:\Users\cagaj\Desktop\SW Proyecto`, su BD y sus docs): reportar la diferencia, no inventar. Avance (hecho, pendiente, bloqueado por el ERP) en `docs/roadmap.md`: leerlo al empezar y actualizarlo al cerrar cada pieza. Los bocetos de `system-reference/` son referencia visual; si chocan con lo construido o con este archivo, manda lo construido.

## Reglas duras
- Este sistema NUNCA guarda, lee ni transporta datos clinicos ni personales de pacientes. Solo metadatos: centro, version, modulos, estado, booleanos de salud, metricas de contenedor, hashes, fechas, actas.
- Un silo = el stack `erp-<slug>` del ERP (`infra/docker-compose.yml`): servicios `db` (Postgres 18 propio), `migrate`, `backend`, `frontend`; volumenes `db_data` y `exportaciones`; secretos en `infra/secrets/<slug>/` (KEK, `recuperacion.pub`, `respaldo.key`) y su `.env`. Nunca compartir Postgres, rol, secretos, volumen ni red entre silos: redes `erp-<slug>_interna`, `_silo` y `_borde` (Traefik y el agente se unen a la de borde; `proxy` es solo del plano del host), labels `cl.vinculos.silo` y tabla `identidad_silo` (R11).
- Misma imagen para todos (`vinculos-api:<version>`, `vinculos-web:<version>`). Cero codigo por cliente. Una necesidad de cliente que no quepa como parametro se convierte en opcion de modulo para todos, apagada por defecto. Hecho en el ERP (R9/R11, 2026-11-13): imagenes comunes y nombre, tema y dominio del centro en runtime; falta R1 (registro + digest, sin `build`).
- Todo cambio en un silo nace de una revision aprobada del manifiesto (hash registrado).
- Plano de control (host A) y silos (host B) en hosts separados. Modelo pull: el agente del host B reclama jobs por HTTPS y reporta pasos; el host A nunca toca Docker ni abre conexiones hacia B.
- El agente solo ejecuta acciones de una lista cerrada; nunca comandos arbitrarios. Usa Docker via `docker-socket-proxy`.
- Agente -> silo: solo `/api/internal/*` con token por silo, dentro de la red Docker de B. Ese modulo aun no existe en el ERP: se construye alli (funciones SECURITY DEFINER), nunca con credenciales de dueno en runtime. El agente nunca usa cuentas de usuario del centro (sesion unica: cortaria la sesion de la persona).
- Llaves de cifrado (KEK, DEK, partes Shamir de recuperacion): solo los scripts manuales del ERP (`infra/scripts/llaves/`), corridos por el operador. El agente no las genera ni las lee; el job espera en ESPERANDO_LLAVES. JWT y contrasenas de BD si los genera el agente.
- Registro privado en el host B; tags inmutables; cada silo guarda tag + digest. Mismas reglas al migrar a ECR.
- Respaldos: los del ERP (`infra/scripts/continuidad/respaldar.sh`): `pg_dump -Fc` diario 02:00 Chile por silo, cifrado AES-256 (openssl PBKDF2) con `respaldo.key`, prefijo propio `respaldos/<slug>/`, sha256; 7 dias en host, 35 en destino externo; prueba de restauracion mensual.
- Salud del silo: `GET https://<dominio>/api/salud` -> `{ estado, bd, canarios }` (200/503). Solo booleanos.
- Datos externos solo via formato canonico + adaptadores (entrada y salida). PDF sin estructura = documento historico, no se interpreta.
- Pasos de los jobs idempotentes, registrados y reintentables desde el paso fallido. El rollback deshace solo lo que creo el mismo job; nunca borra datos cargados por el centro.
- Migraciones del ERP solo aditivas desde el primer silo real; actualizar un silo a la vez: respaldo -> migrate -> swap -> `/api/salud` -> volver a la imagen anterior si falla. No actualizar con una exportacion del centro en curso ni en la ventana de respaldo (02:00).
- Quitar un modulo oculta la UI y bloquea la escritura; no borra datos.
- Consola protegida con verificacion en dos pasos por correo.
- Textos de UI, docs y commits en espanol. Formato ASCII en docs (sin rayas largas ni comillas tipograficas).
- Todo popup (confirmacion, aviso, pedido de texto) y todo selector (opciones, numeros, fechas, horas) usa los componentes propios con el estilo de la plataforma, nunca los nativos del navegador (`window.confirm/prompt/alert`, `<select>`, `type="date|datetime-local|time|number"`). Consola: `Dialogo`/`useConfirmacion` (`apps/web/src/componentes/dialogo.tsx`) y `Selector`, `CampoNumero`, `CampoFecha`, `CampoFechaHora` (`controles.tsx`); landing: botones y conversacion propios y `Selector` (`apps/landing/src/app/selector.tsx`), sin `<select>` ni campos nativos de fecha o numero.
- Espacios pensados para notebooks de 13 a 16" (1920x1200 a 150/125/100 %: 1280, 1536 y 1920 px CSS): revisar las vistas nuevas en esos tres anchos, sin desborde horizontal.

## Stack
- Monorepo pnpm: `apps/web` (Next.js: solo la consola, tras Cloudflare Access + login), `apps/landing` (Next.js: unico sitio publico; landing SSG para vender, solicitud de fase 1 del centro, y formulario aparte `/solicitud` que comparte el operador desde la consola (origen `enlace`, el centro elige sus modulos), y enlace privado de fase 2 en `/manifiesto/<token>`; solo `/landing/*` de la API con `LANDING_SECRETO`, red Docker propia), `apps/api` (NestJS + Prisma, incluye endpoints `/agente/*`), `apps/agente` (Node, corre en el host B), `packages/manifest` (schema zod + tipos, compartido con el repo `vinculos`), `packages/canonico` (formato canonico de import/export). La landing no ve la base, la consola ni Mailpit: solo la API.
- Postgres `control`. Cola de jobs en Postgres (`FOR UPDATE SKIP LOCKED`), sin Redis.
- Host B: Traefik v3.6 (labels del compose del ERP, TLS 1.2+, `compress` solo en `/api`), entrada por tunel Cloudflare (`cloudflared`, sin puertos abiertos; certificado Let's Encrypt por desafio DNS de Cloudflare, IP real en `X-Forwarded-For`), `registry:2` o Zot, cAdvisor, agente y ejecutor de silos (`apps/ejecutor`: unico con el socket de Docker, verbos cerrados; el unico verbo que borra es `eliminar` de la salida, con consentimiento local `bajas/<slug>` en el host B y el silo detenido, y nunca toca llaves; `docs/propuesta-escritura-docker.md`). Correo con SES (Mailpit en local), con configuration set propio de la consola. CI en Bitbucket (push al registro del host B).
- `infra/host-a/`, `infra/host-b/` (compose por host), `infra/templates/silo.compose.tpl` (derivada de `infra/docker-compose.yml` del ERP), `infra/scripts/provision.sh` (version manual de los pasos), `pruebas/k6/`.

## Dominio
- Estados de centro: SOLICITUD, CONTACTADO, REUNION, DATOS_COMPLETOS, APROBADO, APROVISIONANDO, ACTIVO, ACTIVO_SIN_DOMINIO, SUSPENDIDO, EN_SALIDA, EXPORTADO, GRACIA, ELIMINADO, DESCARTADO. Cada transicion queda como evento de auditoria.
- Manifiesto fase 1 (formulario publico, sin datos sensibles) -> fase 2 (enlace privado tras la reunion). Editable por ambas partes hasta APROBADO. Seccion 3 del contexto. Las `reglas` usan los nombres de columna de `configuracion_centro` del ERP.
- Jobs: `aprovisionar` (P0-P10), `reconfigurar`, `actualizar`, `reiniciar_demo`, `exportar` (S3-S4), `detener_silo` (S6), `eliminar` (S7), `reanudar_silo` (reversion de una salida en gracia). Secciones 5 y 8.
- Modulos (enum `modulo_centro` del ERP): nucleo implicito y siempre activo; FICHAS, AGENDA y EQUIPO dependen solo de nucleo; MATCH requiere EQUIPO (AGENDA opcional); COBROS requiere AGENDA (MATCH opcional); PAGINA_PUBLICA requiere EQUIPO (regla del plano de control; la BD del ERP no la exige); WHATSAPP apagado por defecto, sin dependencia definida. La BD del ERP exige con CHECK `configuracion_centro_modulos_coherentes` solo MATCH -> EQUIPO y COBROS -> AGENDA. Validar en P0 y en la consola. En el ERP solo el operador cambia `modulos_activos`.
- Versiones 0.x (actual 0.1.0 en `package.json` del ERP). Canales: demo, beta, estable o version fija. Patch automatico dentro del canal; minor con confirmacion por silo.
- Salida: el centro es responsable de los datos y Vinculos es el encargado (Ley 21.719, vigente 1-dic-2026). El ADMIN del centro genera el exporte dentro del silo (`.vxp`, AES-256-GCM con su propia clave, que Vinculos no conoce; JSON por tabla + PDF por ficha; huella SHA-256), lo descifra con `descifrar.mjs` y firma el acta. Luego 30 dias de gracia, eliminacion de base, volumenes, secretos y `respaldos/<slug>/`, y acta de eliminacion.
- Manifiesto con `tipo_cliente: centro` (independiente es futuro; precios en pausa).
- Soporte e incidentes: la consola registra solicitudes de soporte (solo con autorizacion vigente del ADMIN en el silo) e incidentes con plazos S1/S2/S3, sin datos personales.
- Entorno de pruebas: host B = PC local (i7 4a gen, 16 GB DDR3), 2 silos de prueba + demo con limites de 1 GB / 1 vCPU por silo (db 256M, backend 256M, frontend 256M). Metricas por corrida (seccion 13 del contexto).

## Reglas heredadas del ERP (no romper)
- La ficha solo la ve su tratante (otro profesional solo via derivacion formal). El admin ve solo codigos de ficha. La importacion clinica corre dentro del silo y el admin ve solo conteos, codigos y errores sin contenido.
- El admin valida RNPI (registro SIS), titulo y certificado de alumno regular; el perfil lo gestiona el profesional. Sin validacion no aparece en el sitio publico.
- Roles: ADMIN, GESTION (off por defecto), PROFESIONAL, PRACTICANTE, PACIENTE, RESPONSABLE (adulto responsable de un menor); multirrol permitido.
- Vinculos no maneja dinero; cada centro usa su propia pasarela (post-MVP). `modelo_cobro`: CENTRO, DIRECTO o MIXTO.
- Retencion de fichas de 15 anos minimo; purga manual.
- El soporte del proveedor nunca ve datos personales ni clinicos; solo funciones de diagnostico con autorizacion del ADMIN.

## Landing
- Concepto: "Tu plataforma se arma por vinculos". Bloques que encajan; el visitante los activa y desactiva, las dependencias se ven como conexiones y un bloque sin requisito queda atenuado.
- Por modulo: problema, flujo en pasos, captura del Centro de Prueba y quien lo usa. Los bloques elegidos precargan el formulario de fase 1.
- Usa los tokens del sistema de diseno de Vinculos (`data-tema`), sin colores escritos a mano. Temas que existen hoy en el ERP: "Moderno A" (Figtree) y "Cuaderno" (`NEXT_PUBLIC_TEMA`, `frontend/src/app/temas/`); "Editorial" esta disenado (boceto del landing) pero aun no implementado en el ERP: el formulario lo ofrece como preferencia y el manifiesto no lo aprueba hasta que el ERP lo tenga.

## Como trabajar
- Antes de codificar una pieza: leer la seccion del contexto y la del ERP, proponer un plan corto y esperar confirmacion si toca schema, jobs o seguridad.
- Una pieza que necesita algo del ERP que no existe (ej. `/api/internal/*`): se anota como requisito del ERP, no se simula en el plano de control.
- Tests: Jest para la API y los pasos de jobs contra un Postgres efimero; probar idempotencia corriendo cada paso dos veces.
- No inventar decisiones abiertas (seccion 12 del contexto): preguntar.
