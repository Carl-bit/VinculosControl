# vinculos-control

Plano de control de Vinculos: sitio publico, consola del proveedor y worker que aprovisiona, reconfigura, actualiza, exporta y elimina silos de centros. Detalle completo en `docs/CONTEXTO.md` (leer la seccion pertinente antes de cada tarea, no entero).

## Reglas duras
- Este sistema NUNCA guarda, lee ni transporta datos clinicos. Solo metadatos: centro, version, modulos, estado, conteos, hashes.
- Un silo = un contenedor `vinculos:<version>` + su base Postgres + su rol de base + sus secretos + su volumen. Nunca compartir rol, base ni secretos entre silos.
- Misma imagen para todos. Cero codigo por cliente. Una necesidad de cliente que no quepa como parametro se convierte en opcion de modulo para todos, apagada por defecto.
- Todo cambio en un silo nace de una revision aprobada del manifiesto (hash registrado).
- Plano de control (host A) y silos (host B) en hosts separados. Modelo pull: el agente del host B reclama jobs por HTTPS y reporta pasos; el host A nunca toca Docker ni abre conexiones hacia B.
- El agente solo ejecuta acciones de una lista cerrada; nunca comandos arbitrarios. Usa Docker via `docker-socket-proxy`.
- Agente -> silo: solo `/internal/*` con token por silo, dentro de la red Docker de B.
- Registro privado en el host B; tags inmutables; cada silo guarda tag + digest. Mismas reglas al migrar a ECR.
- Respaldos `pg_dump` diarios por silo, cifrados con `age`, en `respaldos/<id>/`.
- Datos externos solo via formato canonico + adaptadores (entrada y salida). PDF sin estructura = documento historico, no se interpreta.
- Pasos de los jobs idempotentes, registrados y reintentables desde el paso fallido. El rollback deshace solo lo que creo el mismo job; nunca borra datos cargados por el centro.
- Migraciones del ERP solo aditivas; actualizar un silo a la vez: backup -> migrate -> swap -> health -> volver a la imagen anterior si falla.
- Quitar un modulo oculta la UI y bloquea la escritura; no borra datos.
- Consola protegida con verificacion en dos pasos por correo.
- Textos de UI, docs y commits en espanol. Formato ASCII en docs (sin rayas largas ni comillas tipograficas).

## Stack
- Monorepo pnpm: `apps/web` (Next.js: landing SSG + `/consola` CSR), `apps/api` (NestJS + Prisma, incluye endpoints `/agente/*`), `apps/agente` (Node, corre en el host B), `packages/manifest` (schema zod + tipos, compartido con el repo `vinculos`), `packages/canonico` (formato canonico de import/export).
- Postgres `control`. Cola de jobs en Postgres (`FOR UPDATE SKIP LOCKED`), sin Redis.
- Host B: Traefik (labels + Let's Encrypt), `registry:2` o Zot, cAdvisor, agente. Correo con SES (Mailpit en local), CI en Bitbucket (push al registro del host B).
- `infra/host-a/`, `infra/host-b/` (compose por host), `infra/templates/silo.compose.tpl`, `infra/scripts/provision.sh` (version manual de los pasos), `pruebas/k6/`.

## Dominio
- Estados de centro: SOLICITUD, CONTACTADO, REUNION, DATOS_COMPLETOS, APROBADO, APROVISIONANDO, ACTIVO, SUSPENDIDO, EN_SALIDA, EXPORTADO, GRACIA, ELIMINADO, DESCARTADO. Cada transicion queda como evento de auditoria.
- Manifiesto fase 1 (formulario publico, sin datos sensibles) -> fase 2 (enlace privado tras la reunion). Editable por ambas partes hasta APROBADO. Seccion 3 del contexto.
- Jobs: `aprovisionar` (P0-P10), `reconfigurar`, `actualizar`, `reiniciar_demo` (cada noche), `exportar` (S3-S4), `eliminar` (S7). Secciones 5 y 8.
- Modulos y dependencias: nucleo siempre; fichas, agenda y equipo dependen solo de nucleo; match requiere equipo (agenda opcional); cobros requiere agenda (match opcional); sitio_publico requiere equipo. Validar en P0 y en la consola.
- Versiones 0.x (actual 0.1.4). Canales: demo, beta, estable o version fija. Patch automatico dentro del canal; minor con confirmacion por silo.
- Salida: el centro es responsable de los datos y Vinculos es el encargado (Ley 21.719). El exporte en formato canonico se genera dentro del silo, se entrega en ZIP/7z AES-256 (contrasena por otro canal) solo al responsable de datos, con hashes y acta. Luego 30 dias de gracia, eliminacion de base, volumenes, secretos y `respaldos/<id>/`, y certificado.
- Manifiesto con `tipo_cliente: centro` (independiente es futuro; precios en pausa).
- Entorno de pruebas: host B = PC local (i7 4a gen, 16 GB DDR3), 2 silos de prueba + demo con limites de 512 MB / 1 vCPU. Metricas por corrida (seccion 13 del contexto).

## Reglas heredadas del ERP (no romper)
- La ficha solo la ve su tratante (salvo acceso temporal por segunda opinion). El admin ve solo codigos de ficha. La importacion clinica corre dentro del silo y el admin ve solo conteos, codigos y errores sin contenido.
- El admin valida RNPI, titulo y certificado de alumno regular; el perfil lo gestiona el profesional.
- Roles: ADMIN, GESTION (off por defecto), PROFESIONAL, PRACTICANTE, PACIENTE; multirrol permitido.
- Vinculos no maneja dinero; cada centro usa su propia pasarela.
- Retencion de fichas de 15 anos minimo; purga manual.

## Landing
- Concepto: "Tu plataforma se arma por vinculos". Bloques que encajan; el visitante los activa y desactiva, las dependencias se ven como conexiones y un bloque sin requisito queda atenuado.
- Por modulo: problema, flujo en pasos, captura del Centro de Prueba y quien lo usa. Los bloques elegidos precargan el formulario de fase 1.
- Usa los tokens del sistema de diseno de Vinculos (`data-tema`), sin colores escritos a mano.

## Como trabajar
- Antes de codificar una pieza: leer la seccion del contexto, proponer un plan corto y esperar confirmacion si toca schema, jobs o seguridad.
- Tests: Jest para la API y los pasos de jobs contra un Postgres efimero; probar idempotencia corriendo cada paso dos veces.
- No inventar decisiones abiertas (seccion 12 del contexto): preguntar.
